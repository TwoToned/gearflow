/**
 * The ONE helper for an EXACT field-edit Undo (UX unification, Phases 9, 12, 13, 14).
 *
 * The shape (the same one `checkRecordWrites.undoAdHocCheckNative` and the plan
 * Undo use, factored so a new edit sheet never hand-rolls a second one, R-3.1):
 *
 *  - The FORWARD edit calls `recordFieldEdit` in its own transaction: ONE audit row
 *    whose `details.fieldEdit` holds the before/after of ONLY the fields that
 *    changed, the author and the SERVER clock (`serverSavedAt`).
 *  - The UNDO takes ids only (`auditId`). `undoFieldEdit` reads that row and
 *    refuses as a whole, changing nothing, unless: the row is this org's and
 *    this entity type's; it is within `UNDO_WINDOW_MS` on the server clock; the
 *    caller is the person who made the edit; it has not been undone (an
 *    `undo:<auditId>` marker row); and EVERY changed field still holds exactly the
 *    value the forward edit left (a per-field compare-and-set: a later edit by
 *    anyone is never clobbered).
 *  - Nothing the client sends decides what is restored. There is no
 *    caller-supplied "restore to" value.
 *
 * ABA is deliberate: if someone changes a field and then changes it BACK to what the
 * forward edit left, the compare-and-set passes. The state being restored from equals
 * the state the forward edit produced, so the Undo is still exact.
 *
 * An absent field is stored as `null` in the snapshot (Convex documents cannot hold
 * `undefined`) and an absent doc field equals `null`; restoring `null` CLEARS the
 * field. A file field is never deleted by an Undo: it only changes which file a
 * field points at.
 *
 * Pure part (`diffFields`, `planFieldEditUndo`) has no Convex dependency and is
 * unit-tested directly; the mutation-side wrappers do the reads and writes.
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { writeActivityLog } from "./audit";
import { assertWithinUndoWindow } from "./undoWindow";

export type FieldValue = string | number | boolean | null | FieldValue[] | { [k: string]: FieldValue };

/** What the forward edit stored in its audit row's `details.fieldEdit`. */
export interface FieldEditSnapshot {
  /** Only the fields that changed, value before (absent = `null`). */
  before: Record<string, FieldValue>;
  /** Only the fields that changed, value after (absent = `null`). */
  after: Record<string, FieldValue>;
  /** Server `Date.now()` at the forward write, never the caller's `now`. */
  serverSavedAt: number;
  /** The verified author (`resolveActor().userId`). */
  authorId: string;
}

export const undoMarkerId = (auditId: string) => `undo:${auditId}`;

/** `undefined` and absent are `null`; everything else is itself. */
const norm = (v: unknown): FieldValue => (v === undefined ? null : (v as FieldValue));

/** Structural equality over plain Convex values (objects are key-order independent). */
export function sameValue(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
  return Array.isArray(x) || Array.isArray(y) ? sameArray(x, y) : sameObject(x, y);
}

function sameArray(x: object, y: object): boolean {
  if (!Array.isArray(x) || !Array.isArray(y)) return false;
  return x.length === y.length && x.every((item, i) => sameValue(item, y[i]));
}

function sameObject(x: object, y: object): boolean {
  const ox = x as Record<string, unknown>;
  const oy = y as Record<string, unknown>;
  const kx = Object.keys(ox);
  return kx.length === Object.keys(oy).length && kx.every((k) => k in oy && sameValue(ox[k], oy[k]));
}

/**
 * The fields of `fields` whose value differs between `current` (the doc as read)
 * and `next` (the doc after the edit). `null`/absent are the same. Returns `null`
 * when nothing changed, so the caller can toast `nothing changed` with no Undo.
 */
export function diffFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[],
): { before: Record<string, FieldValue>; after: Record<string, FieldValue> } | null {
  const before: Record<string, FieldValue> = {};
  const after: Record<string, FieldValue> = {};
  for (const f of fields) {
    if (sameValue(current[f], next[f])) continue;
    before[f] = norm(current[f]);
    after[f] = norm(next[f]);
  }
  return Object.keys(after).length === 0 ? null : { before, after };
}

export interface FieldEditUndoPlan {
  /** Fields to set back to their prior (non-null) value. */
  set: Record<string, FieldValue>;
  /** Fields that were absent before: clear them. */
  clear: string[];
}

/**
 * Decide an Undo from facts only. Throws a `ConvexError({ code })` for each refusal
 * (`UNDO_EXPIRED` is thrown by the window helper as a plain message), changing
 * nothing; returns the exact patch otherwise.
 */
