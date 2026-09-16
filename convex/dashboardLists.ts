import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor, getAuthContext, isMemberAuth } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { resolveLiveVersionIdForProject, versionRows } from "./lib/versionScope";

/**
 * BROWSER-facing native replacements for the bounded project/thread dashboard
 * reads (Phase 3): getUpcomingProjects, getMyHomeData, getMyBlockingComments.
 * Each reads bounded sets (a handful of projects / open blocking threads), counts
 * EQUIPMENT line items per candidate (≤8 / ≤24 projects), and attaches the client
 * — reactive, no counter needed. Dates stay epoch-ms (the client wraps with
 * `new Date()`); `now` is client-passed (queries can't read the clock). Gated on
 * requireOrgReadFor(ctx, orgId, "project") (org-scoping — matches the server
 * actions' getOrgContext; Phase 5 domain slice, #1001).
 */

const UPCOMING_STATUSES = new Set(["CONFIRMED", "PREPPING", "QUOTED", "AWAITING_PAYMENT"]);
const HOME_INACTIVE_STATUSES = new Set(["COMPLETED", "INVOICED", "CANCELLED"]);

/**
 * A gig is "done" — and should stop surfacing needs-attention alerts (blocking
 * comments, pending crew offers) — once it's closed out or cancelled (same
 * terminal statuses as HOME_INACTIVE_STATUSES) OR its rental window has already
 * ended. Alerts belong on current/future work; a finished job's loose ends are
 * no longer anyone's "needs attention" item.
 */
function isCurrentOrFutureProject(project: { status?: string; rentalEndDate?: number }, now: number): boolean {
  if (HOME_INACTIVE_STATUSES.has(project.status ?? "")) return false;
  if (project.rentalEndDate != null && project.rentalEndDate < now) return false;
  return true;
}

type ProjectDoc = { id: string; isTemplate?: boolean; status?: string; rentalStartDate?: number; rentalEndDate?: number; projectNumber: string; name: string; clientId?: string; projectManagerId?: string; createdAt?: number };

/** EQUIPMENT line-item count per project id (mirrors countEquipmentLineItemsByProject).
 *  LIVE-ONLY (#1228) — a dashboard tile counts the live plan. */
async function countEquipmentLineItems(ctx: QueryCtx, orgId: string, projectIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    projectIds.map(async (pid) => {
      const versionId = await resolveLiveVersionIdForProject(ctx, pid, orgId);
      const rows = await versionRows(ctx, "projectLineItems", versionId);
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
    // Range-scan only FUTURE projects (rentalStartDate >= now) via the composite
    // index, ordered by rentalStartDate asc — stop once we have 8 matches. Replaces
    // a reactive whole-org-projects .collect() that re-read all history on any
    // project write. Null rentalStartDate rows are outside the range = correctly
    // excluded (the old filter required rentalStartDate != null && >= now).
    const candidates: ProjectDoc[] = [];
    for await (const doc of ctx.db
      .query("projects")
      .withIndex("by_organizationId_rentalStartDate", (q) =>
        q.eq("organizationId", orgId).gte("rentalStartDate", now),
      )) {
      const p = doc as unknown as ProjectDoc;
      if (p.isTemplate !== true && UPCOMING_STATUSES.has(p.status ?? "")) {
        candidates.push(p);
        if (candidates.length >= 8) break;
      }
    }

    const counts = await countEquipmentLineItems(ctx, orgId, candidates.map((p) => p.id));
    const clients = await resolveClients(ctx, candidates.map((p) => p.clientId).filter((x): x is string => !!x));
    return candidates.map((p) => projectTile(p, counts, clients));
  },
});

// ─── getMyHomeData ───────────────────────────────────────────────────────────

