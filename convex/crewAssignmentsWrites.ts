import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { bumpCountersForTable } from "./lib/counters";
import { resolveRate, calculateEstimatedCost } from "./lib/crewRate";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen } from "./lib/fieldGuards";
import { recalcProjectTotals, orgDefaultTaxRate } from "./lib/recalc";
import { recalcServiceCostFromCrew, recalcServiceChargeFromCrew } from "./lib/serviceCost";
import * as enums from "./lib/validators";

/**
 * Reject a non-finite OR negative money/hours input before it flows into resolveRate /
 * calculateEstimatedCost → estimatedCost → project labourCostTotal. Convex `v.number()`
 * accepts NaN/Infinity/negatives; a browser-direct caller bypasses the server-side Zod,
 * and a negative/Infinity rate silently poisons the project's margin. `null`/`undefined`
 * skip (unset). */
export function assertCrewMoney(value: number | undefined, field: string): void {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError({ code: "INVALID_NUMBER", message: `${field} must be a non-negative finite number.` });
  }
}

/**
 * Mirrors `crewAssignmentSchema` (src/lib/validations/crew.ts) string-length bounds +
 * its required `crewMemberId` — `v.string()` only enforces type, not these business
 * constraints, so a browser-direct caller bypassing the client Zod parse would
 * otherwise skip them entirely (R-8.6.2).
 */
function assertAssignmentFields(f: { crewMemberId: string; startTime?: string; endTime?: string; notes?: string; internalNotes?: string }): void {
  assertStrLen(f.crewMemberId, "crewMemberId", { min: 1 });
  assertStrLen(f.startTime, "startTime", { max: 5 });
  assertStrLen(f.endTime, "endTime", { max: 5 });
  assertStrLen(f.notes, "notes", { max: 2000 });
  assertStrLen(f.internalNotes, "internalNotes", { max: 2000 });
}

