import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { loadMaintenanceRecord, maintenanceWritePrelude } from "./lib/maintenanceRecordAccess";
import { assertAuditIdFree, writeActivityLog } from "./lib/audit";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import { MAX_MAINTENANCE_MONEY } from "./lib/maintenanceCost";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { sameValue, undoMarkerId, type FieldValue } from "./lib/fieldEditUndo";

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * Maintenance PARTS (UX Phase 14, 14b-3, D76): rows on a maintenance record (name, supplier, quantity, unit price, ETA,
 * arrived). The record's cost is DERIVED from them (`convex/lib/maintenanceCost.ts`), never stored. Browser-direct
 * writes, all gated as a maintenance update, each ONE audit row on the RECORD, each with an exact Undo (`undoNative`:
 * ids only, the author, inside the 10-minute server-clock window, once, and only while the part is exactly as the
 * write left it).
 *
 * Money follows the job-cost line (CLAUDE.md "Two money lines"): a caller who cannot see job cost can add and edit
 * parts but cannot set or clear a price: a price they send is ignored, and an add stores no price.
 */

const MAX_PARTS = 200;
/** The client mints a part's id (a cuid is ~25 characters); bounded so a caller cannot store an arbitrary blob as a key. */
const MAX_PART_ID_LENGTH = 64;
export const PART_FIELDS = ["name", "supplierName", "quantity", "unitPrice", "etaDate", "arrivedAt", "sortOrder"] as const;
/** Fields a form edit may CLEAR (the rest are required). */
const CLEARABLE = ["supplierName", "unitPrice", "etaDate", "arrivedAt"] as const;

type PartFields = Record<string, FieldValue>;
type PartOp = "add" | "edit" | "remove" | "arrive";
/** What a forward write stores in its audit row's `details.partOp`. */
interface PartOpDetails {
  op: PartOp;
  partId: string;
  before: PartFields | null;
  after: PartFields | null;
  /** `arrive` only: this write also moved the record Awaiting parts → In progress (the record's stamp after it). */
  advancedStamp?: number;
  serverSavedAt: number;
  authorId: string;
}

const partSet = v.object({
  name: v.optional(v.string()),
  supplierName: v.optional(v.string()),
  quantity: v.optional(v.number()),
  unitPrice: v.optional(v.number()),
  etaDate: v.optional(v.number()),
  arrivedAt: v.optional(v.number()),
});
type PartSet = { name?: string; supplierName?: string; quantity?: number; unitPrice?: number; etaDate?: number; arrivedAt?: number };

function assertPartFields(f: PartSet): void {
  assertStrLen(f.name, "name", { min: 1, max: 200 });
  assertStrLen(f.supplierName, "supplier", { max: 200 });
  assertNumRange(f.quantity, "quantity", { min: 1, max: 100_000, integer: true });
  assertNumRange(f.unitPrice, "unit price", { min: 0, max: MAX_MAINTENANCE_MONEY });
  assertNumRange(f.etaDate, "ETA", {});
  assertNumRange(f.arrivedAt, "arrived", {});
}

const fieldsOf = (p: Record<string, unknown>): PartFields => Object.fromEntries(PART_FIELDS.map((f) => [f, (p[f] ?? null) as FieldValue]));

const loadRecord = loadMaintenanceRecord;

/** The part (by_cuid is global: it must be this org's AND this record's). */
async function loadPart(ctx: MutationCtx, orgId: string, recordId: string, partId: string): Promise<Doc<"maintenanceParts"> | null> {
  const p = await ctx.db.query("maintenanceParts").withIndex("by_cuid", (q) => q.eq("id", partId)).first();
  return p && p.organizationId === orgId && p.maintenanceRecordId === recordId ? p : null;
}

async function requirePart(ctx: MutationCtx, orgId: string, recordId: string, partId: string): Promise<Doc<"maintenanceParts">> {
  const p = await loadPart(ctx, orgId, recordId, partId);
  if (!p) throw new ConvexError("Part not found");
  return p;
}

async function partsOf(ctx: MutationCtx, orgId: string, recordId: string): Promise<Doc<"maintenanceParts">[]> {
  const rows = await ctx.db.query("maintenanceParts").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId)).take(MAX_PARTS + 1);
  return rows.filter((r) => r.organizationId === orgId);
}

