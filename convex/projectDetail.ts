import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";

/**
 * BROWSER-facing project-detail composite for the native read-layer cutover
 * (Phase 1d). Returns the project-detail SPINE that `getProject` composes —
 * project scalars, project managers (+ their mirrored users), media (+ files),
 * location (+ parent), client — as RAW docs, so the client-side reconstruction
 * (extracted from src/lib/project-line-item-read + the getProject body) rebuilds
 * the same shape. The equipment subtree and overbooking are separate composites
 * (projectEquipment.browserBundle, overbooking) the client subscribes to alongside
 * this.
 *
 * Gated on `requireOrgPermission(orgId, "project", "read")` — the SAME permission
 * the getProject server action enforces. Org-scoped by the indexed reads + an
 * explicit org check on every fetched doc. `.first()` (not `.unique()`) on the
 * by_cuid point reads to tolerate a duplicate mirror row (CLAUDE.md), matching the
 * guard's resilience.
 *
 * Not consumed yet — Phase 1d wires `useQuery` onto it behind a flag.
 */
export const bundle = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");

    const project = await ctx.db
      .query("projects")
      .withIndex("by_cuid", (q) => q.eq("id", projectId))
      .first();
    if (!project || project.organizationId !== orgId) return null;

    const [managers, media] = await Promise.all([
      ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectMedia").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ]);

    const uniq = (arr: Array<string | undefined | null>): string[] => [
      ...new Set(arr.filter((x): x is string => !!x)),
    ];
    const managerUserIds = uniq(managers.map((m) => m.userId));
    const mediaFileIds = uniq(media.map((m) => m.fileId));

    const user = (id: string) => ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    const file = (id: string) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    const loc = (id: string) => ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first();

    const [managerUsers, mediaFiles, client, location] = await Promise.all([
      Promise.all(managerUserIds.map(user)),
      Promise.all(mediaFileIds.map(file)),
      project.clientId
        ? ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", project.clientId!)).first()
        : Promise.resolve(null),
      project.locationId ? loc(project.locationId) : Promise.resolve(null),
    ]);

    const parentLocation = location && location.parentId ? await loc(location.parentId) : null;

    const inOrg = <T extends { organizationId?: string | null }>(d: T | null) =>
      d && d.organizationId === orgId ? d : null;

    return {
      project,
      projectManagers: managers,
      // Users are global (not org-scoped); the mirror is service-written.
      managerUsers: managerUsers.filter((d): d is NonNullable<typeof d> => d !== null),
      media,
      mediaFiles: mediaFiles.filter(
        (d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId,
      ),
      client: inOrg(client),
      location: inOrg(location),
      parentLocation: inOrg(parentLocation),
    };
  },
});