export const home = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: user token required.");
    const userId = auth.userId;

    // Only THIS user's projects, not the whole org tables: directly-managed
    // (projects.by_projectManagerId) ∪ PM-assigned (projectManagers.by_userId).
    // Previously .collect()'d the whole org projects + whole org projectManagers
    // tables reactively (re-read on any project/PM write). by_projectManagerId /
    // by_userId are global → org-re-checked below.
    const [managedProjects, pmEntries, userDoc] = await Promise.all([
      ctx.db.query("projects").withIndex("by_projectManagerId", (q) => q.eq("projectManagerId", userId)).collect(),
      ctx.db.query("projectManagers").withIndex("by_userId", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", userId)).unique(),
    ]);

    const managedById = new Map(managedProjects.map((p) => [p.id, p]));
    const extraIds = [...new Set(pmEntries.filter((e) => e.organizationId === orgId).map((e) => e.projectId))]
      .filter((pid) => !managedById.has(pid));
    const extra = await Promise.all(
      extraIds.map((pid) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique()),
    );
    const userProjects = [
      ...managedProjects,
      ...extra.filter((p): p is NonNullable<typeof p> => p != null),
    ] as unknown as ProjectDoc[];

    const candidates = userProjects
      .filter(
        (p) =>
          (p as { organizationId?: string }).organizationId === orgId &&
          p.isTemplate !== true &&
          !HOME_INACTIVE_STATUSES.has(p.status ?? ""),
      )
      .sort((a, b) => {
        if (a.rentalStartDate != null && b.rentalStartDate != null) return a.rentalStartDate - b.rentalStartDate;
        if (a.rentalStartDate != null) return -1;
        if (b.rentalStartDate != null) return 1;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      })
      .slice(0, 24);

    const counts = await countEquipmentLineItems(ctx, orgId, candidates.map((p) => p.id));
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
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: user token required.");
    const userId = auth.userId;

    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_isBlocking_status", (q) =>
        q.eq("orgId", orgId).eq("isBlocking", true).eq("status", "open"),
      )
      .collect();
    if (threads.length === 0) return [];

    // Only THIS user's PM assignments (by_userId), not the whole org PM table.
    const pmEntries = await ctx.db
      .query("projectManagers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const pmProjectIds = new Set(pmEntries.filter((e) => e.organizationId === orgId).map((e) => e.projectId));

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
      // Closed-out / cancelled / past gigs are done — their blocking comments
      // stop being a "needs attention" alert (still resolvable from the
      // project's own Activity tab, just not surfaced here).
      if (!isCurrentOrFutureProject(project, now)) continue;
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

// ─── pendingCrewOffers (needs-attention scoped count) ────────────────────────
// The dashboardCounters.pendingCrewOffers sharded counter is a raw org-wide
// count (no project join — see convex/lib/counters.ts) used for the general
// stats bundle. The "needs attention" chip wants a narrower question: how many
// pending offers belong to a gig that hasn't happened yet or wrapped up? That
// requires a project join, so it's a small bounded query here rather than a
// field on the counter.
const PENDING_OFFER_STATUSES = ["OFFERED", "PENDING"] as const;

export const pendingCrewOffers = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)

    const assignmentLists = await Promise.all(
      PENDING_OFFER_STATUSES.map((status) =>
        ctx.db
          .query("crewAssignments")
          .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status))
          .collect(),
      ),
    );
    const assignments = assignmentLists.flat();
    if (assignments.length === 0) return 0;

    const projectIds = [...new Set(assignments.map((a) => a.projectId))];
    const projectDocs = await Promise.all(
      projectIds.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    const projectMap = new Map(projectDocs.filter((p): p is NonNullable<typeof p> => p != null).map((p) => [p.id, p]));

    return assignments.filter((a) => {
      const project = projectMap.get(a.projectId);
      return project != null && project.organizationId === orgId && isCurrentOrFutureProject(project, now);
    }).length;
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  upcoming: { summary: "List the org's upcoming projects (next 8 by rental start date).", danger: "low", mcpTier: 2 },
  home: { summary: "The caller's personal dashboard project list (managed or PM-assigned).", danger: "low", mcpTier: 2 },
  blocking: { summary: "Blocking comment threads relevant to the caller (as PM or mentioned).", danger: "low", mcpTier: 2 },
  pendingCrewOffers: { summary: "Count of pending crew offers on current/future (not past or closed) gigs.", danger: "low", mcpTier: 2 },
};