/**
 * Native CREW-ASSIGNMENT + shift write mutations (Phase 3 browser-direct — replaces
 * createAssignment/updateAssignment/updateAssignmentStatus/deleteAssignment/
 * bulkDeleteAssignments/bulkUpdateAssignmentStatus/generateShifts). 4 guards + per-row
 * org re-check + atomic audit + sharded-counter bumps (parity with the service
 * create/patchAssignment/deleteCascade). The rate cascade + estimatedCost run in the
 * mutation (convex/lib/crewRate.ts); the CONFIRMED status-machine stamp fires only on
 * the first PENDING/OFFERED→CONFIRMED edge. updateShift/deleteShift were dead → dropped.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const assignmentFields = {
  crewMemberId: v.string(),
  crewRoleId: v.optional(v.string()),
  serviceId: v.optional(v.string()),
  status: v.optional(enums.AssignmentStatus),
  phase: v.optional(enums.ProjectPhase),
  isProjectManager: v.optional(v.boolean()),
  startDate: v.optional(v.number()),
  startTime: v.optional(v.string()),
  endDate: v.optional(v.number()),
  endTime: v.optional(v.string()),
  rateOverride: v.optional(v.number()),
  rateType: v.optional(enums.CrewRateType),
  estimatedHours: v.optional(v.number()),
  notes: v.optional(v.string()),
  internalNotes: v.optional(v.string()),
};

type RateInputs = { crewMember: { firstName: string; lastName: string; defaultDayRate?: number | null; defaultHourlyRate?: number | null }; crewRole: { defaultRate?: number | null; rateType?: string | null } | null };

export async function rateInputs(ctx: MutationCtx, orgId: string, crewMemberId: string, crewRoleId: string | undefined): Promise<RateInputs> {
  const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", crewMemberId)).first();
  if (!m || m.organizationId !== orgId) throw new ConvexError("Crew member not found");
  let crewRole: RateInputs["crewRole"] = null;
  if (crewRoleId) {
    const r = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", crewRoleId)).first();
    if (r && r.organizationId === orgId) crewRole = { defaultRate: r.defaultRate ?? null, rateType: r.rateType ?? null };
  }
  return { crewMember: { firstName: m.firstName, lastName: m.lastName, defaultDayRate: m.defaultDayRate ?? null, defaultHourlyRate: m.defaultHourlyRate ?? null }, crewRole };
}

async function projectNumber(ctx: MutationCtx, orgId: string, projectId: string): Promise<string> {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  return p && p.organizationId === orgId ? p.projectNumber : "";
}

/** Delete an assignment + its shifts + linked time entries (org-filtered) + counter bump. */
async function cascadeDelete(ctx: MutationCtx, doc: { _id: import("./_generated/dataModel").Id<"crewAssignments">; id: string; organizationId: string }, orgId: string) {
  const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", doc.id)).collect();
  for (const s of shifts) await ctx.db.delete(s._id);
  const entries = (await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", doc.id)).collect())
    .filter((e) => e.organizationId === orgId);
  for (const e of entries) await ctx.db.delete(e._id);
  await ctx.db.delete(doc._id);
  await bumpCountersForTable(ctx, "crewAssignments", doc, null);
}

/** Recalc every service + project touched by a bulk crew delete. Pulled out of
 *  bulkDeleteNative's handler to keep its own complexity down (R-3.6). */
async function recalcAfterBulkDelete(ctx: MutationCtx, orgId: string, serviceIds: Set<string>, projectIds: Set<string>, now: number): Promise<void> {
  for (const serviceId of serviceIds) {
    await recalcServiceCostFromCrew(ctx, serviceId, orgId, now);
    await recalcServiceChargeFromCrew(ctx, serviceId, orgId, now);
  }
  const taxRate = await orgDefaultTaxRate(ctx, orgId);
  for (const projectId of projectIds) await recalcProjectTotals(ctx, projectId, orgId, taxRate, now);
}

async function logAssignment(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; projectId?: string }) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "crew_assignment", entityId: a.id,
    entityName: a.name, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, projectId: a.projectId, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), projectId: v.string(), ...assignmentFields, generateShifts: v.optional(v.boolean()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "create");
    const actor = await resolveActor(ctx, a.actor);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
    if (!project || project.organizationId !== a.orgId) throw new ConvexError("Project not found");
    const dup = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Assignment already exists");

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak) + bound
    // the money inputs (a negative/Infinity rate poisons labourCostTotal → project margin)
    // + the crewAssignmentSchema string-length/required bounds (R-8.6.2).
    if (a.crewRoleId) await assertRefInOrg(ctx, "crewRoles", a.crewRoleId, a.orgId);
    if (a.serviceId) await assertRefInOrg(ctx, "projectServices", a.serviceId, a.orgId);
    assertCrewMoney(a.rateOverride, "rateOverride");
    assertCrewMoney(a.estimatedHours, "estimatedHours");
    assertAssignmentFields(a);

    const { crewMember, crewRole } = await rateInputs(ctx, a.orgId, a.crewMemberId, a.crewRoleId);
    const { rate, rateType } = resolveRate(a.rateOverride, a.rateType ?? null, crewMember, crewRole);
    const estimatedCost = calculateEstimatedCost(rate, rateType, a.startDate ?? null, a.endDate ?? null, a.estimatedHours ?? null);

    const doc = {
      id: a.id, organizationId: a.orgId, projectId: a.projectId, crewMemberId: a.crewMemberId,
      ...(a.crewRoleId ? { crewRoleId: a.crewRoleId } : {}), ...(a.serviceId ? { serviceId: a.serviceId } : {}),
      status: a.status ?? "PENDING", ...(a.phase ? { phase: a.phase } : {}), isProjectManager: a.isProjectManager ?? false,
      ...(a.startDate != null ? { startDate: a.startDate } : {}), ...(a.startTime ? { startTime: a.startTime } : {}),
      ...(a.endDate != null ? { endDate: a.endDate } : {}), ...(a.endTime ? { endTime: a.endTime } : {}),
      ...(a.rateOverride != null ? { rateOverride: a.rateOverride } : {}), ...(a.rateType ? { rateType: a.rateType } : {}),
      ...(a.estimatedHours != null ? { estimatedHours: a.estimatedHours } : {}), estimatedCost,
      ...(a.notes ? { notes: a.notes } : {}), ...(a.internalNotes ? { internalNotes: a.internalNotes } : {}),
      createdAt: a.now, updatedAt: a.now,
    };
    await ctx.db.insert("crewAssignments", doc);
    await bumpCountersForTable(ctx, "crewAssignments", null, doc);

    // Auto-generate one SCHEDULED shift per day in [start,end].
    if (a.generateShifts && a.startDate != null && a.endDate != null) {
      for (let d = a.startDate; d <= a.endDate; d += 86400000) {
        await ctx.db.insert("crewShifts", { id: createId(), assignmentId: a.id, date: d, ...(a.startTime ? { callTime: a.startTime } : {}), ...(a.endTime ? { endTime: a.endTime } : {}), status: "SCHEDULED" });
      }
    }

    // Keep the linked service's costTotal (if any) + project financials in sync —
    // this is the ONLY crew-write path outside projectServicesWrites.ts's own crew
    // reconcile (e.g. the crew-panel dialog linking straight to a service), so it
    // must recalc too (single source of truth, issue #796).
    if (a.serviceId) {
      await recalcServiceCostFromCrew(ctx, a.serviceId, a.orgId, a.now);
      await recalcServiceChargeFromCrew(ctx, a.serviceId, a.orgId, a.now);
    }
    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, a.projectId, a.orgId, taxRate, a.now);

    await logAssignment(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: `${crewMember.firstName} ${crewMember.lastName}`, summary: `Assigned ${crewMember.firstName} ${crewMember.lastName} to ${project.projectNumber}`, projectId: a.projectId });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...assignmentFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Assignment not found");

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak) + bound
    // the money inputs (a negative/Infinity rate poisons labourCostTotal → project margin)
    // + the crewAssignmentSchema string-length/required bounds (R-8.6.2).
    if (a.crewRoleId) await assertRefInOrg(ctx, "crewRoles", a.crewRoleId, a.orgId);
    if (a.serviceId) await assertRefInOrg(ctx, "projectServices", a.serviceId, a.orgId);
    assertCrewMoney(a.rateOverride, "rateOverride");
    assertCrewMoney(a.estimatedHours, "estimatedHours");
    assertAssignmentFields(a);

    const { crewMember, crewRole } = await rateInputs(ctx, a.orgId, doc.crewMemberId, a.crewRoleId);
    const { rate, rateType } = resolveRate(a.rateOverride, a.rateType ?? null, crewMember, crewRole);
    const estimatedCost = calculateEstimatedCost(rate, rateType, a.startDate ?? null, a.endDate ?? null, a.estimatedHours ?? null);

    const status = a.status ?? "PENDING";
    const stampConfirmed = status === "CONFIRMED" && !doc.confirmedAt;
    const set: Record<string, unknown> = { status, isProjectManager: a.isProjectManager ?? false, estimatedCost, updatedAt: a.now };
    const clearKeys = ["crewRoleId", "serviceId", "phase", "startDate", "startTime", "endDate", "endTime", "rateOverride", "rateType", "estimatedHours", "notes", "internalNotes"];
    const present: Record<string, unknown> = {
      crewRoleId: a.crewRoleId, serviceId: a.serviceId, phase: a.phase, startDate: a.startDate, startTime: a.startTime,
      endDate: a.endDate, endTime: a.endTime, rateOverride: a.rateOverride, rateType: a.rateType, estimatedHours: a.estimatedHours,
      notes: a.notes, internalNotes: a.internalNotes,
    };
    const clear: string[] = [];
    for (const k of clearKeys) { const val = present[k]; if (val == null || val === "") clear.push(k); else set[k] = val; }
    if (stampConfirmed) { set.confirmedAt = a.now; set.confirmedById = actor.userId; }

    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) delete merged[k];
    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "crewAssignments", doc, merged);

    // Recalc whichever service(s) this assignment is/was linked to (a rate/serviceId
    // change can affect the OLD link's rollup too, e.g. re-linking to a different
    // service) + the project totals. Single source of truth, issue #796.
    const oldServiceId = doc.serviceId ?? null;
    const newServiceId = a.serviceId ?? null;
    if (oldServiceId) {
      await recalcServiceCostFromCrew(ctx, oldServiceId, a.orgId, a.now);
      await recalcServiceChargeFromCrew(ctx, oldServiceId, a.orgId, a.now);
    }
    if (newServiceId && newServiceId !== oldServiceId) {
      await recalcServiceCostFromCrew(ctx, newServiceId, a.orgId, a.now);
      await recalcServiceChargeFromCrew(ctx, newServiceId, a.orgId, a.now);
    }
    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, doc.projectId, a.orgId, taxRate, a.now);

    const pn = await projectNumber(ctx, a.orgId, doc.projectId);
    await logAssignment(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: `${crewMember.firstName} ${crewMember.lastName}`, summary: `Updated assignment for ${crewMember.firstName} ${crewMember.lastName} on ${pn}`, projectId: doc.projectId });
    return { id: a.id };
  },
});

