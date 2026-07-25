import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgRead } from "./lib/auth";

type AssignmentStatus = NonNullable<Doc<"crewAssignments">["status"]>;

/**
 * Browser-direct crew-dashboard reads (Phase 3 — replace getCrewPickerList /
 * getCrewDashboardStats / getPendingTimeEntries / getActiveAssignmentsSummary /
 * getPendingOffers / getUpcomingShifts). All org-scoped; dates → ISO strings. `nowMs` is
 * passed by the client (Convex can't call Date.now()).
 *
 * R-8.3.3/R-9.8: `crewGraph()` used to also `.collect()` the org's ENTIRE projects table
 * just to attach `{id, name, projectNumber}` to a handful of assignments — unbounded and
 * growing forever, independent of how many assignments actually reference a project.
 * Projects are now fetched by `by_cuid` ONLY for the ids a handler's (already-loaded)
 * assignments actually reference (`loadProjectMap`) — bounded by referenced-project
 * count, not the org's full project history. `activeAssignmentsSummary` / `pendingOffers`
 * also no longer collect the org's whole assignment history: they range-scan the new
 * `by_organizationId_status` index for just the 2 statuses each cares about.
 */

const DAY = 86_400_000;
const ACTIVE: readonly AssignmentStatus[] = ["CONFIRMED", "ACCEPTED"];
const PENDING: readonly AssignmentStatus[] = ["PENDING", "OFFERED"];
const EXCLUDED = new Set(["CANCELLED", "DECLINED"]);
const PENDING_SET: Set<string> = new Set(PENDING);
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const cmpAscNulls = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);
const cmpDescNulls = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : b - a);
const cmpStr = (a: string | null | undefined, b: string | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b));

/** Members + roles — a small org-scoped pair every dashboard read needs. */
async function crewGraphMembersAndRoles(ctx: QueryCtx, orgId: string) {
  const [members, roles] = await Promise.all([
    ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
    ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
  ]);
  return {
    members,
    memberById: new Map(members.map((m) => [m.id, m])),
    roleById: new Map(roles.map((r) => [r.id, r])),
  };
}

/**
 * Members + roles + the org's FULL assignment history. Only for handlers that
 * genuinely need every status (pickerList's per-member history; upcomingShifts,
 * which must scope crewShifts's org-less rows via every assignment id it owns) —
 * everything else fetches a bounded, status- or entry-scoped assignment set instead
 * (`loadAssignmentsByStatus`, or a direct by_cuid lookup) and skips this.
 */
async function crewGraph(ctx: QueryCtx, orgId: string) {
  const [g, assignments] = await Promise.all([
    crewGraphMembersAndRoles(ctx, orgId),
    ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
  ]);
  return { ...g, assignments };
}

/** Assignments in `statuses`, range-scanned via by_organizationId_status — bounded to just those statuses, not the org's whole assignment history. */
async function loadAssignmentsByStatus(ctx: QueryCtx, orgId: string, statuses: readonly AssignmentStatus[]) {
  const hits = await Promise.all(
    statuses.map((status) =>
      ctx.db.query("crewAssignments").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).collect(),
    ),
  );
  return hits.flat();
}

/**
 * Project docs for a specific id set, keyed for O(1) lookup — bounded to the ids
 * actually referenced. by_cuid is a global index (not org-scoped), so every hit is
 * checked against orgId before being kept (CLAUDE.md by_cuid/by_modelId note) — a
 * project id sourced from a corrupt/cross-org FK must not leak another org's project.
 */
async function loadProjectMap(ctx: QueryCtx, orgId: string, projectIds: Iterable<string>) {
  const projects = await Promise.all(
    [...new Set(projectIds)].map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );
  return new Map(
    projects.filter((p): p is NonNullable<typeof p> => p != null && p.organizationId === orgId).map((p) => [p.id, p]),
  );
}
// Spread an assignment with its date fields as ISO strings (generic → preserves the
// doc's own keys like `id`/`status` for the caller).
const isoAssignment = <A extends Record<string, unknown>>(a: A) => ({ ...a, startDate: iso(a.startDate as number | null), endDate: iso(a.endDate as number | null), offeredAt: iso(a.offeredAt as number | null), respondedAt: iso(a.respondedAt as number | null), confirmedAt: iso(a.confirmedAt as number | null), createdAt: iso(a.createdAt as number | null), updatedAt: iso(a.updatedAt as number | null) });

