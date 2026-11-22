/**
 * Phase 16 (overseer Q2/Q10): the "before/after" snapshot a T&T save writes into its
 * own audit row, and the checks its exact Undo (`testTagRecordsWrites.undoCreateNative`)
 * runs before it reverses anything. The snapshot is server-written in the forward
 * transaction — the Undo takes only ids and never a caller-supplied prior value.
 *
 * Undo is allowed only:
 *  - within the shared `UNDO_WINDOW_MS` (`./undoWindow`) of the save, measured on the
 *    SERVER clock the save stamped (`serverSavedAt`), never the caller's `now`;
 *  - by the person who saved it, once;
 *  - while nothing references the record: it is still the asset's newest record and
 *    the T&T asset (and any inventory asset it flagged) is exactly as the save left it.
 * Every global-index read is org re-checked; reads are bounded; ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertWithinUndoWindow } from "./undoWindow";

/** Rows scanned to find the forward audit row (and any earlier UNDO) for a record. */
const MAX_ENTITY_ROWS = 20;

/** The T&T asset fields a save can change. `null` = absent. */
export interface TtAssetSnapshot {
  lastTestDate: number | null;
  nextDueDate: number | null;
  outletCount: number | null;
  testProfileId: string | null;
  status: string | null;
  isActive: boolean | null;
  updatedAt: number | null;
}

/** The inventory asset a referral flagged IN_MAINTENANCE. */
export interface InvAssetSnapshot {
  status: string | null;
  updatedAt: number | null;
}

/** What `createNative` writes into its own audit row's `details`. */
export interface TestTagSaveDetails {
  kind: "testTagRecord";
  result: "PASS" | "FAIL";
  testerName: string;
  profileId?: string;
  serverSavedAt: number;
  before: TtAssetSnapshot;
  after: TtAssetSnapshot;
  inventory: { id: string; before: InvAssetSnapshot; after: InvAssetSnapshot } | null;
  createdMaintenanceId: string | null;
  /** The referral the link points at — this save's own, or an existing same-org one. */
  referralMaintenanceId?: string | null;
  createdLinkId: string | null;
}

export function ttAssetSnapshot(a: Doc<"testTagAssets">): TtAssetSnapshot {
  return {
    lastTestDate: a.lastTestDate ?? null,
    nextDueDate: a.nextDueDate ?? null,
    outletCount: a.outletCount ?? null,
    testProfileId: a.testProfileId ?? null,
    status: a.status ?? null,
    isActive: a.isActive ?? null,
    updatedAt: a.updatedAt ?? null,
  };
}

export function invAssetSnapshot(a: Doc<"assets">): InvAssetSnapshot {
  return { status: a.status ?? null, updatedAt: a.updatedAt ?? null };
}

/** The patch that puts a T&T asset back EXACTLY (absent fields are unset). */
export function ttAssetRestorePatch(s: TtAssetSnapshot): Partial<Doc<"testTagAssets">> {
  return {
    lastTestDate: s.lastTestDate ?? undefined,
    nextDueDate: s.nextDueDate ?? undefined,
    outletCount: s.outletCount ?? undefined,
    testProfileId: s.testProfileId ?? undefined,
    status: (s.status ?? undefined) as Doc<"testTagAssets">["status"],
    isActive: s.isActive ?? undefined,
    updatedAt: s.updatedAt ?? undefined,
  };
}

/** Field-by-field (a stored object's key order is not guaranteed to survive). */
export function sameSnapshot<S extends object>(live: S, stored: S): boolean {
  const l = live as Record<string, unknown>;
  const s = stored as Record<string, unknown>;
  return Object.keys(l).every((k) => (l[k] ?? null) === (s[k] ?? null));
}

function isSaveDetails(d: unknown): d is TestTagSaveDetails {
  const x = d as Partial<TestTagSaveDetails> | null;
  return !!x && x.kind === "testTagRecord" && typeof x.serverSavedAt === "number" && !!x.before && !!x.after;
}

/** The forward audit row for `recordId`, proven undoable (author, once, in the window). */
export async function loadUndoableTestSave(
  ctx: MutationCtx,
  a: { orgId: string; recordId: string; actorUserId: string; serverNow: number },
): Promise<{ forward: Doc<"activityLogs">; details: TestTagSaveDetails }> {
  const rows = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", a.orgId).eq("entityType", "testTagRecord").eq("entityId", a.recordId))
    .take(MAX_ENTITY_ROWS);
  const forward = rows.find((r) => r.action === "CREATE" && isSaveDetails(r.details));
  if (!forward || !isSaveDetails(forward.details)) throw new ConvexError("This test can't be undone");
  if (rows.some((r) => r.action === "UNDO")) throw new ConvexError("This test was already undone");
  if (forward.userId !== a.actorUserId) throw new ConvexError("Only the person who saved this test can undo it");
  assertWithinUndoWindow(forward.details.serverSavedAt, a.serverNow, "test");
  return { forward, details: forward.details };
}

/** The record must still be the newest on its asset (nothing was tested after it). */
export async function requireNewestRecord(ctx: MutationCtx, orgId: string, record: Doc<"testTagRecords">): Promise<void> {
  const newest = await ctx.db
    .query("testTagRecords")
    .withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", record.testTagAssetId))
    .order("desc")
    .first();
  if (!newest || newest.id !== record.id) throw new ConvexError("This item was tested again since: this test can't be undone");
}

/** The inventory asset a referral flagged, still exactly as the save left it. */
export async function requireUntouchedInventory(
  ctx: MutationCtx,
  orgId: string,
  inv: NonNullable<TestTagSaveDetails["inventory"]>,
): Promise<Doc<"assets">> {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", inv.id)).first();
  if (!asset || asset.organizationId !== orgId) throw new ConvexError("Linked asset not found");
  if (!sameSnapshot(invAssetSnapshot(asset), inv.after)) throw new ConvexError("The linked asset changed since: this test can't be undone");
  return asset;
}