export const updateStatusNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), status: enums.AssignmentStatus, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Assignment not found");
    const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", doc.crewMemberId)).first();
    if (!m || m.organizationId !== a.orgId) throw new ConvexError("Crew member not found");

    const patch: Record<string, unknown> = { status: a.status, updatedAt: a.now };
    if (a.status === "CONFIRMED" && !doc.confirmedAt) { patch.confirmedAt = a.now; patch.confirmedById = actor.userId; }
    await ctx.db.patch(doc._id, patch);
    await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...patch });

    const pn = await projectNumber(ctx, a.orgId, doc.projectId);
    await logAssignment(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "STATUS_CHANGE", id: a.id, name: `${m.firstName} ${m.lastName}`, summary: `Changed ${m.firstName} ${m.lastName} status to ${a.status} on ${pn}`, projectId: doc.projectId });
    return { id: a.id };
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Assignment not found");
    const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", doc.crewMemberId)).first();
    const name = m && m.organizationId === a.orgId ? `${m.firstName} ${m.lastName}` : "";
    const pn = await projectNumber(ctx, a.orgId, doc.projectId);
    const serviceId = doc.serviceId ?? null;
    await cascadeDelete(ctx, doc, a.orgId);
    if (serviceId) {
      await recalcServiceCostFromCrew(ctx, serviceId, a.orgId, a.now);
      await recalcServiceChargeFromCrew(ctx, serviceId, a.orgId, a.now);
    }
    const taxRate = await orgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, doc.projectId, a.orgId, taxRate, a.now);
    await logAssignment(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name, summary: `Removed ${name} from ${pn}`, projectId: doc.projectId });
    return { id: a.id };
  },
});

