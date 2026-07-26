import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Browser-direct crew-availability + planner reads (Phase 3 — replace getCrewAvailability
 * / checkCrewConflicts / getCrewPlannerData). All date fields are epoch-ms on the docs;
 * returned as ISO strings to match the deleted actions' serialized shape. Overlap is
 * inclusive: `startMs <= rangeEnd && endMs >= rangeStart`. Excluded assignment statuses:
 * CANCELLED / DECLINED.
 */

const EXCLUDED = new Set(["CANCELLED", "DECLINED"]);
const overlaps = (aStart: number, aEnd: number, rStart: number, rEnd: number) => aStart <= rEnd && aEnd >= rStart;
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());

async function orgMemberIds(ctx: QueryCtx, orgId: string): Promise<Set<string>> {
  const members = await ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: bounded by the org's crew roster (member-id set) — see docs/exceptions.md R-8.3.3
  return new Set(members.map((m) => m.id));
}

/** A crew member's availability records, optionally overlapping [startMs,endMs], startDate asc. */
export const memberAvailability = query({
  args: { orgId: v.string(), crewMemberId: v.string(), startMs: v.optional(v.number()), endMs: v.optional(v.number()) },
  handler: async (ctx, { orgId, crewMemberId, startMs, endMs }) => {
    await requireOrgRead(ctx, orgId);
    if (!(await orgMemberIds(ctx, orgId)).has(crewMemberId)) throw new ConvexError("Crew member not found");
    const rows = (await ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId)).collect())
      .filter((r) => r.organizationId === orgId);
    const ranged = startMs != null && endMs != null ? rows.filter((r) => overlaps(r.startDate, r.endDate, startMs, endMs)) : rows;
    return ranged
      .sort((a, b) => a.startDate - b.startDate)
      // startDate/endDate are required columns → always non-null ISO strings.
      .map((r) => ({ id: r.id, crewMemberId: r.crewMemberId, startDate: new Date(r.startDate).toISOString(), endDate: new Date(r.endDate).toISOString(), type: r.type ?? "UNAVAILABLE", reason: r.reason ?? null, isAllDay: r.isAllDay ?? true, startTime: r.startTime ?? null, endTime: r.endTime ?? null }));
  },
});

/** Availability + assignment conflicts for a member over [startMs,endMs]. */
export const conflicts = query({
  args: { orgId: v.string(), crewMemberId: v.string(), startMs: v.number(), endMs: v.number(), excludeAssignmentId: v.optional(v.string()) },
  handler: async (ctx, { orgId, crewMemberId, startMs, endMs, excludeAssignmentId }) => {
    await requireOrgRead(ctx, orgId);
    const inOrg = (await orgMemberIds(ctx, orgId)).has(crewMemberId);
    const out: { type: "availability" | "assignment"; severity: "hard" | "soft"; label: string; startDate: string; endDate: string }[] = [];

    const blocks = inOrg
      ? (await ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId)).collect())
          .filter((b) => b.organizationId === orgId && overlaps(b.startDate, b.endDate, startMs, endMs))
      : [];
    for (const b of blocks) {
      const t = b.type ?? "UNAVAILABLE";
      out.push({
        type: "availability",
        severity: t === "UNAVAILABLE" ? "hard" : "soft",
        label: t === "UNAVAILABLE" ? `Unavailable${b.reason ? `: ${b.reason}` : ""}` : t === "TENTATIVE" ? `Tentative${b.reason ? `: ${b.reason}` : ""}` : `Preferred${b.reason ? `: ${b.reason}` : ""}`,
        startDate: new Date(b.startDate).toISOString(),
        endDate: new Date(b.endDate).toISOString(),
      });
    }

    const assignments = (
      await ctx.db.query("crewAssignments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId)).collect()
    ).filter((a) => a.organizationId === orgId && !EXCLUDED.has(a.status ?? "") && a.startDate != null && a.endDate != null && overlaps(a.startDate, a.endDate, startMs, endMs) && (excludeAssignmentId ? a.id !== excludeAssignmentId : true));
    const projById = new Map(
      (
        await Promise.all(
          [...new Set(assignments.map((a) => a.projectId))].map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first()),
        )
      )
        .filter((p): p is NonNullable<typeof p> => p != null && p.organizationId === orgId)
        .map((p) => [p.id, p]),
    );
    for (const a of assignments) {
      const p = projById.get(a.projectId);
      out.push({ type: "assignment", severity: "soft", label: `Already on ${p?.projectNumber ?? ""} - ${p?.name ?? ""}`, startDate: iso(a.startDate) ?? new Date(startMs).toISOString(), endDate: iso(a.endDate) ?? new Date(endMs).toISOString() });
    }
    return out;
  },
});

