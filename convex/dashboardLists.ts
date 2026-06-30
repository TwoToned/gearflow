import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead, getAuthContext } from "./lib/auth";

/**
 * BROWSER-facing native replacements for the bounded project/thread dashboard
 * reads (Phase 3): getUpcomingProjects, getMyHomeData, getMyBlockingComments.
 * Each reads bounded sets (a handful of projects / open blocking threads), counts
 * EQUIPMENT line items per candidate (≤8 / ≤24 projects), and attaches the client
 * — reactive, no counter needed. Dates stay epoch-ms (the client wraps with
 * `new Date()`); `now` is client-passed (queries can't read the clock). Gated on
 * requireOrgRead (org-scoping — matches the server actions' getOrgContext).
 */

const UPCOMING_STATUSES = new Set(["CONFIRMED", "PREPPING", "QUOTED"]);
const HOME_INACTIVE_STATUSES = new Set(["COMPLETED", "INVOICED", "CANCELLED"]);

type ProjectDoc = { id: string; isTemplate?: boolean; status?: string; rentalStartDate?: number; rentalEndDate?: number; projectNumber: string; name: string; clientId?: string; projectManagerId?: string; createdAt?: number };

/** EQUIPMENT line-item count per project id (mirrors countEquipmentLineItemsByProject). */
async function countEquipmentLineItems(ctx: QueryCtx, projectIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    projectIds.map(async (pid) => {
      const rows = await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", pid))
        .collect();
      counts.set(pid, rows.filter((li) => (li.type ?? "EQUIPMENT") === "EQUIPMENT").length);
    }),
  );
  return counts;
}

/** Resolve `{ name } | null` clients for the given ids (point reads). */
async function resolveClients(ctx: QueryCtx, clientIds: string[]): Promise<Map<string, { name: string }>> {
  const map = new Map<string, { name: string }>();
  await Promise.all(
    [...new Set(clientIds)].map(async (id) => {
      const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (c) map.set(id, { name: c.name });
    }),
  );
  return map;
}

function projectTile(p: ProjectDoc, counts: Map<string, number>, clients: Map<string, { name: string }>) {
  return {
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    status: p.status ?? "ENQUIRY",
    rentalStartDate: p.rentalStartDate ?? null,
    rentalEndDate: p.rentalEndDate ?? null,
    client: p.clientId ? clients.get(p.clientId) ?? null : null,
    _count: { lineItems: counts.get(p.id) ?? 0 },
  };
}

// ─── getUpcomingProjects ─────────────────────────────────────────────────────

export const upcoming = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgRead(ctx, orgId);
    const projects = (await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect()) as unknown as ProjectDoc[];

    const candidates = projects
      .filter(
        (p) =>
          p.isTemplate !== true &&
          UPCOMING_STATUSES.has(p.status ?? "") &&
          p.rentalStartDate != null &&
          (p.rentalStartDate as number) >= now,
      )
      .sort((a, b) => (a.rentalStartDate as number) - (b.rentalStartDate as number))
      .slice(0, 8);

    const counts = await countEquipmentLineItems(ctx, candidates.map((p) => p.id));
    const clients = await resolveClients(ctx, candidates.map((p) => p.clientId).filter((x): x is string => !!x));
    return candidates.map((p) => projectTile(p, counts, clients));
  },
});

// ─── getMyHomeData ───────────────────────────────────────────────────────────

export const home = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const auth = await getAuthContext(ctx);
    if (!auth || auth.kind !== "user") throw new ConvexError("Unauthorized: user token required.");
    const userId = auth.userId;

    const [projects, pmEntries, userDoc] = await Promise.all([
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("projectManagers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", userId)).unique(),
    ]);
    const pmProjectIds = new Set(pmEntries.filter((e) => e.userId === userId).map((e) => e.projectId));

    const candidates = (projects as unknown as ProjectDoc[])
      .filter(
        (p) =>
          p.isTemplate !== true &&
          !HOME_INACTIVE_STATUSES.has(p.status ?? "") &&
          (p.projectManagerId === userId || pmProjectIds.has(p.id)),
      )
      .sort((a, b) => {
        if (a.rentalStartDate != null && b.rentalStartDate != null) return a.rentalStartDate - b.rentalStartDate;
        if (a.rentalStartDate != null) return -1;
        if (b.rentalStartDate != null) return 1;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      })
      .slice(0, 24);

    const counts = await countEquipmentLineItems(ctx, candidates.map((p) => p.id));
    const clients = await resolveClients(ctx, candidates.map((p) => p.clientId).filter((x): x is string => !!x));
    return {
      userName: userDoc?.name ?? "",
      userId,
      myProjects: candidates.map((p) => projectTile(p, counts, clients)),
    };
  },
});

// ─── getMyBlockingComments ───────────────────────────────────────────────────

export const blocking = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const auth = await getAuthContext(ctx);
    if (!auth || auth.kind !== "user") throw new ConvexError("Unauthorized: user token required.");
    const userId = auth.userId;

    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_isBlocking_status", (q) =>
        q.eq("orgId", orgId).eq("isBlocking", true).eq("status", "open"),
      )
      .collect();
    if (threads.length === 0) return [];

    const pmEntries = await ctx.db
      .query("projectManagers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    const pmProjectIds = new Set(pmEntries.filter((e) => e.userId === userId).map((e) => e.projectId));

    const projectIds = [...new Set(threads.map((t) => t.projectId ?? t.entityId).filter((x): x is string => !!x))];
    const projectDocs = await Promise.all(
      projectIds.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    const projectMap = new Map(projectDocs.filter((p): p is NonNullable<typeof p> => p != null).map((p) => [p.id, p]));

    const surfaced = [];
    for (const t of threads) {
      const projectId = t.projectId ?? t.entityId;
      const project = projectId ? projectMap.get(projectId) : undefined;
      if (!project) continue;
      const isPM = project.projectManagerId === userId || pmProjectIds.has(project.id);
      const isMentioned = (t.mentionUserIds ?? []).includes(userId);
      if (!isPM && !isMentioned) continue;

      const firstComment = await ctx.db
        .query("comments")
        .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", t._id as unknown as string))
        .first();

      surfaced.push({
        threadId: t._id as string,
        projectId: project.id,
        projectName: project.name,
        projectNumber: project.projectNumber,
        targetType: t.targetType ?? null,
        snippet: firstComment?.body ?? "",
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        reason: isMentioned ? ("mention" as const) : ("pm" as const),
      });
    }
    return surfaced.sort((a, b) => b.createdAt - a.createdAt);
  },
});
