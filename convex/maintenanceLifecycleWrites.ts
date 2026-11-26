import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertAuditIdFree, writeActivityLog } from "./lib/audit";
import { assertNumRange } from "./lib/fieldGuards";
import { MAX_MAINTENANCE_MONEY } from "./lib/maintenanceCost";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { sameValue, undoMarkerId, type FieldValue } from "./lib/fieldEditUndo";
import { isOpenMaintenance } from "./lib/maintenanceOpen";
import { loadMaintenanceRecord, maintenanceWritePrelude } from "./lib/maintenanceRecordAccess";
import * as enums from "./lib/validators";
import { applyAssetDispositions, existingLinks, holdAssets } from "./maintenanceWrites";

/**
 * Complete and Reopen a maintenance job (UX Phase 14, 14b-3, §9n.3). Both are VERBS on the record, not an edit of
 * its fields:
 *
 *  - **Complete** writes the outcome (result, completed date, labour, next due), then applies a per-asset
 *    disposition: the server DEFAULTS each asset from the result (Fail keeps it out of service, anything else
 *    returns it to service) and the caller may override any of them (Retire is terminal). Cost is never written:
 *    it is derived (parts + labour, `lib/maintenanceCost.ts`); `labour` is the one stored number.
 *  - **Reopen** moves a COMPLETED job back to In progress, clearing the completion, and puts the assets it released
 *    back on hold.
 *
 * Both leave ONE audit row holding the record's before/after fields AND exactly the assets the write moved
 * (status before and after). `undoNative` takes ids only and reverses that row, refusing as a whole, changing
 * nothing, unless it is the author, inside the 10-minute server-clock window, the first Undo, and the record and
 * every moved asset are still exactly as the write left them. Retiring an asset is terminal: that Complete is not
 * undoable (`undoable: false`, the toast offers no Undo).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const RECORD_FIELDS = ["status", "result", "completedDate", "cost", "nextDueDate"] as const;

type Fields = Record<string, FieldValue>;
interface AssetChange {
  assetId: string;
  statusBefore: string | null;
  updatedAtBefore: number | null;
  statusAfter: string | null;
  updatedAtAfter: number | null;
}
interface LifecycleDetails {
  op: "complete" | "reopen";
  before: Fields;
  after: Fields;
  /** The record's `updatedAt` after the write: any later write to the record moves it. */
  stamp: number;
  assets: AssetChange[];
  undoable: boolean;
  serverSavedAt: number;
  authorId: string;
}

const statusOf = (r: { status?: string | null }) => r.status ?? "SCHEDULED";
const fieldsOf = (r: Record<string, unknown>): Fields => Object.fromEntries(RECORD_FIELDS.map((f) => [f, (r[f] ?? null) as FieldValue]));
const refuse = (code: string, message: string) => new ConvexError({ code, message });

type AssetState = { status: string | null; updatedAt: number | null };

async function readAssets(ctx: MutationCtx, orgId: string, ids: string[]): Promise<Map<string, AssetState>> {
  const out = new Map<string, AssetState>();
  for (const id of ids) {
    const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (a && a.organizationId === orgId) out.set(id, { status: a.status ?? null, updatedAt: a.updatedAt ?? null });
  }
  return out;
}

/** The assets whose status or stamp the write moved. */
function changedAssets(before: Map<string, AssetState>, after: Map<string, AssetState>): AssetChange[] {
  const out: AssetChange[] = [];
  for (const [assetId, b] of before) {
    const n = after.get(assetId);
    if (!n || (n.status === b.status && n.updatedAt === b.updatedAt)) continue;
    out.push({ assetId, statusBefore: b.status, updatedAtBefore: b.updatedAt, statusAfter: n.status, updatedAtAfter: n.updatedAt });
  }
  return out;
}

type Disposition = "RETURN_TO_SERVICE" | "KEEP_OUT_OF_SERVICE" | "RETIRE";

/** Every linked asset gets a disposition: the caller's choice, else the default the result implies. A named asset that is not linked is refused. */
function resolveDispositions(assetIds: string[], given: { assetId: string; disposition: Disposition }[], result: string): { assetId: string; disposition: Disposition }[] {
  const linked = new Set(assetIds);
  const chosen = new Map<string, Disposition>();
  for (const d of given) {
    if (!linked.has(d.assetId)) throw refuse("INVALID_FIELD", "That asset is not on this job.");
    chosen.set(d.assetId, d.disposition);
  }
  const fallback: Disposition = result === "FAIL" ? "KEEP_OUT_OF_SERVICE" : "RETURN_TO_SERVICE";
  return assetIds.map((assetId) => ({ assetId, disposition: chosen.get(assetId) ?? fallback }));
}