export const pickerList = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const g = await crewGraph(ctx, orgId);
    const active = g.members.filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE").sort((a, b) => cmpStr(a.firstName, b.firstName) || cmpStr(a.lastName, b.lastName));
    const byMember = new Map<string, typeof g.assignments>();
    for (const a of g.assignments) { const l = byMember.get(a.crewMemberId) ?? []; l.push(a); byMember.set(a.crewMemberId, l); }
    const kept = active.flatMap((m) => (byMember.get(m.id) ?? []).filter((a) => !EXCLUDED.has(a.status ?? "")));
    const projectMap = await loadProjectMap(ctx, orgId, kept.map((a) => a.projectId));
    return active.map((m) => {
      const role = m.crewRoleId ? g.roleById.get(m.crewRoleId) ?? null : null;
      const assignments = (byMember.get(m.id) ?? [])
        .filter((a) => !EXCLUDED.has(a.status ?? ""))
        .sort((a, b) => cmpDescNulls(a.startDate, b.startDate))
        .map((a) => { const p = projectMap.get(a.projectId); const aRole = a.crewRoleId ? g.roleById.get(a.crewRoleId) : null; return { ...isoAssignment(a), project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null, crewRole: aRole ? { id: aRole.id, name: aRole.name } : null }; });
      return { id: m.id, firstName: m.firstName, lastName: m.lastName, department: m.department ?? null, crewRole: role ? { name: role.name } : null, assignments };
    });
  },
});

export const stats = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);
    const [members, assignments, entries] = await Promise.all([
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
      ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
      ctx.db.query("crewTimeEntries").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
    ]);
    const weekAgo = nowMs - 7 * DAY;
    return {
      totalActive: members.filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE").length,
      activeAssignments: assignments.filter((a) => a.status === "CONFIRMED" && (a.endDate == null || a.endDate >= nowMs)).length,
      pendingOffers: assignments.filter((a) => PENDING_SET.has(a.status ?? "")).length,
      submittedTime: entries.filter((e) => e.status === "SUBMITTED").length,
      hoursThisWeek: entries.filter((e) => (e.status === "APPROVED" || e.status === "EXPORTED") && (e.date ?? 0) >= weekAgo).reduce((s, e) => s + (e.totalHours ?? 0), 0),
    };
  },
});

export const pendingTimeEntries = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    // Read only SUBMITTED entries via the status index — the pending set — instead of
    // scanning the whole (unbounded, grows per shift) time-entry table (R-9.8).
    const submitted = await ctx.db
      .query("crewTimeEntries")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "SUBMITTED"))
      .collect();
    const entries = submitted.sort((a, b) => cmpDescNulls(a.date, b.date)).slice(0, 15);

    // Members/roles are a small org-scoped table (kept as a full read); assignments +
    // projects are fetched ONLY for what these ≤15 entries reference — not the org's
    // whole assignment/project history (R-9.8).
    const [g, assignments] = await Promise.all([
      crewGraphMembersAndRoles(ctx, orgId),
      Promise.all(
        [...new Set(entries.map((e) => e.assignmentId).filter((id): id is string => id != null))].map((id) =>
          ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
        ),
      ),
    ]);
    // by_cuid is a global index (not org-scoped) — an entry's assignmentId must be
    // checked against orgId before use, or a cross-org assignment fetched here would
    // leak (CLAUDE.md by_cuid/by_modelId note).
    const assignById = new Map(
      assignments.filter((a): a is NonNullable<typeof a> => a != null && a.organizationId === orgId).map((a) => [a.id, a]),
    );
    const projectMap = await loadProjectMap(ctx, orgId, [...assignById.values()].map((a) => a.projectId));

    return entries.map((e) => {
      const member = g.memberById.get(e.crewMemberId) ?? null;
      const assignment = e.assignmentId ? assignById.get(e.assignmentId) ?? null : null;
      const p = assignment ? projectMap.get(assignment.projectId) ?? null : null;
      const role = assignment?.crewRoleId ? g.roleById.get(assignment.crewRoleId) ?? null : null;
      return { ...e, date: iso(e.date), createdAt: iso(e.createdAt), updatedAt: iso(e.updatedAt), crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null, assignment: assignment ? { ...isoAssignment(assignment), project: p ? { name: p.name, projectNumber: p.projectNumber } : null, crewRole: role ? { name: role.name } : null } : null };
    });
  },
});

