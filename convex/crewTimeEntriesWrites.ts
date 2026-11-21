import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { assertBulkSizeOk, enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { calculateTotalHours } from "./lib/crewTimeHours";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { QUERY_REASON_MAX } from "./lib/timeEntryQuery";
import { TIME_ENTRY_TRANSITION_FROM, TIME_ENTRY_TRANSITION_TO, type TimeEntryTransition } from "./lib/timeEntryTransitions";

/**
 * Native CREW-TIME-ENTRY write mutations (Phase 3 browser-direct — replaces
 * createTimeEntry/createTimeEntries/updateTimeEntry/deleteTimeEntry/submitTimeEntries/
 * approveTimeEntries/disputeTimeEntry). 4 guards + per-row org re-check + atomic audit.
 * calculateTotalHours runs in the mutation; the status machine (DRAFT→SUBMITTED→
 * APPROVED/DISPUTED) + the EXPORTED-lock (can't edit/delete exported) live here.
 * exportTimesheetCSV stays server (Node CSV). getTimeEntriesForProject was dead → dropped.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const entryFields = {
  assignmentId: v.optional(v.string()),
  crewMemberId: v.string(),
  description: v.optional(v.string()),
  date: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  breakMinutes: v.optional(v.number()),
  notes: v.optional(v.string()),
  // Work-layer Phase 4 (#1246) — optional link to a crew-assigned work item
  // (`projectTasks`) so its peek can show logged minutes. Read-side feature;
  // the approval/dispute/export lifecycle below is otherwise untouched.
  workItemId: v.optional(v.string()),
};
type EntryArgs = { assignmentId?: string; crewMemberId: string; description?: string; date: number; startTime: string; endTime: string; breakMinutes?: number; notes?: string; workItemId?: string };

/**
 * Mirrors `crewTimeEntrySchema` (src/lib/validations/crew.ts) string-length +
 * `breakMinutes` bounds shared by every entry in a batch — `v.string()`/`v.number()`
 * only enforce type, not these business constraints, so a browser-direct caller
 * bypassing the client Zod parse would otherwise skip them entirely (R-8.6.2).
 */
function assertTimeEntrySharedFields(f: { description?: string; startTime: string; endTime: string; breakMinutes?: number; notes?: string }): void {
  assertStrLen(f.description, "description", { max: 500 });
  assertStrLen(f.startTime, "startTime", { min: 1, max: 5 });
  assertStrLen(f.endTime, "endTime", { min: 1, max: 5 });
  assertNumRange(f.breakMinutes, "breakMinutes", { min: 0, integer: true });
  assertStrLen(f.notes, "notes", { max: 2000 });
}

/** Adds the per-entry required `crewMemberId` check on top of the shared bounds. */
function assertTimeEntryFields(f: EntryArgs): void {
  assertStrLen(f.crewMemberId, "crewMemberId", { min: 1 });
  assertTimeEntrySharedFields(f);
}

/** Org-validate an optional `workItemId` FK (by_cuid is GLOBAL — cross-org refs
 *  leak). Extracted so the branch lives here, not in each handler (R-3.6). */
async function assertWorkItemRefIfSet(ctx: MutationCtx, orgId: string, workItemId: string | undefined): Promise<void> {
  if (workItemId) await assertRefInOrg(ctx, "projectTasks", workItemId, orgId);
}

/** Set `target[key]` when `value` is truthy, else delete it — the "resend the
 *  whole form" convention every optional string field on an update follows.
 *  Extracted so `updateNative` calls it once per field instead of repeating
 *  the if/else branch (R-3.6 — each inline branch counted toward its
 *  handler's cyclomatic complexity). */
function setOrClear(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value) target[key] = value;
  else delete target[key];
}

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
    ...(a.workItemId ? { workItemId: a.workItemId } : {}),
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
    assertTimeEntryFields(a); // R-8.6.2 — crewTimeEntrySchema bounds
    await assertWorkItemRefIfSet(ctx, a.orgId, a.workItemId);
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
    shared: v.object({ assignmentId: v.optional(v.string()), description: v.optional(v.string()), date: v.number(), startTime: v.string(), endTime: v.string(), breakMinutes: v.optional(v.number()), notes: v.optional(v.string()), workItemId: v.optional(v.string()) }),
    entries: v.array(v.object({ id: v.string(), crewMemberId: v.string(), auditId: v.string() })),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "create");
    const actor = await resolveActor(ctx, a.actor);
    if (a.entries.length === 0) return { created: [], errors: [] };
    assertTimeEntrySharedFields(a.shared); // R-8.6.2 — bounds shared across the whole batch
    await assertWorkItemRefIfSet(ctx, a.orgId, a.shared.workItemId);

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
      assertStrLen(e.crewMemberId, "crewMemberId", { min: 1 }); // R-8.6.2 — per-item required check
      const member = await memberName(ctx, a.orgId, e.crewMemberId);
      if (!member.ok) { errors.push({ crewMemberId: e.crewMemberId, message: "Crew member not found" }); continue; }
      if (a.shared.assignmentId && assignmentMember != null && assignmentMember !== e.crewMemberId) { errors.push({ crewMemberId: e.crewMemberId, message: "Crew member does not match assignment" }); continue; }
      // Idempotent on the client-minted cuid (parity with the old createIfMissing) — a
      // retried batch can't double-insert. by_cuid is GLOBAL, so only a same-org hit is a
      // genuine retry → skip as success; a foreign-org id fails closed (never suppress the
      // insert on a cross-tenant collision, which would silently drop the real entry).
      const dup = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", e.id)).first();
      if (dup) {
        if (dup.organizationId === a.orgId) { created.push(e.crewMemberId); continue; }
        errors.push({ crewMemberId: e.crewMemberId, message: "Duplicate id" }); continue;
      }
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
    assertTimeEntryFields(a); // R-8.6.2 — crewTimeEntrySchema bounds on the incoming patch
    await assertWorkItemRefIfSet(ctx, a.orgId, a.workItemId);
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
    setOrClear(merged, "assignmentId", a.assignmentId);
    setOrClear(merged, "description", a.description);
    setOrClear(merged, "notes", a.notes);
    setOrClear(merged, "workItemId", a.workItemId);
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