const prelude = maintenanceWritePrelude;

/** ONE audit row on the record with the op's snapshot, and the record's `updatedAt` bumped (a worked-on record is not "untouched"). */
async function recordPartOp(
  ctx: MutationCtx,
  a: { rec: Doc<"maintenanceRecords">; actor: { userId: string; userName: string }; auditId: string; now: number; summary: string; op: PartOp; partId: string; before: PartFields | null; after: PartFields | null; advanced?: boolean },
): Promise<void> {
  await assertAuditIdFree(ctx, a.auditId);
  const details: PartOpDetails = {
    op: a.op, partId: a.partId, before: a.before, after: a.after,
    ...(a.advanced ? { advancedStamp: a.now } : {}),
    serverSavedAt: Date.now(), authorId: a.actor.userId,
  };
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.rec.organizationId, action: "UPDATE", entityType: "maintenance", entityId: a.rec.id,
    entityName: a.rec.title, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: { partOp: details }, createdAt: a.now,
  });
}

/** A price from a caller who cannot see job cost is dropped (never a way to read or rewrite money). */
const withoutPrice = (set: PartSet): PartSet => {
  const { unitPrice: _dropped, ...rest } = set; // the KEY is removed: an `undefined` value would override the stored price when spread
  void _dropped;
  return rest;
};

// ─── add ─────────────────────────────────────────────────────────────────────
export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), recordId: v.string(), id: v.string(), part: partSet, actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    const actor = await prelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadRecord(ctx, a.orgId, a.recordId);
    assertStrLen(a.id, "part id", { min: 1, max: MAX_PART_ID_LENGTH });
    const name = a.part.name?.trim();
    if (!name) throw new ConvexError({ code: "INVALID_FIELD", message: "A part needs a name." });
    const fields: PartSet = (await canSeeJobCost(ctx, a.orgId)) ? { ...a.part, name } : { ...withoutPrice(a.part), name };
    assertPartFields({ ...fields, quantity: fields.quantity ?? 1 });
    const existing = (await partsOf(ctx, a.orgId, a.recordId)).length;
    if (existing >= MAX_PARTS) throw new ConvexError({ code: "TOO_MANY_PARTS", message: `A job can have at most ${MAX_PARTS} parts.` });
    if (await ctx.db.query("maintenanceParts").withIndex("by_cuid", (q) => q.eq("id", a.id)).first()) throw new ConvexError("Part already exists");

    const doc = { id: a.id, organizationId: a.orgId, maintenanceRecordId: a.recordId, ...fields, name, quantity: fields.quantity ?? 1, sortOrder: existing, createdAt: a.now, updatedAt: a.now };
    await ctx.db.insert("maintenanceParts", doc);
    await ctx.db.patch(rec._id, { updatedAt: a.now });
    await recordPartOp(ctx, { rec, actor, auditId: a.auditId, now: a.now, summary: `Added part ${name} to ${rec.title}`, op: "add", partId: a.id, before: null, after: fieldsOf(doc) });
    return { id: a.id };
  },
});

// ─── edit ────────────────────────────────────────────────────────────────────
export const editNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean() }),
  args: { orgId: v.string(), recordId: v.string(), id: v.string(), set: partSet, clear: v.array(v.string()), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    const actor = await prelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadRecord(ctx, a.orgId, a.recordId);
    const part = await requirePart(ctx, a.orgId, a.recordId, a.id);
    const seesCost = await canSeeJobCost(ctx, a.orgId);
    const set = seesCost ? a.set : withoutPrice(a.set);
    const clear = a.clear.filter((f) => seesCost || f !== "unitPrice");
    if (clear.some((f) => !(CLEARABLE as readonly string[]).includes(f))) throw new ConvexError({ code: "INVALID_FIELD", message: "That field can't be cleared." });
    if (set.name !== undefined && !set.name.trim()) throw new ConvexError({ code: "INVALID_FIELD", message: "A part needs a name." });
    assertPartFields(set);

    const next: Record<string, unknown> = { ...part, ...set, ...(set.name !== undefined ? { name: set.name.trim() } : {}) };
    for (const f of clear) delete next[f];
    const before = fieldsOf(part);
    const after = fieldsOf(next);
    if (sameValue(before, after)) return { id: a.id, changed: false };
    await ctx.db.replace(part._id, { ...stripSystem(next), updatedAt: a.now } as never);
    await ctx.db.patch(rec._id, { updatedAt: a.now });
    await recordPartOp(ctx, { rec, actor, auditId: a.auditId, now: a.now, summary: `Edited part ${part.name} on ${rec.title}`, op: "edit", partId: a.id, before, after });
    return { id: a.id, changed: true };
  },
});

