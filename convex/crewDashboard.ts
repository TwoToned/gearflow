import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Browser-direct crew-dashboard reads (Phase 3 — replace getCrewPickerList /
 * getCrewDashboardStats / getPendingTimeEntries / getActiveAssignmentsSummary /
 * getPendingOffers / getUpcomingShifts). All org-scoped; dates → ISO strings. `nowMs` is
 * passed by the client (Convex can't call Date.now()).
 */

const DAY = 86_400_000;
const ACTIVE = new Set(["CONFIRMED", "ACCEPTED"]);
const PENDING = new Set(["PENDING", "OFFERED"]);
const EXCLUDED = new Set(["CANCELLED", "DECLINED"]);
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const cmpAscNulls = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);
const cmpDescNulls = (a: number | null | undefined, b: number | null | undefined) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : b - a);
const cmpStr = (a: string | null | undefined, b: string | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b));

/** The org's crew graph most dashboard reads need. */
async function crewGraph(ctx: QueryCtx, orgId: string) {
  const [members, assignments, roles, projects] = await Promise.all([
    ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
    ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
    ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
    ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: dashboard aggregation (counter candidate)
  ]);
  return {
    members, assignments,
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
    const g = await crewGraph(ctx, orgId);
    const active = g.members.filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE").sort((a, b) => cmpStr(a.firstName, b.firstName) || cmpStr(a.lastName, b.lastName));
    const byMember = new Map<string, typeof g.assignments>();
    for (const a of g.assignments) { const l = byMember.get(a.crewMemberId) ?? []; l.push(a); byMember.set(a.crewMemberId, l); }
    return active.map((m) => {
      const role = m.crewRoleId ? g.roleById.get(m.crewRoleId) ?? null : null;
      const assignments = (byMember.get(m.id) ?? [])
        .filter((a) => !EXCLUDED.has(a.status ?? ""))
        .sort((a, b) => cmpDescNulls(a.startDate, b.startDate))
        .map((a) => { const p = g.projById.get(a.projectId); const aRole = a.crewRoleId ? g.roleById.get(a.crewRoleId) : null; return { ...isoAssignment(a), project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null, crewRole: aRole ? { id: aRole.id, name: aRole.name } : null }; });
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
      pendingOffers: assignments.filter((a) => PENDING.has(a.status ?? "")).length,
      submittedTime: entries.filter((e) => e.status === "SUBMITTED").length,
      hoursThisWeek: entries.filter((e) => (e.status === "APPROVED" || e.status === "EXPORTED") && (e.date ?? 0) >= weekAgo).reduce((s, e) => s + (e.totalHours ?? 0), 0),
    };
  },
});

export const pendingTimeEntries = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const g = await crewGraph(ctx, orgId);
    const entries = await ctx.db.query("crewTimeEntries").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
    const assignById = new Map(g.assignments.map((a) => [a.id, a]));
    return entries
      .filter((e) => e.status === "SUBMITTED")
      .sort((a, b) => cmpDescNulls(a.date, b.date))
      .slice(0, 15)
      .map((e) => {
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
    const g = await crewGraph(ctx, orgId);
    return g.assignments
      .filter((a) => ACTIVE.has(a.status ?? "") && (a.endDate == null || a.endDate >= nowMs))
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
    const g = await crewGraph(ctx, orgId);
    return g.assignments
      .filter((a) => PENDING.has(a.status ?? ""))
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
    const g = await crewGraph(ctx, orgId);
    const startOfToday = new Date(nowMs).setHours(0, 0, 0, 0);
    const orgAssignmentIds = new Set(g.assignments.map((a) => a.id));
    const assignById = new Map(g.assignments.map((a) => [a.id, a]));
    // crewShifts have no org column — scope via the org's assignment ids.
    const shifts: { id: string; assignmentId: string; date: number; status?: string; callTime?: string; endTime?: string; breakMinutes?: number; location?: string; notes?: string }[] = [];
    for (const id of orgAssignmentIds) {
      for (const s of await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect()) shifts.push(s);
    }
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
