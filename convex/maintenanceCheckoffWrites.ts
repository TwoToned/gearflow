import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNumRange } from "./lib/fieldGuards";
import { isCheckoffRow } from "./lib/maintenanceRecordAssetKind";

/**
 * WS6 #945 — recurring preventative maintenance CHECK-OFF writes. Serialised
 * units are checked off one at a time (`checkOffUnit`); bulk pools are checked
 * off in quantity sessions, including "check all remaining"
 * (`checkOffBulkSession`).
 *
 * ── THE NON-BLOCKING INVARIANT (hard, do not weaken) ──
 * NEITHER mutation below EVER writes `asset.status`, `bulkAsset.
 * availableQuantity`, or anything `computeStockBreakdown`/availability reads.
 * A cycle flipping to COMPLETED only patches the maintenanceRecords row's
 * `status`/`result`/`completedDate` — nothing asset-side. This is enforced by
 * the regression test in `maintenanceScheduleGeneration.test.ts` (byte-identical
 * `computeStockBreakdown` output across a full generate -> check-off -> complete
 * cycle) and is why these mutations do NOT call into maintenanceWrites.ts's
 * hold/release helpers at all — a PM cycle record's `status` never leaves
 * SCHEDULED via this path (only a human manually editing the record through the
 * ordinary maintenance form can advance it to an actually-holding status, which
 * is an intentional, separate, documented exception — see FEATUREDOCS/15).
 *
 * A fault found during check-off is NOT handled here — the operator raises a
 * separate REPAIR record via the existing maintenance form (real blocking
 * machinery, correctly).
 *
 * Gated on `maintenance:update` (per spec — floor staff with the `warehouse`
 * role tick off services, see permissionsCore.ts's WS6 grant).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Sum of WS6 CHECKOFF progress recorded against a cycle so far — a serialised
 *  unit counts once (by distinct assetId); a bulk session's `quantity` sums.
 *  Deliberately generic over both shapes (a cycle is one or the other, never
 *  both, since it's driven by a single model's assetType) rather than needing
 *  to look up the model's assetType to pick a formula. */
function computeProgress(rows: Doc<"maintenanceRecordAssets">[]): number {
  const bulkQty = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
  const serializedCount = new Set(rows.filter((r) => r.assetId != null).map((r) => r.assetId)).size;
  return bulkQty + serializedCount;
}

async function checkoffRowsFor(ctx: MutationCtx, recordId: string): Promise<Doc<"maintenanceRecordAssets">[]> {
  return (
    await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId))
      .collect()
  ).filter(isCheckoffRow);
}

/**
 * Fetch + org/shape-validate the PM cycle record a check-off targets. Throws
 * if missing/cross-org, not a schedule-generated cycle, or already terminal
 * (COMPLETED/CANCELLED — no more check-offs against a closed cycle).
 */
async function requireOpenCycle(ctx: MutationCtx, orgId: string, recordId: string): Promise<Doc<"maintenanceRecords">> {
  const record = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", recordId)).unique();
  if (!record || record.organizationId !== orgId) throw new ConvexError("Maintenance record not found");
  if (!record.serviceScheduleId) {
    throw new ConvexError("This record is not a recurring-maintenance cycle — check-off does not apply.");
  }
  const status = record.status ?? "SCHEDULED";
  if (status === "COMPLETED" || status === "CANCELLED") {
    throw new ConvexError("This maintenance cycle is already closed.");
  }
  return record;
}

/**
 * Flip the cycle to COMPLETED/PASS once its full pool has been checked off.
 * ONLY patches the maintenanceRecords row — see the file-level invariant note.
 */
async function maybeCompleteCycle(ctx: MutationCtx, record: Doc<"maintenanceRecords">, now: number): Promise<void> {
  const snapshot = record.poolQuantitySnapshot ?? 0;
  if (snapshot <= 0) return; // nothing to complete against (no pool captured at generation)
  const rows = await checkoffRowsFor(ctx, record.id);
  const progress = computeProgress(rows);
  if (progress >= snapshot) {
    await ctx.db.patch(record._id, {
      status: "COMPLETED",
      result: "PASS",
      completedDate: now,
      updatedAt: now,
    });
  }
}

