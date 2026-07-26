import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { getOpenUnlockSession, isHardLockOverrideAllowed, lockTierForStatus } from "./lib/projectLocks";
import { getAuthContext } from "./lib/auth";
import { collectCurrentEntries } from "./lib/projectSnapshots";

const ENTRY_RETURNS = v.array(
  v.object({
    entityType: v.union(
      v.literal("project"),
      v.literal("category"),
      v.literal("group"),
      v.literal("lineItem"),
      v.literal("service"),
      v.literal("crewAssignment"),
    ),
    entityId: v.string(),
    data: v.any(),
  }),
);

/**
 * BROWSER-facing reads for the #957 lifecycle-lock program: the project's
 * current tier + open unlock session (for the banner/lock icons), and the
 * snapshot/version list + a single snapshot's entries (for the Versions/diff
 * UI, #792). Gated on `project:read` — same permission the rest of the
 * project-detail composites use.
 */

export const status = query({
  args: { projectId: v.string(), orgId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      tier: v.union(v.literal("OPEN"), v.literal("FINANCE_LOCKED"), v.literal("JUSTIFY"), v.literal("HARD_LOCKED")),
      canOverrideHardLock: v.boolean(),
      openSession: v.union(
        v.null(),
        v.object({
          id: v.string(),
          scope: v.union(v.literal("FINANCIAL"), v.literal("FULL")),
          justification: v.string(),
          openedBy: v.string(),
          openedByName: v.optional(v.string()),
          openedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return null;

    const tier = lockTierForStatus(project.status);
    const session = await getOpenUnlockSession(ctx, orgId, projectId);

    const auth = await getAuthContext(ctx);
    const canOverrideHardLock =
      auth?.kind === "service" ||
      (auth?.kind === "user" && (await isHardLockOverrideAllowed(ctx, orgId, projectId, auth.userId)));

    return {
      tier,
      canOverrideHardLock,
      openSession: session
        ? {
            id: session.id,
            scope: session.scope,
            justification: session.justification,
            openedBy: session.openedBy,
            openedByName: session.openedByName,
            openedAt: session.openedAt,
          }
        : null,
    };
  },
});

export const listSnapshots = query({
  args: { projectId: v.string(), orgId: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      reason: v.union(v.literal("CONFIRMED"), v.literal("COMPLETED"), v.literal("UNLOCK")),
      takenAt: v.number(),
      takenBy: v.string(),
      takenByName: v.optional(v.string()),
      statusFrom: v.optional(v.string()),
      statusTo: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const rows = (
      await ctx.db.query("projectSnapshots").withIndex("by_projectId_takenAt", (q) => q.eq("projectId", projectId)).collect()
    ).filter((s) => s.organizationId === orgId);
    return rows
      .sort((a, b) => b.takenAt - a.takenAt)
      .map((s) => ({
        id: s.id,
        reason: s.reason,
        takenAt: s.takenAt,
        takenBy: s.takenBy,
        takenByName: s.takenByName,
        statusFrom: s.statusFrom,
        statusTo: s.statusTo,
      }));
  },
});

export const snapshotEntries = query({
  args: { snapshotId: v.string(), orgId: v.string() },
  returns: ENTRY_RETURNS,
  handler: async (ctx, { snapshotId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    // Org-check the parent snapshot row first — snapshotId alone doesn't prove
    // tenancy (by_snapshotId on projectSnapshotEntries is not itself org-scoped).
    const snapshot = await ctx.db.query("projectSnapshots").withIndex("by_cuid", (q) => q.eq("id", snapshotId)).first();
    if (!snapshot || snapshot.organizationId !== orgId) return [];
    const entries = (
      await ctx.db.query("projectSnapshotEntries").withIndex("by_snapshotId", (q) => q.eq("snapshotId", snapshotId)).collect()
    ).filter((e) => e.organizationId === orgId);
    return entries.map((e) => ({ entityType: e.entityType, entityId: e.entityId, data: e.data }));
  },
});

/** Read-only "current" state in the same entry shape as a snapshot — lets the
 *  Versions UI diff snapshot↔current through the identical code path as
 *  snapshot↔snapshot (src/lib/project-snapshot-diff.ts). */
export const currentEntries = query({
  args: { projectId: v.string(), orgId: v.string() },
  returns: ENTRY_RETURNS,
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return [];
    return collectCurrentEntries(ctx, orgId, project);
  },
});