/** The crew planner grid: active members + their assignments (project/role joins) + availability over [startMs,endMs]. */
export const plannerData = query({
  args: { orgId: v.string(), startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { orgId, startMs, endMs }) => {
    await requireOrgRead(ctx, orgId);
    const [allMembers, roles] = await Promise.all([
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: planner view aggregates the whole crew graph — see docs/exceptions.md R-8.3.3
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: planner view aggregates the whole crew graph — see docs/exceptions.md R-8.3.3
    ]);
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const cmp = (a: string | null | undefined, b: string | null | undefined) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a.localeCompare(b));

    const members = allMembers
      .filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE")
      .sort((a, b) => cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName));

    // Per-member indexed reads (bounded by roster size), not an org-wide collect of
    // two growable tables (crewAssignments/crewAvailabilities accumulate per member
    // over the org's whole history).
    const memberIds = members.map((m) => m.id);
    const [assignmentsByMemberArr, availByMemberArr] = await Promise.all([
      Promise.all(memberIds.map((id) => ctx.db.query("crewAssignments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect())),
      Promise.all(memberIds.map((id) => ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect())),
    ]);
    const assignByMember = new Map(memberIds.map((id, i) => [id, assignmentsByMemberArr[i].filter((a) => a.organizationId === orgId)]));
    const availByMember = new Map(memberIds.map((id, i) => [id, availByMemberArr[i].filter((r) => r.organizationId === orgId)]));

    const referencedProjectIds = [...new Set(assignmentsByMemberArr.flat().map((a) => a.projectId))];
    const projectDocs = await Promise.all(
      referencedProjectIds.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    const projById = new Map(
      projectDocs.filter((p): p is NonNullable<typeof p> => p != null && p.organizationId === orgId).map((p) => [p.id, p]),
    );

    return members.map((m) => {
      const role = m.crewRoleId ? roleById.get(m.crewRoleId) ?? null : null;
      const assignments = (assignByMember.get(m.id) ?? [])
        .filter((a) => !EXCLUDED.has(a.status ?? "") && (a.startDate == null || overlaps(a.startDate, a.endDate ?? a.startDate, startMs, endMs)))
        .map((a) => {
          const p = projById.get(a.projectId) ?? null;
          const aRole = a.crewRoleId ? roleById.get(a.crewRoleId) ?? null : null;
          return { ...a, startDate: iso(a.startDate), endDate: iso(a.endDate), offeredAt: iso(a.offeredAt), respondedAt: iso(a.respondedAt), confirmedAt: iso(a.confirmedAt), createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt), project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber, status: p.status ?? null } : null, crewRole: aRole ? { name: aRole.name, color: aRole.color ?? null } : null };
        });
      const availability = (availByMember.get(m.id) ?? [])
        .filter((r) => overlaps(r.startDate, r.endDate, startMs, endMs))
        .map((r) => ({ ...r, startDate: iso(r.startDate), endDate: iso(r.endDate), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }));
      return { id: m.id, firstName: m.firstName, lastName: m.lastName, department: m.department ?? null, crewRole: role ? { id: role.id, name: role.name, color: role.color ?? null } : null, assignments, availability };
    });
  },
});