// ─── Bulk status transitions with an exact Undo (UX Phase 15, D47) ─────────────
//
// Submit, Approve and Query move a set of entries from an eligible status to a
// target one. Each changed entry gets its OWN activity row (bulk writes log one
// row per record), and that row records the entry's prior state in `metadata`.
// `revertNative` — the one Undo for all three — reads the prior state back from
// those server-written rows, never from the caller, so an Undo can only restore
// what the forward write actually replaced.

type Transition = TimeEntryTransition;

/** Marks an activity row as a transition record `revertNative` may read back. */
export const TIME_ENTRY_TRANSITION_KIND = "time_entry_transition";

// The one from/to table (convex/lib/timeEntryTransitions.ts), shared with the timesheet row menu.
const TRANSITION_FROM = TIME_ENTRY_TRANSITION_FROM;
const TRANSITION_TO = TIME_ENTRY_TRANSITION_TO;
const TRANSITION_VERB: Record<Transition, string> = { submit: "Submitted", approve: "Approved", query: "Queried" };
const TRANSITION_NOUN: Record<Transition, string> = { submit: "submission", approve: "approval", query: "query" };

type EntryDoc = NonNullable<Awaited<ReturnType<typeof findEntry>>>;
type EntryFields = Omit<EntryDoc, "_id" | "_creationTime">;

async function findEntry(ctx: MutationCtx, id: string) {
  return await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).first();
}

/** The fields a transition replaces, as they stand before it. Absent fields stay absent. */
function priorState(doc: EntryDoc): Record<string, unknown> {
  const prior: Record<string, unknown> = { prevStatus: doc.status ?? "DRAFT" };
  if (doc.queryReason != null) prior.prevQueryReason = doc.queryReason;
  if (doc.approvedById != null) prior.prevApprovedById = doc.approvedById;
  if (doc.approvedAt != null) prior.prevApprovedAt = doc.approvedAt;
  return prior;
}

/** The entry after `transition`. `queryReason` is set by Query and cleared by Submit/Approve (D47). */
function transitioned(doc: EntryDoc, t: Transition, actorId: string, now: number, reason: string | undefined): EntryFields {
  const { _id, _creationTime, ...rest } = doc;
  void _id; void _creationTime;
  const next: EntryFields = { ...rest, status: TRANSITION_TO[t] as EntryFields["status"], updatedAt: now };
  delete next.queryReason;
  if (t === "query") next.queryReason = reason;
  if (t === "approve") { next.approvedById = actorId; next.approvedAt = now; }
  return next;
}

/**
 * Apply `t` to every eligible in-org entry of `ids` and write one activity row
 * per changed entry (`${auditId}:${entryId}`, metadata = the prior state).
 * Ineligible or foreign ids are skipped, as the from-gate always did.
 */
