/**
 * Exact Undos for the two register writes the Scan page's Test & tag mode offers
 * (`testTagAssetsWrites.undoCreateNative` / `undoReactivateNative`, review SF2). Same
 * shape as Phase 16's other Undos (CLAUDE.md "An exact Undo reads its OWN forward audit
 * row"): ids only; the forward write's own audit row carries `serverSavedAt` (and, for a
 * reactivate, the `before` it overwrote); the Undo refuses as a whole unless it is the
 * author, inside the server-clock window, the first undo, and nothing touched the item
 * since. Every read is org-scoped or org re-checked; bounded. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertWithinUndoWindow } from "./undoWindow";

/** Audit rows scanned for one item's forward write and any earlier UNDO. */
const MAX_ENTITY_ROWS = 50;

export type RegisterUndoKind = "ttCreate" | "ttReactivate";

export interface RegisterUndoDetails {
  kind: RegisterUndoKind;
  serverSavedAt: number;
  /** A reactivate only: the fields it overwrote (`null` = absent). */
  before?: { status: string | null; isActive: boolean | null; updatedAt: number | null };
}

function isDetails(d: unknown, kind: RegisterUndoKind): d is RegisterUndoDetails {
  const x = d as Partial<RegisterUndoDetails> | null;
  return !!x && x.kind === kind && typeof x.serverSavedAt === "number";
}

/** The newest forward row of `kind` for the item, proven undoable by `actorUserId`. */
export async function loadUndoableRegisterWrite(
  ctx: MutationCtx,
  a: { orgId: string; id: string; kind: RegisterUndoKind; actorUserId: string; serverNow: number },
): Promise<{ forward: Doc<"activityLogs">; details: RegisterUndoDetails }> {
  const rows = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", a.orgId).eq("entityType", "testTagAsset").eq("entityId", a.id))
    .order("desc")
    .take(MAX_ENTITY_ROWS);
  const forward = rows.find((r) => isDetails(r.details, a.kind));
  if (!forward || !isDetails(forward.details, a.kind)) throw new ConvexError("This can't be undone");
  if (rows.some((r) => r.action === "UNDO" && (r.details as { undoOf?: string } | undefined)?.undoOf === forward.id)) {
    throw new ConvexError("This was already undone");
  }
  if (forward.userId !== a.actorUserId) throw new ConvexError("Only the person who did this can undo it");
  assertWithinUndoWindow(forward.details.serverSavedAt, a.serverNow, "change");
  return { forward, details: forward.details };
}

/** The item (org-checked), still exactly as the forward write left it: untested and unedited. */
export async function requireUntouchedNewItem(ctx: MutationCtx, orgId: string, id: string, forward: Doc<"activityLogs">): Promise<Doc<"testTagAssets">> {
  const item = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!item || item.organizationId !== orgId) throw new ConvexError("Test tag asset not found");
  if (item.status !== "NOT_YET_TESTED" || item.isActive === false || item.updatedAt !== forward.createdAt) {
    throw new ConvexError("The item changed since: this can't be undone");
  }
  const tested = await ctx.db
    .query("testTagRecords")
    .withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", id))
    .order("desc")
    .first();
  // A new item can only have records made after it; a reactivated one, only those since.
  if (tested && tested._creationTime > forward._creationTime) throw new ConvexError("The item was tested since: this can't be undone");
  return item;
}