async function recordLifecycle(
  ctx: MutationCtx,
  a: { rec: Doc<"maintenanceRecords">; actor: { userId: string; userName: string }; auditId: string; now: number; summary: string; d: Omit<LifecycleDetails, "serverSavedAt" | "authorId"> },
): Promise<void> {
  await assertAuditIdFree(ctx, a.auditId);
  const details: LifecycleDetails = { ...a.d, serverSavedAt: Date.now(), authorId: a.actor.userId };
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.rec.organizationId, action: "UPDATE", entityType: "maintenance", entityId: a.rec.id, entityName: a.rec.title,
    userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: { lifecycle: details }, createdAt: a.now,
  });
}

const nullableNumber = v.optional(v.union(v.number(), v.null()));

// ─── complete ────────────────────────────────────────────────────────────────
/** The distinct assets a job holds (its LINK rows; check-off progress rows are not holds). */
async function linkedAssetIds(ctx: MutationCtx, recordId: string): Promise<string[]> {
  const links = await existingLinks(ctx, recordId);
  return [...new Set(links.map((l) => l.assetId).filter((x): x is string => x != null))];
}

/** A doc with its `undefined` fields dropped (an absent field and an `undefined` one are the same state). */
function withoutUndefined<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, val]) => val !== undefined)) as T;
}

/**
 * What a completion writes on the record: the outcome, plus labour only for a caller who sees job cost (absent
 * leaves it, `null` clears it) and next due (absent leaves it, `null` clears it).
 */
function completionPatch(a: { result: string; completedDate: number; now: number; labour?: number | null; nextDueDate?: number | null }, seesCost: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: "COMPLETED", result: a.result, completedDate: a.completedDate, updatedAt: a.now };
  if (a.labour !== undefined && seesCost) patch.cost = a.labour ?? undefined;
  if (a.nextDueDate !== undefined) patch.nextDueDate = a.nextDueDate ?? undefined;
  return patch;
}

export const completeNative = mutation({
  returns: v.object({ id: v.string(), undoable: v.boolean() }),
  args: {
    orgId: v.string(),
    id: v.string(),
    result: enums.MaintenanceResult,
    completedDate: v.number(),
    /** The stored labour: absent leaves it, `null` clears it (blank is not $0). Ignored for a caller who cannot see job cost. */
    labour: nullableNumber,
    /** Absent leaves it, `null` clears it. */
    nextDueDate: nullableNumber,
    dispositions: v.optional(v.array(v.object({ assetId: v.string(), disposition: enums.MaintenanceAssetDisposition }))),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    const actor = await maintenanceWritePrelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadMaintenanceRecord(ctx, a.orgId, a.id);
    if (!isOpenMaintenance(statusOf(rec))) throw refuse("NOT_OPEN", "Only an open job can be completed.");
    assertNumRange(a.completedDate, "completed date", {});
    assertNumRange(a.labour ?? undefined, "labour", { min: 0, max: MAX_MAINTENANCE_MONEY });
    assertNumRange(a.nextDueDate ?? undefined, "next due", {});

    const assetIds = await linkedAssetIds(ctx, a.id);
    const dispositions = resolveDispositions(assetIds, a.dispositions ?? [], a.result);
    const before = await readAssets(ctx, a.orgId, assetIds);
    await applyAssetDispositions(ctx, a.orgId, dispositions, a.id, a.now, actor, a.auditId);
    const assets = changedAssets(before, await readAssets(ctx, a.orgId, assetIds));

    const patch = completionPatch(a, await canSeeJobCost(ctx, a.orgId));
    await ctx.db.patch(rec._id, patch);
    const after = withoutUndefined({ ...rec, ...patch });
    const undoable = !dispositions.some((d) => d.disposition === "RETIRE");
    await recordLifecycle(ctx, {
      rec, actor, auditId: a.auditId, now: a.now, summary: `Completed maintenance record: ${rec.title}`,
      d: { op: "complete", before: fieldsOf(rec), after: fieldsOf(after), stamp: a.now, assets, undoable },
    });
    return { id: a.id, undoable };
  },
});

// ─── reopen ──────────────────────────────────────────────────────────────────
export const reopenNative = mutation({
  returns: v.object({ id: v.string(), undoable: v.boolean() }),
  args: { orgId: v.string(), id: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    const actor = await maintenanceWritePrelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadMaintenanceRecord(ctx, a.orgId, a.id);
    if (statusOf(rec) !== "COMPLETED") throw refuse("NOT_COMPLETED", "Only a completed job can be reopened.");
    const assetIds = await linkedAssetIds(ctx, a.id);
    const before = await readAssets(ctx, a.orgId, assetIds);
    await holdAssets(ctx, a.orgId, assetIds, a.now);
    const assets = changedAssets(before, await readAssets(ctx, a.orgId, assetIds));

    await ctx.db.patch(rec._id, { status: "IN_PROGRESS", completedDate: undefined, result: undefined, updatedAt: a.now });
    const after = { ...rec, status: "IN_PROGRESS" } as Record<string, unknown>;
    delete after.completedDate;
    delete after.result;
    await recordLifecycle(ctx, {
      rec, actor, auditId: a.auditId, now: a.now, summary: `Reopened maintenance record: ${rec.title}`,
      d: { op: "reopen", before: fieldsOf(rec), after: fieldsOf(after), stamp: a.now, assets, undoable: true },
    });
    return { id: a.id, undoable: true };
  },
});