export function planFieldEditUndo(args: {
  snapshot: FieldEditSnapshot;
  current: Record<string, unknown>;
  actorId: string;
  serverNow: number;
  alreadyUndone: boolean;
}): FieldEditUndoPlan {
  const { snapshot, current, actorId, serverNow, alreadyUndone } = args;
  if (alreadyUndone) throw new ConvexError({ code: "ALREADY_UNDONE", message: "That change was already undone." });
  if (snapshot.authorId !== actorId) {
    throw new ConvexError({ code: "NOT_AUTHOR", message: "Only the person who made a change can undo it." });
  }
  assertWithinUndoWindow(snapshot.serverSavedAt, serverNow, "change");
  const moved = Object.keys(snapshot.after).filter((f) => !sameValue(current[f], snapshot.after[f]));
  if (moved.length > 0) {
    throw new ConvexError({
      code: "CHANGED_SINCE",
      message: `Can't undo: ${moved.join(", ")} changed since.`,
      fields: moved,
    });
  }
  const set: Record<string, FieldValue> = {};
  const clear: string[] = [];
  for (const [f, was] of Object.entries(snapshot.before)) {
    if (was === null) clear.push(f);
    else set[f] = was;
  }
  return { set, clear };
}

/** Read `details.fieldEdit` back, rejecting a row that is not a field-edit row. */
export function readSnapshot(details: unknown): FieldEditSnapshot | null {
  const s = (details as { fieldEdit?: Partial<FieldEditSnapshot> } | null | undefined)?.fieldEdit;
  if (!s || typeof s.authorId !== "string" || typeof s.serverSavedAt !== "number" || !s.before || !s.after) return null;
  return s as FieldEditSnapshot;
}

interface AuditEntityArgs {
  orgId: string;
  entityType: string;
  entityId: string;
  entityName: string;
}

/**
 * FORWARD side. Call in the SAME transaction as the edit, after computing the diff
 * with `diffFields`. Writes the one audit row `undoFieldEdit` later reads.
 */
export async function recordFieldEdit(
  ctx: MutationCtx,
  a: AuditEntityArgs & {
    auditId: string;
    actor: { userId: string; userName: string };
    summary: string;
    diff: { before: Record<string, FieldValue>; after: Record<string, FieldValue> };
    /** The caller's `now` for `createdAt` parity with its other rows. */
    now: number;
    /** Extra audit columns (`projectId`, `assetId`, `kitId`) for the existing filters. */
    links?: { projectId?: string; assetId?: string; kitId?: string };
  },
): Promise<void> {
  const fieldEdit: FieldEditSnapshot = {
    before: a.diff.before,
    after: a.diff.after,
    serverSavedAt: Date.now(),
    authorId: a.actor.userId,
  };
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: "UPDATE",
    entityType: a.entityType,
    entityId: a.entityId,
    entityName: a.entityName,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    details: { fieldEdit },
    createdAt: a.now,
    ...a.links,
  });
}

/**
 * UNDO side. Ids only. `load` returns the entity's CURRENT doc (the caller org-checks
 * it: `by_cuid` is global) or `null`; `apply` writes the exact patch the plan
 * produced (set + clear) and bumps whatever counters / `updatedAt` the entity's own
 * edit path does. The marker row is the Undo's own audit row, written last, so a
 * failed apply leaves no marker.
 */
export async function undoFieldEdit<Doc extends Record<string, unknown>>(
  ctx: MutationCtx,
  a: AuditEntityArgs & {
    auditId: string;
    actor: { userId: string; userName: string };
    now: number;
    load: () => Promise<Doc | null>;
    apply: (doc: Doc, plan: FieldEditUndoPlan) => Promise<void>;
  },
): Promise<{ restored: string[] }> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  // `by_cuid` is global: the row must be this org's, for this entity.
  if (!row || row.organizationId !== a.orgId || row.entityType !== a.entityType || row.entityId !== a.entityId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That change was not found, so it can't be undone." });
  }
  const snapshot = readSnapshot(row.details);
  if (!snapshot) throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });

  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(a.auditId))).first();
  const doc = await a.load();
  if (!doc) throw new ConvexError({ code: "NOT_FOUND", message: "That record no longer exists." });
  // Defence in depth: `by_cuid` is global, so never rely on a caller's `load` having org-checked.
  const docOrg = (doc as { organizationId?: unknown }).organizationId;
  if (docOrg != null && docOrg !== a.orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That record no longer exists." });
  }

  const plan = planFieldEditUndo({
    snapshot,
    current: doc,
    actorId: a.actor.userId,
    serverNow: Date.now(),
    alreadyUndone: !!marker && marker.organizationId === a.orgId,
  });
  await a.apply(doc, plan);

  await writeActivityLog(ctx, {
    id: undoMarkerId(a.auditId),
    organizationId: a.orgId,
    action: "UPDATE",
    entityType: a.entityType,
    entityId: a.entityId,
    entityName: a.entityName,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: `Undid a change to ${a.entityName}`,
    details: { undoOf: a.auditId, restored: Object.keys(snapshot.before) },
    createdAt: a.now,
  });
  return { restored: Object.keys(snapshot.before) };
}
