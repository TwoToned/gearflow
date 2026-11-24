/**
 * The exact Undo of `maintenanceWrites.createNative` (`undoCreateNative`, Phase 16 final
 * review SF3): the Scan page's "Create maintenance job" offers it, so it must be a guarded
 * reverse rather than a bare delete. Same shape as Phase 16's other Undos (CLAUDE.md
 * "An exact Undo reads its OWN forward audit row"): ids only; the create's own audit row
 * carries `serverSavedAt`, the status it created, the link rows it inserted and the
 * assets it put on hold (with the `updatedAt` each had); the Undo refuses as a whole
 * unless it is the author, inside the server-clock window, the first undo, and nothing
 * touched the record, its links or those assets since. Org-scoped reads, bounded.
 * ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertWithinUndoWindow } from "./undoWindow";

/** Audit rows scanned for one record's create and any earlier UNDO. */
const MAX_ENTITY_ROWS = 50;

/** What `createNative` writes into its own audit row's `details` (server-written). */
export interface MaintenanceCreateDetails {
  kind: "maintenanceCreate";
  assetCount: number;
  serverSavedAt: number;
  status: string;
  /** The `maintenanceRecordAssets` rows this create inserted (all LINK rows). */
  linkIds: string[];
  /** Assets this create moved AVAILABLE → IN_MAINTENANCE, with the `updatedAt` each had. */
  held: { assetId: string; updatedAtBefore: number | null }[];
}

function isCreateDetails(d: unknown): d is MaintenanceCreateDetails {
  const x = d as Partial<MaintenanceCreateDetails> | null;
  return !!x && x.kind === "maintenanceCreate" && typeof x.serverSavedAt === "number" && Array.isArray(x.linkIds) && Array.isArray(x.held);
}

/** The record's own CREATE row, proven undoable by `actorUserId` (author, window, once). */
export async function loadUndoableMaintenanceCreate(
  ctx: MutationCtx,
  a: { orgId: string; id: string; actorUserId: string; serverNow: number },
): Promise<{ forward: Doc<"activityLogs">; details: MaintenanceCreateDetails }> {
  const rows = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", a.orgId).eq("entityType", "maintenance").eq("entityId", a.id))
    .order("desc")
    .take(MAX_ENTITY_ROWS);
  const forward = rows.find((r) => r.action === "CREATE" && isCreateDetails(r.details));
  if (!forward || !isCreateDetails(forward.details)) throw new ConvexError("This maintenance job can't be undone");
  if (rows.some((r) => r.action === "UNDO" && (r.details as { undoOf?: string } | undefined)?.undoOf === forward.id)) {
    throw new ConvexError("This maintenance job was already undone");
  }
  if (forward.userId !== a.actorUserId) throw new ConvexError("Only the person who created this job can undo it");
  assertWithinUndoWindow(forward.details.serverSavedAt, a.serverNow, "change");
  return { forward, details: forward.details };
}

/** The record (org-checked), still exactly as the create left it. */
export async function requireUntouchedMaintenanceRecord(
  ctx: MutationCtx,
  orgId: string,
  id: string,
  forward: Doc<"activityLogs">,
  details: MaintenanceCreateDetails,
): Promise<Doc<"maintenanceRecords">> {
  const record = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  if (!record || record.organizationId !== orgId) throw new ConvexError("Record not found");
  const untouched = record.updatedAt === forward.createdAt && record.createdAt === forward.createdAt && (record.status ?? "SCHEDULED") === details.status;
  if (!untouched) throw new ConvexError("This maintenance job was changed since: it can't be undone");
  return record;
}

/** Its link rows are exactly the ones the create inserted: no CHECKOFF progress, no other link. */
export function requireOwnLinksOnly(rows: Doc<"maintenanceRecordAssets">[], details: MaintenanceCreateDetails): void {
  const own = new Set(details.linkIds);
  const foreign = rows.some((r) => (r.kind ?? "LINK") !== "LINK" || !own.has(r.id));
  if (foreign || rows.length !== own.size) throw new ConvexError("This maintenance job's assets changed since: it can't be undone");
}
