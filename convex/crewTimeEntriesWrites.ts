import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { calculateTotalHours } from "./lib/crewTimeHours";

/**
 * Native CREW-TIME-ENTRY write mutations (Phase 3 browser-direct — replaces
 * createTimeEntry/createTimeEntries/updateTimeEntry/deleteTimeEntry/submitTimeEntries/
 * approveTimeEntries/disputeTimeEntry). 4 guards + per-row org re-check + atomic audit.
 * calculateTotalHours runs in the mutation; the status machine (DRAFT→SUBMITTED→
 * APPROVED/DISPUTED) + the EXPORTED-lock (can't edit/delete exported) live here.
 * exportTimesheetCSV stays server (Node CSV). getTimeEntriesForProject was dead → dropped.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const entryFields = {
  assignmentId: v.optional(v.string()),
  crewMemberId: v.string(),
  description: v.optional(v.string()),
  date: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  breakMinutes: v.optional(v.number()),
  notes: v.optional(v.string()),
};
type EntryArgs = { assignmentId?: string; crewMemberId: string; description?: string; date: number; startTime: string; endTime: string; breakMinutes?: number; notes?: string };

async function memberName(ctx: MutationCtx, orgId: string, crewMemberId: string): Promise<{ ok: boolean; name: string }> {
  const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", crewMemberId)).first();
  if (!m || m.organizationId !== orgId) return { ok: false, name: "crew member" };
  return { ok: true, name: `${m.firstName} ${m.lastName}` };
}

/** Verify an assignment belongs to the org (+ optional member match). Returns the project name. */
async function assignmentProject(ctx: MutationCtx, orgId: string, assignmentId: string, crewMemberId: string | null): Promise<string> {
  const a = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", assignmentId)).first();
  if (!a || a.organizationId !== orgId) throw new ConvexError("Assignment not found");
  if (crewMemberId != null && a.crewMemberId !== crewMemberId) throw new ConvexError("Crew member does not match assignment");
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
  return p && p.organizationId === orgId ? p.name : "General";
}

function buildDoc(a: EntryArgs, orgId: string, id: string, now: number) {
  return {
    id, organizationId: orgId,
    ...(a.assignmentId ? { assignmentId: a.assignmentId } : {}),
    crewMemberId: a.crewMemberId,
    ...(a.description ? { description: a.description } : {}),
    date: a.date, startTime: a.startTime, endTime: a.endTime,
    breakMinutes: a.breakMinutes ?? 0,
    totalHours: calculateTotalHours(a.startTime, a.endTime, a.breakMinutes ?? 0),
    status: "DRAFT" as const,
    ...(a.notes ? { notes: a.notes } : {}),
    createdAt: now, updatedAt: now,
  };
}

async function logTime(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string }) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "crew_time_entry", entityId: a.id,
    entityName: a.name, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...entryFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "create");
    const actor = await resolveActor(ctx, a.actor);

    const dup = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Time entry already exists");
    const member = await memberName(ctx, a.orgId, a.crewMemberId);
    if (!member.ok) throw new ConvexError("Crew member not found");
    let projectName = a.description || "General";
    if (a.assignmentId) projectName = await assignmentProject(ctx, a.orgId, a.assignmentId, a.crewMemberId);

    await ctx.db.insert("crewTimeEntries", buildDoc(a, a.orgId, a.id, a.now));
    await logTime(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: member.name, summary: `Logged time for ${member.name} on ${projectName}` });
    return { id: a.id };
  },
});

