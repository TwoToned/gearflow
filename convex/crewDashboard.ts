import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgRead } from "./lib/auth";

/**
 * Browser-direct crew-dashboard reads (Phase 3 — replace getCrewPickerList /
 * getCrewDashboardStats / getPendingTimeEntries / getActiveAssignmentsSummary /
 * getPendingOffers / getUpcomingShifts). All org-scoped; dates → ISO strings. `nowMs` is
 * passed by the client (Convex can't call Date.now()).
 */

type AssignmentStatus = NonNullable<Doc<"crewAssignments">["status"]>;
type TimeEntryStatus = NonNullable<Doc<"crewTimeEntries">["status"]>;

const DAY = 86_400_000;
const ACTIVE: readonly AssignmentStatus[] = ["CONFIRMED", "ACCEPTED"];
const PENDING: readonly AssignmentStatus[] = ["PENDING", "OFFERED"];
const EXCLUDED = new Set(["CANCELLED", "DECLINED"]);
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const cmpAscNulls = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);
const cmpDescNulls = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : b - a);
const cmpStr = (a: string | null | undefined, b: string | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b));

/**
 * Assignments narrowed to one or more statuses via the `by_organizationId_status`
 * compound index (R-9.8) instead of collecting the whole org-wide assignments table
 * and filtering in JS. One query per status, run in parallel and merged.
 */
async function assignmentsByStatus(ctx: QueryCtx, orgId: string, statuses: readonly AssignmentStatus[]) {
  const lists = await Promise.all(
    statuses.map((status) => ctx.db.query("crewAssignments").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).collect()),
  );
  return lists.flat();
}

/**
 * Every assignment in the org, any status. Needed in full by two callers only:
 *  - `pickerList` shows each active member's *complete* assignment history (not just
 *    active/pending), so narrowing by status would just mean re-fetching every status.
 *  - `upcomingShifts` — `crewShifts` has no `organizationId` column, so the org's shift
 *    set can only be scoped via the org's full assignment-id set.
 * Real, dated §15 exception (not a bare comment) — see docs/exceptions.md
 * R-8.3.3 crewDashboard-fullAssignments.
 */
async function allOrgAssignments(ctx: QueryCtx, orgId: string) {
  return ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: see docs/exceptions.md R-8.3.3 crewDashboard-fullAssignments
}

/**
 * Roster/fleet lookups most dashboard reads join against — bounded by headcount and
 * active-project count, not by transaction volume the way assignments/time-entries
 * are. Real, dated §15 exception — see docs/exceptions.md R-8.3.3 crewDashboard-lookups.
 */
async function crewLookups(ctx: QueryCtx, orgId: string) {
  const [members, roles, projects] = await Promise.all([
    ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 crewDashboard-lookups
    ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 crewDashboard-lookups
    ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 crewDashboard-lookups
  ]);
  return {
    members,
    memberById: new Map(members.map((m) => [m.id, m])),
    roleById: new Map(roles.map((r) => [r.id, r])),
    projById: new Map(projects.map((p) => [p.id, p])),
  };
}
// Spread an assignment with its date fields as ISO strings (generic → preserves the
// doc's own keys like `id`/`status` for the caller).
const isoAssignment = <A extends Record<string, unknown>>(a: A) => ({ ...a, startDate: iso(a.startDate as number | null), endDate: iso(a.endDate as number | null), offeredAt: iso(a.offeredAt as number | null), respondedAt: iso(a.respondedAt as number | null), confirmedAt: iso(a.confirmedAt as number | null), createdAt: iso(a.createdAt as number | null), updatedAt: iso(a.updatedAt as number | null) });

export const pickerList = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const [g, assignments] = await Promise.all([crewLookups(ctx, orgId), allOrgAssignments(ctx, orgId)]);
    const active = g.members.filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE").sort((a, b) => cmpStr(a.firstName, b.firstName) || cmpStr(a.lastName, b.lastName));
    const byMember = new Map<string, typeof assignments>();
    for (const a of assignments) { const l = byMember.get(a.crewMemberId) ?? []; l.push(a); byMember.set(a.crewMemberId, l); }
    return active.map((m) => {
      const role = m.crewRoleId ? g.roleById.get(m.crewRoleId) ?? null : null;
      const memberAssignments = (byMember.get(m.id) ?? [])
        .filter((a) => !EXCLUDED.has(a.status ?? ""))
        .sort((a, b) => cmpDescNulls(a.startDate, b.startDate))
        .map((a) => { const p = g.projById.get(a.projectId); const aRole = a.crewRoleId ? g.roleById.get(a.crewRoleId) : null; return { ...isoAssignment(a), project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null, crewRole: aRole ? { id: aRole.id, name: aRole.name } : null }; });
      return { id: m.id, firstName: m.firstName, lastName: m.lastName, department: m.department ?? null, crewRole: role ? { name: role.name } : null, assignments: memberAssignments };
    });
  },
});