// ─── undo ────────────────────────────────────────────────────────────────────
function readLifecycle(details: unknown): LifecycleDetails | null {
  const d = (details as { lifecycle?: Partial<LifecycleDetails> } | null | undefined)?.lifecycle;
  if (!d || typeof d.authorId !== "string" || typeof d.serverSavedAt !== "number" || !d.before || !d.after || !Array.isArray(d.assets)) return null;
  return d as LifecycleDetails;
}

/** Reads only: throws unless the record and every moved asset are exactly as the write left them. */
async function assertUnchangedSince(ctx: MutationCtx, orgId: string, rec: Doc<"maintenanceRecords">, d: LifecycleDetails): Promise<void> {
  if (rec.updatedAt !== d.stamp || !sameValue(fieldsOf(rec), d.after)) throw refuse("CHANGED_SINCE", "Can't undo: the job changed since.");
  const now = await readAssets(ctx, orgId, d.assets.map((x) => x.assetId));
  for (const c of d.assets) {
    const cur = now.get(c.assetId);
    if (!cur || cur.status !== c.statusAfter || cur.updatedAt !== c.updatedAtAfter) throw refuse("CHANGED_SINCE", "Can't undo: an asset on the job changed since.");
  }
}

/**
 * The forward row this Undo reverses, proven undoable by `actorUserId` (this org's, this record's, not undone, the
 * author, undoable, inside the window) and the record and every moved asset still exactly as it left them. Reads only.
 */
async function loadUndoableLifecycle(ctx: MutationCtx, a: { orgId: string; id: string; auditId: string; actorUserId: string }, rec: Doc<"maintenanceRecords">): Promise<LifecycleDetails> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  if (!row || row.organizationId !== a.orgId || row.entityType !== "maintenance" || row.entityId !== a.id) throw refuse("NOT_FOUND", "That change was not found, so it can't be undone.");
  const d = readLifecycle(row.details);
  if (!d) throw refuse("NOT_UNDOABLE", "That change can't be undone.");
  if (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(a.auditId))).first()) throw refuse("ALREADY_UNDONE", "That change was already undone.");
  if (d.authorId !== a.actorUserId) throw refuse("NOT_AUTHOR", "Only the person who made a change can undo it.");
  if (!d.undoable) throw refuse("NOT_UNDOABLE", "Retiring an asset can't be undone.");
  assertWithinUndoWindow(d.serverSavedAt, Date.now(), "change");
  await assertUnchangedSince(ctx, a.orgId, rec, d);
  return d;
}

/** Put the record's fields and exactly the moved assets back to what the write found. */
async function restoreLifecycle(ctx: MutationCtx, rec: Doc<"maintenanceRecords">, d: LifecycleDetails, now: number): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: now };
  for (const f of RECORD_FIELDS) patch[f] = d.before[f] === null ? undefined : d.before[f];
  await ctx.db.patch(rec._id, patch);
  for (const c of d.assets) {
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", c.assetId)).first();
    if (asset) await ctx.db.patch(asset._id, { status: (c.statusBefore ?? undefined) as never, updatedAt: c.updatedAtBefore ?? undefined });
  }
}

export const undoNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), id: v.string(), auditId: v.string(), actor: actorValidator, now: v.number() },
  handler: async (ctx, a) => {
    const actor = await maintenanceWritePrelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadMaintenanceRecord(ctx, a.orgId, a.id);
    const d = await loadUndoableLifecycle(ctx, { orgId: a.orgId, id: a.id, auditId: a.auditId, actorUserId: actor.userId }, rec);
    await restoreLifecycle(ctx, rec, d, a.now);
    await writeActivityLog(ctx, {
      id: undoMarkerId(a.auditId), organizationId: a.orgId, action: "UPDATE", entityType: "maintenance", entityId: a.id, entityName: rec.title,
      userId: actor.userId, userName: actor.userName, summary: `Undid ${d.op === "complete" ? "completing" : "reopening"} ${rec.title}`, details: { undoOf: a.auditId }, createdAt: a.now,
    });
    return { id: a.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  completeNative: { danger: "high", summary: "Complete a maintenance job: result, date, labour, next due, and a per-asset disposition (defaults from the result; Retire is terminal)." },
  reopenNative: { danger: "medium", summary: "Reopen a completed maintenance job (back to In progress; released assets go back on hold)." },
  undoNative: { danger: "high", summary: "Exactly undo a recent Complete or Reopen by its audit id (refuses if the job or an asset it moved changed since)." },
};