export const createManyNative = mutation({
  returns: v.object({ created: v.array(v.string()), errors: v.array(v.object({ crewMemberId: v.string(), message: v.string() })) }),
  args: {
    orgId: v.string(), now: v.number(), actor: actorValidator,
    shared: v.object({ assignmentId: v.optional(v.string()), description: v.optional(v.string()), date: v.number(), startTime: v.string(), endTime: v.string(), breakMinutes: v.optional(v.number()), notes: v.optional(v.string()) }),
    entries: v.array(v.object({ id: v.string(), crewMemberId: v.string(), auditId: v.string() })),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "create");
    const actor = await resolveActor(ctx, a.actor);
    if (a.entries.length === 0) return { created: [], errors: [] };

    // Resolve the assignment once (org-verified); per-crew match checked below.
    let projectName = a.shared.description || "General";
    let assignmentMember: string | null = null;
    if (a.shared.assignmentId) {
      const asg = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", a.shared.assignmentId!)).first();
      if (!asg || asg.organizationId !== a.orgId) throw new ConvexError("Assignment not found");
      assignmentMember = asg.crewMemberId;
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", asg.projectId)).first();
      if (p && p.organizationId === a.orgId) projectName = p.name;
    }

    const created: string[] = [];
    const errors: { crewMemberId: string; message: string }[] = [];
    for (const e of a.entries) {
      const member = await memberName(ctx, a.orgId, e.crewMemberId);
      if (!member.ok) { errors.push({ crewMemberId: e.crewMemberId, message: "Crew member not found" }); continue; }
      if (a.shared.assignmentId && assignmentMember != null && assignmentMember !== e.crewMemberId) { errors.push({ crewMemberId: e.crewMemberId, message: "Crew member does not match assignment" }); continue; }
      await ctx.db.insert("crewTimeEntries", buildDoc({ ...a.shared, crewMemberId: e.crewMemberId }, a.orgId, e.id, a.now));
      await logTime(ctx, { orgId: a.orgId, actor, auditId: e.auditId, now: a.now, action: "CREATE", id: e.id, name: member.name, summary: `Logged time for ${member.name} on ${projectName}` });
      created.push(e.crewMemberId);
    }
    return { created, errors };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...entryFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Time entry not found");
    if (doc.status === "EXPORTED") throw new ConvexError("Cannot edit exported time entries");
    const member = await memberName(ctx, a.orgId, doc.crewMemberId);
    if (a.assignmentId) await assignmentProject(ctx, a.orgId, a.assignmentId, null); // org-verify the (possibly new) assignment

    // Editing resets to DRAFT + clears approval. replace() to unset the optionals.
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = {
      ...rest,
      date: a.date, startTime: a.startTime, endTime: a.endTime, breakMinutes: a.breakMinutes ?? 0,
      totalHours: calculateTotalHours(a.startTime, a.endTime, a.breakMinutes ?? 0),
      status: "DRAFT", updatedAt: a.now,
    };
    delete merged.approvedById; delete merged.approvedAt;
    if (a.assignmentId) merged.assignmentId = a.assignmentId; else delete merged.assignmentId;
    if (a.description) merged.description = a.description; else delete merged.description;
    if (a.notes) merged.notes = a.notes; else delete merged.notes;
    await ctx.db.replace(doc._id, merged as typeof rest);

    await logTime(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: member.name, summary: `Updated time entry for ${member.name}` });
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

    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Time entry not found");
    if (doc.status === "EXPORTED") throw new ConvexError("Cannot delete exported time entries");
    const member = await memberName(ctx, a.orgId, doc.crewMemberId);
    await ctx.db.delete(doc._id);
    await logTime(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: member.name, summary: `Deleted time entry for ${member.name}` });
    return { id: a.id };
  },
});

/** Shared bulk status transition with a from-status eligibility gate (TOCTOU-safe per item). */
async function bulkTransition(ctx: MutationCtx, orgId: string, ids: string[], from: string[], set: Record<string, unknown>): Promise<number> {
  let count = 0;
  const fromSet = new Set(from);
  for (const id of ids) {
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) continue;
    if (!fromSet.has(doc.status ?? "DRAFT")) continue;
    await ctx.db.patch(doc._id, set);
    count++;
  }
  return count;
}

export const submitNative = mutation({
  returns: v.object({ count: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);
    const count = await bulkTransition(ctx, a.orgId, a.ids, ["DRAFT", "DISPUTED"], { status: "SUBMITTED", updatedAt: a.now });
    if (count === 0) throw new ConvexError("No eligible entries found");
    await logTime(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.ids[0], name: `${count} time entries`, summary: `Submitted ${count} time entries for approval` });
    return { count };
  },
});

export const approveNative = mutation({
  returns: v.object({ count: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);
    const count = await bulkTransition(ctx, a.orgId, a.ids, ["SUBMITTED", "DISPUTED"], { status: "APPROVED", approvedById: actor.userId, approvedAt: a.now, updatedAt: a.now });
    if (count === 0) throw new ConvexError("No eligible entries found");
    await logTime(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.ids[0], name: `${count} time entries`, summary: `Approved ${count} time entries` });
    return { count };
  },
});

export const disputeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), reason: v.optional(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Time entry not found");
    if (!["SUBMITTED", "APPROVED"].includes(doc.status ?? "DRAFT")) throw new ConvexError("Can only dispute submitted or approved time entries");
    const member = await memberName(ctx, a.orgId, doc.crewMemberId);
    const nextNotes = a.reason || doc.notes;
    const set: Record<string, unknown> = { status: "DISPUTED", updatedAt: a.now };
    if (nextNotes) { set.notes = nextNotes; await ctx.db.patch(doc._id, set); }
    else {
      const { _id, _creationTime, ...rest } = doc;
      const merged: Record<string, unknown> = { ...rest, ...set }; delete merged.notes;
      await ctx.db.replace(doc._id, merged as typeof rest);
    }
    await logTime(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: member.name, summary: `Disputed time entry for ${member.name}` });
    return { id: a.id };
  },
});
