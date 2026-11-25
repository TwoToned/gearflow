import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { writeActivityLog } from "./audit";
import { assertWithinUndoWindow } from "./undoWindow";
import { undoMarkerId, type FieldValue } from "./fieldEditUndo";

/**
 * The exact Undo of a row being ADDED or REMOVED (the sibling of `fieldEditUndo`, which
 * covers a row's fields). Same shape: the forward write stamps ONE audit row whose
 * `details.rowOp` holds the table, the row id, the author, the SERVER clock and (for a
 * removal) the row as it was; the Undo takes ids only and refuses as a whole unless the row
 * is this org's and entity's, within the window, by the same person, and not yet undone.
 * There is no caller-supplied snapshot.
 *
 * A stored FILE is never deleted or re-created by an Undo: a row that points at a file is
 * only detached or re-attached. (Removing a file-bearing row for good is its own confirmed
 * verb with no Undo, because stored bytes cannot be brought back.)
 */
export interface RowOp {
  op: "add" | "remove";
  table: string;
  rowId: string;
  /** The row as it was, for a removal; `null` for an add. */
  snapshot: Record<string, FieldValue> | null;
  authorId: string;
  serverSavedAt: number;
}

interface Entity {
  orgId: string;
  entityType: string;
  entityId: string;
  entityName: string;
}

/** FORWARD side: call in the same transaction as the add/remove. */
export async function recordRowOp(
  ctx: MutationCtx,
  a: Entity & {
    auditId: string;
    actor: { userId: string; userName: string };
    now: number;
    summary: string;
    action: "CREATE" | "UPDATE" | "DELETE";
    op: Omit<RowOp, "authorId" | "serverSavedAt">;
  },
): Promise<void> {
  const rowOp: RowOp = { ...a.op, authorId: a.actor.userId, serverSavedAt: Date.now() };
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    entityName: a.entityName,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    details: { rowOp },
    createdAt: a.now,
  });
}

/**
 * UNDO side, step 1: validate and CLAIM the forward row (writes the once-only marker). The
 * caller then applies the reverse and, because the whole mutation is one transaction, a
 * failed apply leaves no marker.
 */
export async function claimRowOpUndo(
  ctx: MutationCtx,
  a: Entity & { auditId: string; actor: { userId: string; userName: string }; now: number; table: string },
): Promise<RowOp> {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  if (!row || row.organizationId !== a.orgId || row.entityType !== a.entityType || row.entityId !== a.entityId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That change was not found, so it can't be undone." });
  }
  const rowOp = parseRowOp(row.details, a.table);
  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(a.auditId))).first();
  if (marker && marker.organizationId === a.orgId) throw new ConvexError({ code: "ALREADY_UNDONE", message: "That change was already undone." });
  if (rowOp.authorId !== a.actor.userId) throw new ConvexError({ code: "NOT_AUTHOR", message: "Only the person who made a change can undo it." });
  assertWithinUndoWindow(rowOp.serverSavedAt, Date.now(), "change");
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
    details: { undoOf: a.auditId, rowId: rowOp.rowId },
    createdAt: a.now,
  });
  return rowOp;
}

/** Read `details.rowOp` back, refusing a row that is not a well-formed op on this table. */
function parseRowOp(details: unknown, table: string): RowOp {
  const r = (details as { rowOp?: Partial<RowOp> } | null | undefined)?.rowOp;
  const ok = !!r && (r.op === "add" || r.op === "remove") && r.table === table && typeof r.rowId === "string" && typeof r.authorId === "string" && typeof r.serverSavedAt === "number";
  if (!ok) throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
  return r as RowOp;
}