export const activeAssignmentsSummary = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);
    const [g, assignments] = await Promise.all([
      crewGraphMembersAndRoles(ctx, orgId),
      loadAssignmentsByStatus(ctx, orgId, [...ACTIVE]),
    ]);
    const active = assignments
      .filter((a) => a.endDate == null || a.endDate >= nowMs)
      .sort((a, b) => cmpAscNulls(a.startDate, b.startDate))
      .slice(0, 20);
    const projectMap = await loadProjectMap(ctx, orgId, active.map((a) => a.projectId));
    return active.map((a) => {
      const member = g.memberById.get(a.crewMemberId) ?? null;
      const role = a.crewRoleId ? g.roleById.get(a.crewRoleId) ?? null : null;
      const p = projectMap.get(a.projectId) ?? null;
      return { ...isoAssignment(a), crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName } : null, crewRole: role ? { name: role.name } : null, project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber, status: p.status ?? null } : null };
    });
  },
});

export const pendingOffers = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const [g, assignments] = await Promise.all([
      crewGraphMembersAndRoles(ctx, orgId),
      loadAssignmentsByStatus(ctx, orgId, [...PENDING]),
    ]);
    const pending = assignments.sort((a, b) => cmpDescNulls(a.createdAt, b.createdAt)).slice(0, 15);
    const projectMap = await loadProjectMap(ctx, orgId, pending.map((a) => a.projectId));
    return pending.map((a) => {
      const member = g.memberById.get(a.crewMemberId) ?? null;
      const role = a.crewRoleId ? g.roleById.get(a.crewRoleId) ?? null : null;
      const p = projectMap.get(a.projectId) ?? null;
      return { ...isoAssignment(a), crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName, email: member.email ?? null } : null, crewRole: role ? { name: role.name } : null, project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null };
    });
  },
});

export const upcomingShifts = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);
    const g = await crewGraph(ctx, orgId);
    const startOfToday = new Date(nowMs).setHours(0, 0, 0, 0);
    const orgAssignmentIds = new Set(g.assignments.map((a) => a.id));
    const assignById = new Map(g.assignments.map((a) => [a.id, a]));
    // crewShifts have no org column — scope via the org's assignment ids. Batched in
    // parallel (R-8.3.2) instead of one sequential round-trip per assignment.
    const shiftLists = await Promise.all(
      Array.from(orgAssignmentIds, (id) => ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect()),
    );
    const shifts = shiftLists.flat();
    const upcoming = shifts
      .filter((s) => s.status === "SCHEDULED" && s.date >= startOfToday && orgAssignmentIds.has(s.assignmentId))
      .sort((a, b) => cmpAscNulls(a.date, b.date))
      .slice(0, 10);
    const projectMap = await loadProjectMap(
      ctx,
      orgId,
      upcoming.map((s) => assignById.get(s.assignmentId)?.projectId).filter((id): id is string => id != null),
    );
    return upcoming.map((s) => {
      const assignment = assignById.get(s.assignmentId) ?? null;
      const member = assignment ? g.memberById.get(assignment.crewMemberId) ?? null : null;
      const role = assignment?.crewRoleId ? g.roleById.get(assignment.crewRoleId) ?? null : null;
      const p = assignment ? projectMap.get(assignment.projectId) ?? null : null;
      return { ...s, date: iso(s.date), assignment: assignment ? { ...isoAssignment(assignment), crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null, crewRole: role ? { name: role.name } : null, project: p ? { name: p.name, projectNumber: p.projectNumber } : null } : null };
    });
  },
});