/** A doc as `replace` takes it: no `_id` / `_creationTime`. */
function stripSystem(d: Record<string, unknown>): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = d;
  void _id;
  void _creationTime;
  return rest;
}

// ─── remove ──────────────────────────────────────────────────────────────────
export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), recordId: v.string(), id: v.string(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    const actor = await prelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadRecord(ctx, a.orgId, a.recordId);
    const part = await requirePart(ctx, a.orgId, a.recordId, a.id);
    const before = fieldsOf(part);
    await ctx.db.delete(part._id);
    await ctx.db.patch(rec._id, { updatedAt: a.now });
    await recordPartOp(ctx, { rec, actor, auditId: a.auditId, now: a.now, summary: `Removed part ${part.name} from ${rec.title}`, op: "remove", partId: a.id, before, after: null });
    return { id: a.id };
  },
});

// ─── mark arrived ────────────────────────────────────────────────────────────
/**
 * Marks a part arrived. When it was the LAST part on order and the job is Awaiting parts, the job moves to In progress
 * (both are holding statuses, so no asset changes). `advanced` tells the toast; the Undo reverses both.
 */
export const markArrivedNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean(), advanced: v.boolean() }),
  args: { orgId: v.string(), recordId: v.string(), id: v.string(), arrivedAt: v.number(), actor: actorValidator, auditId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    const actor = await prelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadRecord(ctx, a.orgId, a.recordId);
    const part = await requirePart(ctx, a.orgId, a.recordId, a.id);
    assertNumRange(a.arrivedAt, "arrived", {});
    if (part.arrivedAt != null) return { id: a.id, changed: false, advanced: false };
    const siblings = (await partsOf(ctx, a.orgId, a.recordId)).filter((p) => p.id !== a.id);
    const advanced = (rec.status ?? "SCHEDULED") === "AWAITING_PARTS" && siblings.every((p) => p.arrivedAt != null);
    const before = fieldsOf(part);
    await ctx.db.patch(part._id, { arrivedAt: a.arrivedAt, updatedAt: a.now });
    await ctx.db.patch(rec._id, { updatedAt: a.now, ...(advanced ? { status: "IN_PROGRESS" as const } : {}) });
    await recordPartOp(ctx, {
      rec, actor, auditId: a.auditId, now: a.now, op: "arrive", partId: a.id, before, after: { ...before, arrivedAt: a.arrivedAt }, advanced,
      summary: advanced ? `Part ${part.name} arrived: ${rec.title} is back In progress` : `Part ${part.name} arrived on ${rec.title}`,
    });
    return { id: a.id, changed: true, advanced };
  },
});

// ─── undo ────────────────────────────────────────────────────────────────────
function readOp(details: unknown): PartOpDetails | null {
  const d = (details as { partOp?: Partial<PartOpDetails> } | null | undefined)?.partOp;
  if (!d || typeof d.partId !== "string" || typeof d.authorId !== "string" || typeof d.serverSavedAt !== "number") return null;
  return d as PartOpDetails;
}

const refuse = (code: string, message: string) => new ConvexError({ code, message });