// ─── checkOffUnit — serialised, one asset at a time ─────────────────────────
export const checkOffUnit = mutation({
  returns: v.object({ completed: v.boolean() }),
  args: {
    orgId: v.string(),
    recordId: v.string(),
    assetId: v.string(),
    checkoffId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);

    const record = await requireOpenCycle(ctx, a.orgId, a.recordId);

    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.assetId)).unique();
    if (!asset || asset.organizationId !== a.orgId) throw new ConvexError("Asset not found in organization: " + a.assetId);

    // Idempotent — a unit already checked off this cycle is a no-op, not an error
    // (handles double-taps / optimistic-retry without a duplicate progress row).
    const existing = (
      await ctx.db
        .query("maintenanceRecordAssets")
        .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", a.recordId).eq("assetId", a.assetId))
        .collect()
    ).find(isCheckoffRow);

    if (!existing) {
      const idDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", a.checkoffId)).unique();
      if (idDup) throw new ConvexError("Check-off id collision");
      await ctx.db.insert("maintenanceRecordAssets", {
        id: a.checkoffId,
        maintenanceRecordId: a.recordId,
        assetId: a.assetId,
        kind: "CHECKOFF",
        completedAt: a.now,
        completedById: actor.userId,
      });

      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "maintenance",
        entityId: a.recordId,
        entityName: record.title,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Checked off ${asset.assetTag} on: ${record.title}`,
        assetId: a.assetId,
        createdAt: a.now,
      });
    }

    await maybeCompleteCycle(ctx, record, a.now);
    const after = await ctx.db.get(record._id);
    return { completed: (after?.status ?? "SCHEDULED") === "COMPLETED" };
  },
});

// ─── checkOffBulkSession — bulk pool, quantity per session ──────────────────
export const checkOffBulkSession = mutation({
  returns: v.object({ completed: v.boolean(), quantityRecorded: v.number() }),
  args: {
    orgId: v.string(),
    recordId: v.string(),
    bulkAssetId: v.string(),
    sessionId: v.string(),
    // Exactly one of these — validated below (v.union at the call boundary
    // would force the client hook to always pick one anyway; a plain optional
    // pair keeps the mutation shape simple and mirrors the rest of this file).
    quantity: v.optional(v.number()),
    checkAllRemaining: v.optional(v.boolean()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);

    const record = await requireOpenCycle(ctx, a.orgId, a.recordId);

    const bulkAsset = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.bulkAssetId)).unique();
    if (!bulkAsset || bulkAsset.organizationId !== a.orgId) {
      throw new ConvexError("Bulk asset not found in organization: " + a.bulkAssetId);
    }

    const snapshot = record.poolQuantitySnapshot ?? 0;
    const existingRows = await checkoffRowsFor(ctx, a.recordId);
    const already = computeProgress(existingRows);
    const remaining = Math.max(0, snapshot - already);

    let quantity: number;
    if (a.checkAllRemaining) {
      quantity = remaining;
    } else {
      if (a.quantity == null) throw new ConvexError("quantity is required unless checkAllRemaining is set");
      assertNumRange(a.quantity, "quantity", { min: 1, integer: true });
      quantity = a.quantity;
      if (quantity > remaining) {
        throw new ConvexError(`Cannot check off ${quantity} — only ${remaining} remaining in this cycle.`);
      }
    }

    if (quantity > 0) {
      const idDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", a.sessionId)).unique();
      if (idDup) throw new ConvexError("Check-off session id collision");
      await ctx.db.insert("maintenanceRecordAssets", {
        id: a.sessionId,
        maintenanceRecordId: a.recordId,
        bulkAssetId: a.bulkAssetId,
        quantity,
        kind: "CHECKOFF",
        completedAt: a.now,
        completedById: actor.userId,
      });

      await writeActivityLog(ctx, {
        id: a.auditId,
        organizationId: a.orgId,
        action: "UPDATE",
        entityType: "maintenance",
        entityId: a.recordId,
        entityName: record.title,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Checked off ${quantity} of ${bulkAsset.assetTag} on: ${record.title}`,
        createdAt: a.now,
      });
    }

    await maybeCompleteCycle(ctx, record, a.now);
    const after = await ctx.db.get(record._id);
    return { completed: (after?.status ?? "SCHEDULED") === "COMPLETED", quantityRecorded: quantity };
  },
});