async function applyTransition(
  ctx: MutationCtx,
  a: { orgId: string; ids: string[]; t: Transition; actor: Actor; auditId: string; now: number; reason?: string },
): Promise<string[]> {
  await assertBulkSizeOk(ctx, a.ids.length);
  const from = new Set(TRANSITION_FROM[a.t]);
  const changed: string[] = [];
  for (const id of new Set(a.ids)) {
    const doc = await findEntry(ctx, id);
    if (!doc || doc.organizationId !== a.orgId || !from.has(doc.status ?? "DRAFT")) continue;
    await ctx.db.replace(doc._id, transitioned(doc, a.t, a.actor.userId, a.now, a.reason));
    const member = await memberName(ctx, a.orgId, doc.crewMemberId);
    await writeActivityLog(ctx, {
      id: `${a.auditId}:${id}`, organizationId: a.orgId, action: "UPDATE", entityType: "crew_time_entry", entityId: id,
      entityName: member.name, userId: a.actor.userId, userName: a.actor.userName, createdAt: a.now,
      summary: `${TRANSITION_VERB[a.t]} time entry for ${member.name}${a.reason ? `: ${a.reason}` : ""}`,
      metadata: { kind: TIME_ENTRY_TRANSITION_KIND, transition: a.t, ...priorState(doc) },
    });
    changed.push(id);
  }
  if (changed.length === 0) throw new ConvexError("No eligible entries found");
  return changed;
}

const transitionArgs = { orgId: v.string(), ids: v.array(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() };
const transitionReturns = v.object({ count: v.number(), changed: v.array(v.string()) });

async function guardTransition(ctx: MutationCtx, orgId: string, supplied: Actor): Promise<Actor> {
  await assertWritesEnabled(ctx, "crew");
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, "crew", "update");
  return await resolveActor(ctx, supplied);
}

/** DRAFT/DISPUTED → SUBMITTED. Clears `queryReason`. Undo: `revertNative({ transition: "submit" })`. */
export const submitNative = mutation({
  returns: transitionReturns,
  args: transitionArgs,
  handler: async (ctx, a) => {
    const actor = await guardTransition(ctx, a.orgId, a.actor);
    const changed = await applyTransition(ctx, { orgId: a.orgId, ids: a.ids, t: "submit", actor, auditId: a.auditId, now: a.now });
    return { count: changed.length, changed };
  },
});

/** SUBMITTED/DISPUTED → APPROVED with the approver stamp. Clears `queryReason`. Undo: `revertNative({ transition: "approve" })`. */
export const approveNative = mutation({
  returns: transitionReturns,
  args: transitionArgs,
  handler: async (ctx, a) => {
    const actor = await guardTransition(ctx, a.orgId, a.actor);
    const changed = await applyTransition(ctx, { orgId: a.orgId, ids: a.ids, t: "approve", actor, auditId: a.auditId, now: a.now });
    return { count: changed.length, changed };
  },
});

/**
 * Query… (D47; enum stays `DISPUTED`): SUBMITTED/APPROVED → DISPUTED, storing
 * WHY on `queryReason` — never on `notes`, the crew member's own text. The
 * reason is required and bounded here as well as in the client schema
 * (R-8.6.2). Undo: `revertNative({ transition: "query" })`.
 */
export const queryNative = mutation({
  returns: transitionReturns,
  args: { ...transitionArgs, reason: v.string() },
  handler: async (ctx, a) => {
    const actor = await guardTransition(ctx, a.orgId, a.actor);
    const reason = a.reason.trim();
    assertStrLen(reason, "queryReason", { min: 1, max: QUERY_REASON_MAX });
    const changed = await applyTransition(ctx, { orgId: a.orgId, ids: a.ids, t: "query", actor, auditId: a.auditId, now: a.now, reason });
    return { count: changed.length, changed };
  },
});

/** The prior state a forward transition recorded on its activity row (`applyTransition`). */
interface TransitionRecord {
  transition: Transition;
  prevStatus?: string;
  prevQueryReason?: string;
  prevApprovedById?: string;
  prevApprovedAt?: number;
}

const isTransition = (t: unknown): t is Transition => t === "submit" || t === "approve" || t === "query";

/**
 * The forward write's own activity row for `id` at `stamp` by `userId` — the
 * latest one whose transition produced the entry's CURRENT status. Which
 * transition it was comes from that server-written row, never from the caller.
 */
async function transitionRecord(ctx: MutationCtx, orgId: string, id: string, stamp: number, userId: string, currentStatus: string): Promise<TransitionRecord | null> {
  const rows = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "crew_time_entry").eq("entityId", id))
    .order("desc")
    .take(50);
  const row = rows.find((r) => {
    const m = r.metadata as { kind?: string; transition?: unknown } | undefined;
    return r.createdAt === stamp && r.userId === userId && m?.kind === TIME_ENTRY_TRANSITION_KIND
      && isTransition(m.transition) && TRANSITION_TO[m.transition] === currentStatus;
  });
  return (row?.metadata ?? null) as TransitionRecord | null;
}