/** Reverse the part half of a write, refusing (changing nothing) unless the part is exactly as the write left it. */
async function reversePart(ctx: MutationCtx, a: { orgId: string; recordId: string; d: PartOpDetails; now: number }): Promise<void> {
  const { d } = a;
  const part = await loadPart(ctx, a.orgId, a.recordId, d.partId);
  if (d.op === "remove") {
    if (part) throw refuse("CHANGED_SINCE", "Can't undo: that part was added again since.");
    // Exact restore: `before` is the stored snapshot of the removed part, so it carries its price EVEN when this caller
    // cannot see job cost. That is deliberate and not a leak: the caller only puts back what the author's own remove took
    // (author-only, in the window, read server-side from the audit row), never reads it, and dropping the price here
    // would make the Undo silently destroy money data. The price stays absent from every read this caller makes.
    const present = Object.fromEntries(Object.entries(d.before ?? {}).filter(([, val]) => val !== null));
    await ctx.db.insert("maintenanceParts", { ...present, id: d.partId, organizationId: a.orgId, maintenanceRecordId: a.recordId, createdAt: a.now, updatedAt: a.now } as never);
    return;
  }
  if (!part || !sameValue(fieldsOf(part), d.after)) throw refuse("CHANGED_SINCE", "Can't undo: that part changed since.");
  if (d.op === "add") {
    await ctx.db.delete(part._id);
    return;
  }
  await ctx.db.replace(part._id, { ...stripSystem(withBefore(part, d.before!)), updatedAt: a.now } as never);
}

/** The part doc with every field set back to its `before` value (a `null` before clears the field). */
function withBefore(part: Doc<"maintenanceParts">, before: PartFields): Record<string, unknown> {
  const out: Record<string, unknown> = { ...part };
  for (const f of PART_FIELDS) {
    if (before[f] === null) delete out[f];
    else out[f] = before[f];
  }
  return out;
}

/** The forward row this Undo reverses, proven undoable by `actorUserId`: this org's and record's, not undone, the author, inside the window. */
async function loadUndoablePartOp(ctx: MutationCtx, a: { orgId: string; recordId: string; auditId: string; actorUserId: string }): Promise<PartOpDetails> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  if (!row || row.organizationId !== a.orgId || row.entityType !== "maintenance" || row.entityId !== a.recordId) throw refuse("NOT_FOUND", "That change was not found, so it can't be undone.");
  const d = readOp(row.details);
  if (!d) throw refuse("NOT_UNDOABLE", "That change can't be undone.");
  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(a.auditId))).first();
  if (marker) throw refuse("ALREADY_UNDONE", "That change was already undone.");
  if (d.authorId !== a.actorUserId) throw refuse("NOT_AUTHOR", "Only the person who made a change can undo it.");
  assertWithinUndoWindow(d.serverSavedAt, Date.now(), "change");
  return d;
}

export const undoNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), recordId: v.string(), auditId: v.string(), actor: actorValidator, now: v.number() },
  handler: async (ctx, a) => {
    const actor = await prelude(ctx, a.actor, () => requireOrgPermission(ctx, a.orgId, "maintenance", "update"));
    const rec = await loadRecord(ctx, a.orgId, a.recordId);
    const d = await loadUndoablePartOp(ctx, { orgId: a.orgId, recordId: a.recordId, auditId: a.auditId, actorUserId: actor.userId });

    if (d.advancedStamp !== undefined) {
      if ((rec.status ?? "SCHEDULED") !== "IN_PROGRESS" || rec.updatedAt !== d.advancedStamp) throw refuse("CHANGED_SINCE", "Can't undo: the job moved on since.");
      await ctx.db.patch(rec._id, { status: "AWAITING_PARTS" });
    }
    await reversePart(ctx, { orgId: a.orgId, recordId: a.recordId, d, now: a.now });
    await ctx.db.patch(rec._id, { updatedAt: a.now });
    await writeActivityLog(ctx, {
      id: undoMarkerId(a.auditId), organizationId: a.orgId, action: "UPDATE", entityType: "maintenance", entityId: a.recordId, entityName: rec.title,
      userId: actor.userId, userName: actor.userName, summary: `Undid a part change on ${rec.title}`, details: { undoOf: a.auditId }, createdAt: a.now,
    });
    return { id: a.recordId };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addNative: { danger: "low", summary: "Add a part (name, supplier, quantity, price, ETA) to a maintenance job." },
  editNative: { danger: "low", summary: "Edit or clear a part's fields on a maintenance job (a price needs job-cost visibility)." },
  removeNative: { danger: "medium", summary: "Remove a part from a maintenance job." },
  markArrivedNative: { danger: "low", summary: "Mark a part arrived; the last one moves an Awaiting parts job to In progress." },
  undoNative: { danger: "high", summary: "Exactly undo a recent part change by its audit id (refuses if the part changed since)." },
};