export const bulkDeleteNative = mutation({
  returns: v.object({ deleted: v.number(), skipped: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "delete");
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { deleted: 0, skipped: 0 };

    let deleted = 0, skipped = 0;
    const projectIds = new Set<string>();
    const serviceIds = new Set<string>();
    for (const id of a.ids) {
      const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) { skipped++; continue; }
      projectIds.add(doc.projectId);
      if (doc.serviceId) serviceIds.add(doc.serviceId);
      await cascadeDelete(ctx, doc, a.orgId);
      deleted++;
    }
    if (deleted > 0) {
      await recalcAfterBulkDelete(ctx, a.orgId, serviceIds, projectIds, a.now);
      await logAssignment(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.ids[0], name: `${deleted} assignment${deleted === 1 ? "" : "s"}`, summary: `Removed ${deleted} crew assignment${deleted === 1 ? "" : "s"}`, projectId: [...projectIds][0] });
    }
    return { deleted, skipped };
  },
});

export const bulkStatusNative = mutation({
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), status: enums.AssignmentStatus, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { updated: 0, skipped: 0 };

    let updated = 0, skipped = 0;
    const projectIds = new Set<string>();
    for (const id of a.ids) {
      const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) { skipped++; continue; }
      const patch: Record<string, unknown> = { status: a.status, updatedAt: a.now };
      if (a.status === "CONFIRMED" && !doc.confirmedAt) { patch.confirmedAt = a.now; patch.confirmedById = actor.userId; }
      await ctx.db.patch(doc._id, patch);
      await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...patch });
      projectIds.add(doc.projectId);
      updated++;
    }
    if (updated > 0) await logAssignment(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "STATUS_CHANGE", id: a.ids[0], name: `${updated} assignment${updated === 1 ? "" : "s"}`, summary: `Changed ${updated} crew assignment${updated === 1 ? "" : "s"} to ${a.status}`, projectId: [...projectIds][0] });
    return { updated, skipped };
  },
});

// generateShifts is no-audit (parity — the old action logged none), so resolveActor omitted.
export const generateShiftsNative = mutation({
  returns: v.object({ count: v.number() }),
  args: { assignmentId: v.string(), orgId: v.string() },
  handler: async (ctx, { assignmentId, orgId }) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "crew", "update");

    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", assignmentId)).first();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Assignment not found");
    if (doc.startDate == null || doc.endDate == null) throw new ConvexError("Assignment must have start and end dates to generate shifts");

    // Delete existing SCHEDULED shifts (preserve non-SCHEDULED), then regenerate.
    const existing = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", assignmentId)).collect();
    for (const s of existing) if ((s.status ?? "SCHEDULED") === "SCHEDULED") await ctx.db.delete(s._id);

    let count = 0;
    for (let d = doc.startDate; d <= doc.endDate; d += 86400000) {
      await ctx.db.insert("crewShifts", { id: createId(), assignmentId, date: d, ...(doc.startTime ? { callTime: doc.startTime } : {}), ...(doc.endTime ? { endTime: doc.endTime } : {}), status: "SCHEDULED" });
      count++;
    }
    return { count };
  },
});