/** Set `key` to `value`, or remove it when the prior state had none. */
function restoreField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value == null) delete target[key];
  else target[key] = value;
}

/** The entry with the fields its transition replaced put back exactly as the forward write recorded them. */
function restored(doc: EntryDoc, prior: TransitionRecord, now: number): EntryFields {
  const { _id, _creationTime, ...rest } = doc;
  void _id; void _creationTime;
  const next: Record<string, unknown> = { ...rest, status: prior.prevStatus, updatedAt: now };
  restoreField(next, "queryReason", prior.prevQueryReason);
  if (prior.transition === "approve") {
    restoreField(next, "approvedById", prior.prevApprovedById);
    restoreField(next, "approvedAt", prior.prevApprovedAt);
  }
  return next as EntryFields;
}

/** Every refusal `revertNative` can raise for one entry before its record is read; null when it may proceed. */
function revertRefusal(doc: EntryDoc | null, orgId: string, stamp: number): string | null {
  if (!doc || doc.organizationId !== orgId) return "Time entry not found";
  if (doc.updatedAt !== stamp) return "This time entry changed after that write, so it can't be undone";
  return null;
}

/** A record is replayable only if its prior status is one its transition may start from. */
function replayable(prior: TransitionRecord | null): prior is TransitionRecord & { prevStatus: string } {
  return !!prior?.prevStatus && TRANSITION_FROM[prior.transition].includes(prior.prevStatus);
}

/**
 * The ONE Undo for Submit, Approve and Query (Q-I4). Takes ONLY the entry ids
 * and the forward write's `now` (its stamp) — no transition, no prior status.
 * For each entry it reads which transition ran and the prior state (status,
 * query reason, approver) from that write's own activity row (same entry, same
 * stamp, same user, producing the entry's current status), and refuses the
 * whole Undo with a ConvexError if any entry's `updatedAt` moved since — so it
 * reverses exactly the forward write, never "whatever looks reversible".
 */
export const revertNative = mutation({
  returns: v.object({ count: v.number() }),
  args: { orgId: v.string(), ids: v.array(v.string()), stamp: v.number(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    const actor = await guardTransition(ctx, a.orgId, a.actor);
    await assertBulkSizeOk(ctx, a.ids.length);
    const ids = [...new Set(a.ids)];
    for (const id of ids) {
      const doc = await findEntry(ctx, id);
      const refusal = revertRefusal(doc, a.orgId, a.stamp);
      if (refusal) throw new ConvexError(refusal);
      const prior = await transitionRecord(ctx, a.orgId, id, a.stamp, actor.userId, doc!.status ?? "DRAFT");
      if (!replayable(prior)) throw new ConvexError("Nothing to undo for this time entry");
      await ctx.db.replace(doc!._id, restored(doc!, prior, a.now));
      const member = await memberName(ctx, a.orgId, doc!.crewMemberId);
      await logTime(ctx, { orgId: a.orgId, actor, auditId: `${a.auditId}:${id}`, now: a.now, action: "UPDATE", id, name: member.name, summary: `Undid the ${TRANSITION_NOUN[prior.transition]} of a time entry for ${member.name}` });
    }
    return { count: ids.length };
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
    // `reason` is written straight onto `notes` below — bound it to the same cap
    // crewTimeEntrySchema's `notes` enforces (R-8.6.2).
    assertStrLen(a.reason, "notes", { max: 2000 });
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

export const agentOps: AgentOpsAnnotations = {
  // Stamps approvedById/approvedAt, moving hours into the state that feeds
  // payroll/billing exports — financial-adjacent. The only un-approve path is
  // revertNative's exact, same-user Undo of one approve call, so it stays high.
  approveNative: { danger: "high" },
  createManyNative: { danger: "medium" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  // Just flags a SUBMITTED/APPROVED entry back for review — reversible via
  // submitNative/approveNative, no data destroyed. Legacy: the Query… verb
  // (queryNative) replaces it; Phase 13 retires it with the crew dashboard.
  disputeNative: { danger: "low" },
  // Query… (D47) — flags entries back to the crew member with a reason.
  // Reversible (revertNative), no data destroyed; same tier as disputeNative.
  queryNative: { danger: "low" },
  // The exact Undo of submit/approve/query: restores only what that forward
  // write recorded, refuses if anything changed since. Un-approving moves hours
  // OUT of the payroll-feeding state, so medium, not low.
  revertNative: { danger: "medium" },
  submitNative: { danger: "medium" },
  updateNative: { danger: "medium" },
};
