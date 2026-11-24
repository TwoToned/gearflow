/**
 * The maintenance half of Phase 16's two exact Undos (`checkRecordWrites.
 * undoAdHocCheckNative`, `testTagRecordsWrites.undoCreateNative`): a forward save may
 * have OPENED maintenance records (a check FAIL's incident report / predictive record,
 * a T&T fail's electrician referral). The Undo deletes exactly those — the ids the
 * forward save recorded on its own audit row — and only while each is untouched:
 * still `SCHEDULED`, `updatedAt` still the forward save's stamp. Anything else means a
 * person has started working it, so the whole Undo refuses (overseer Q9).
 *
 * Every read here is on a GLOBAL index (`by_cuid`, `by_maintenanceRecordId`) and is
 * org re-checked through the parent record. Bounded. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "../_generated/server";

/** Links per maintenance record an Undo will remove (a save creates one). */
const MAX_LINKS = 20;

/** Which of `ids` name an existing maintenance record (in `orgId`, when given). */
export async function existingMaintenanceIds(ctx: { db: DatabaseReader }, ids: string[], orgId?: string): Promise<string[]> {
  const found: string[] = [];
  for (const id of ids) {
    const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (m && (orgId === undefined || m.organizationId === orgId)) found.push(id);
  }
  return found;
}

/** The forward save's maintenance records, each proven untouched since `stamp`. */
export async function requireUntouchedMaintenance(
  ctx: MutationCtx,
  orgId: string,
  ids: string[],
  stamp: number | undefined,
): Promise<Doc<"maintenanceRecords">[]> {
  const out: Doc<"maintenanceRecords">[] = [];
  for (const id of ids) {
    const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!m || m.organizationId !== orgId) throw new ConvexError("A maintenance record this save opened is gone: it can't be undone");
    if ((m.status ?? "SCHEDULED") !== "SCHEDULED" || m.updatedAt !== stamp) {
      throw new ConvexError("A maintenance record this save opened has been worked on since: it can't be undone");
    }
    out.push(m);
  }
  return out;
}

/** Delete one (org-checked) maintenance record and its asset links. */
export async function deleteMaintenanceWithLinks(ctx: MutationCtx, m: Doc<"maintenanceRecords">): Promise<void> {
  const links = await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", m.id))
    .take(MAX_LINKS);
  for (const l of links) await ctx.db.delete(l._id);
  await ctx.db.delete(m._id);
}