export const stats = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);
    const weekAgo = nowMs - 7 * DAY;
    const [members, confirmedAssignments, pendingAssignments, submittedEntries, hoursEntries] = await Promise.all([
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 crewDashboard-lookups
      ctx.db.query("crewAssignments").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "CONFIRMED")).collect(),
      assignmentsByStatus(ctx, orgId, PENDING),
      ctx.db.query("crewTimeEntries").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "SUBMITTED")).collect(),
      Promise.all((["APPROVED", "EXPORTED"] as const satisfies readonly TimeEntryStatus[]).map((status) => ctx.db.query("crewTimeEntries").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).collect())).then((lists) => lists.flat()),
    ]);
    return {
      totalActive: members.filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE").length,
      activeAssignments: confirmedAssignments.filter((a) => a.endDate == null || a.endDate >= nowMs).length,
      pendingOffers: pendingAssignments.length,
      submittedTime: submittedEntries.length,
      hoursThisWeek: hoursEntries.filter((e) => (e.date ?? 0) >= weekAgo).reduce((s, e) => s + (e.totalHours ?? 0), 0),
    };
  },
});

export const pendingTimeEntries = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const g = await crewLookups(ctx, orgId);
    // Read only SUBMITTED entries via the status index — the pending set — instead of
    // scanning the whole (unbounded, grows per shift) time-entry table (R-9.8).
    const entries = await ctx.db
      .query("crewTimeEntries")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "SUBMITTED"))
      .collect();
    const top = entries.sort((a, b) => cmpDescNulls(a.date, b.date)).slice(0, 15);
    // Only the assignments the top 15 entries actually reference — not the whole org's
    // assignment table (R-9.8). Re-checked against orgId in case of a stale FK.
    const assignmentIds = new Set(top.map((e) => e.assignmentId).filter((id): id is string => id != null));
    const fetchedAssignments = await Promise.all(
      Array.from(assignmentIds, (id) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).first()),
    );
    const assignById = new Map(
      fetchedAssignments.filter((a): a is NonNullable<typeof a> => a != null && a.organizationId === orgId).map((a) => [a.id, a]),
    );
    return top.map((e) => {
      const member = g.memberById.get(e.crewMemberId) ?? null;
      const assignment = e.assignmentId ? assignById.get(e.assignmentId) ?? null : null;
      const p = assignment ? g.projById.get(assignment.projectId) ?? null : null;
      const role = assignment?.crewRoleId ? g.roleById.get(assignment.crewRoleId) ?? null : null;
      return { ...e, date: iso(e.date), createdAt: iso(e.createdAt), updatedAt: iso(e.updatedAt), crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null, assignment: assignment ? { ...isoAssignment(assignment), project: p ? { name: p.name, projectNumber: p.projectNumber } : null, crewRole: role ? { name: role.name } : null } : null };
    });
  },
});

export const activeAssignmentsSummary = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);
    const [g, assignments] = await Promise.all([crewLookups(ctx, orgId), assignmentsByStatus(ctx, orgId, ACTIVE)]);
    return assignments
      .filter((a) => a.endDate == null || a.endDate >= nowMs)
      .sort((a, b) => cmpAscNulls(a.startDate, b.startDate))
      .slice(0, 20)
      .map((a) => {
        const member = g.memberById.get(a.crewMemberId) ?? null;
        const role = a.crewRoleId ? g.roleById.get(a.crewRoleId) ?? null : null;
        const p = g.projById.get(a.projectId) ?? null;
        return { ...isoAssignment(a), crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName } : null, crewRole: role ? { name: role.name } : null, project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber, status: p.status ?? null } : null };
      });
  },
});

export const pendingOffers = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const [g, assignments] = await Promise.all([crewLookups(ctx, orgId), assignmentsByStatus(ctx, orgId, PENDING)]);
    return assignments
      .sort((a, b) => cmpDescNulls(a.createdAt, b.createdAt))
      .slice(0, 15)
      .map((a) => {
        const member = g.memberById.get(a.crewMemberId) ?? null;
        const role = a.crewRoleId ? g.roleById.get(a.crewRoleId) ?? null : null;
        const p = g.projById.get(a.projectId) ?? null;
        return { ...isoAssignment(a), crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName, email: member.email ?? null } : null, crewRole: role ? { name: role.name } : null, project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null };
      });
  },
});

export const upcomingShifts = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId, nowMs }) => {
    await requireOrgRead(ctx, orgId);
    const [g, assignments] = await Promise.all([crewLookups(ctx, orgId), allOrgAssignments(ctx, orgId)]);
    const startOfToday = new Date(nowMs).setHours(0, 0, 0, 0);
    const orgAssignmentIds = new Set(assignments.map((a) => a.id));
    const assignById = new Map(assignments.map((a) => [a.id, a]));
    // crewShifts have no org column — scope via the org's assignment ids. Batched in
    // parallel (R-8.3.2) instead of one sequential round-trip per assignment.
    const shiftLists = await Promise.all(
      Array.from(orgAssignmentIds, (id) => ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect()),
    );
    const shifts = shiftLists.flat();
    return shifts
      .filter((s) => s.status === "SCHEDULED" && s.date >= startOfToday && orgAssignmentIds.has(s.assignmentId))
      .sort((a, b) => cmpAscNulls(a.date, b.date))
      .slice(0, 10)
      .map((s) => {
        const assignment = assignById.get(s.assignmentId) ?? null;
        const member = assignment ? g.memberById.get(assignment.crewMemberId) ?? null : null;
        const role = assignment?.crewRoleId ? g.roleById.get(assignment.crewRoleId) ?? null : null;
        const p = assignment ? g.projById.get(assignment.projectId) ?? null : null;
        return { ...s, date: iso(s.date), assignment: assignment ? { ...isoAssignment(assignment), crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null, crewRole: role ? { name: role.name } : null, project: p ? { name: p.name, projectNumber: p.projectNumber } : null } : null };
      });
  },
});
