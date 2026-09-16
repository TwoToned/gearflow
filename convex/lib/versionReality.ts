import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import { versionRows } from "./versionScope";

/**
 * Project Versioning v2, Phase 3 (#1229, parent #1221, §4.4/§4.8) —
 * `carryRealityByLineage`, step 3 of `versions.makeLiveNative`'s pointer
 * flip. Generalises `convex/projectLineItems.ts`'s `mergeGroup` mutation
 * (~L930-965): re-pointing a line item's real-world footprint — booked
 * `projectLineItemUnits`, `checkRecords`, `maintenanceRecords` and comment
 * `commentThreads` — from the OUTGOING live version's line item onto the
 * INCOMING one, matched by `lineageId` (the identity that survives a
 * version swap, unlike the row's own `id`).
 *
 * Three outcomes per outgoing line that actually carries reality:
 *
 * 1. **Match** (an incoming line shares its `lineageId`) — re-point every
 *    reality row onto the incoming line's id. If the incoming line's planned
 *    `quantity` is LESS than what's already checked out, that's a CONFLICT
 *    (listed in the result, never blocking the make-live — design §4.4/D6's
 *    "list, don't block" rule applies here too).
 * 2. **No match** — the reality is orphaned: nobody in the incoming version
 *    planned this line at all. It stays on the job as a fresh `unplanned`
 *    line item on the incoming version (`projectLineItems.unplanned`), the
 *    same structural-write allowance an on-site add gets, priced at $0 (no
 *    price was ever agreed for it under this version's plan).
 * 3. **Nothing to carry** — an outgoing line with no units/checks/
 *    maintenance/threads at all is skipped entirely; there is nothing real
 *    tying it to the physical world.
 *
 * Only `projectLineItems` reality is considered — `projectCategories`/
 * `projectGroups`/`projectServices` have no real-world footprint of their
 * own (no unit ever gets checked out "against a category"). `categorySlots`
 * (ordering) is a known gap shared with `materializeVersionRowsNative` —
 * not real-world reality, out of scope here the same way it's out of scope
 * there.
 */

const CHECKED_OUT_STATUS = "CHECKED_OUT" as const;

export interface CarryRealityResult {
  /** Human-readable conflict descriptions — listed for a future dialog to
   *  render, never blocking (see the file header). */
  conflicts: string[];
  /** Ids of the fresh `unplanned` line items created for orphaned reality. */
  unplannedLineItemIds: string[];
}

export async function carryRealityByLineage(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: string;
    outgoingVersionId: string;
    incomingVersionId: string;
    now: number;
  },
): Promise<CarryRealityResult> {
  const { organizationId, projectId, outgoingVersionId, incomingVersionId, now } = args;

  const outgoingLines = await versionRows(ctx, "projectLineItems", outgoingVersionId);
  const incomingLines = await versionRows(ctx, "projectLineItems", incomingVersionId);
  const incomingByLineage = new Map(incomingLines.map((l) => [l.lineageId ?? l.id, l]));

  const conflicts: string[] = [];
  const unplannedLineItemIds: string[] = [];

  for (const line of outgoingLines) {
    const [units, checks, maintenance, threads] = await Promise.all([
      ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", line.id)).collect(),
      ctx.db.query("checkRecords").withIndex("by_lineItemId", (q) => q.eq("lineItemId", line.id)).collect(),
      ctx.db.query("maintenanceRecords").withIndex("by_lineItemId", (q) => q.eq("lineItemId", line.id)).collect(),
      ctx.db
        .query("commentThreads")
        .withIndex("by_orgId_targetId", (q) => q.eq("orgId", organizationId).eq("targetId", line.id))
        .collect(),
    ]);
    const lineThreads = threads.filter((t) => t.targetType === "lineItem");
    if (units.length === 0 && checks.length === 0 && maintenance.length === 0 && lineThreads.length === 0) {
      continue; // nothing real tied to this line — nothing to carry.
    }

    const lineageId = line.lineageId ?? line.id;
    const match = incomingByLineage.get(lineageId);
    const fulfilledQty = units.filter((u) => u.status === CHECKED_OUT_STATUS).length;

    let targetLineId: string;
    if (match) {
      if ((match.quantity ?? 0) < fulfilledQty) {
        conflicts.push(
          `${line.description ?? "Line item"}: ${fulfilledQty} unit(s) checked out, but the new version plans only ${match.quantity ?? 0}.`,
        );
      }
      targetLineId = match.id;
    } else {
      const newId = createId();
      await ctx.db.insert("projectLineItems", {
        id: newId,
        organizationId,
        projectId,
        versionId: incomingVersionId,
        lineageId,
        type: line.type,
        status: CHECKED_OUT_STATUS,
        isKitChild: false,
        modelId: line.modelId,
        assetId: line.assetId,
        bulkAssetId: line.bulkAssetId,
        description: line.description ? `${line.description} (unplanned)` : "Unplanned item",
        // Reflects only the physically-real footprint (checked-out units, or
        // 1 for a line whose only reality is e.g. a check record/thread with
        // no unit row) — never the outgoing line's own PLANNED quantity,
        // which the incoming version deliberately doesn't carry.
        quantity: Math.max(units.length, 1),
        unitPrice: 0, // no price was ever agreed for this line under the new plan.
        unplanned: true,
        createdAt: now,
        updatedAt: now,
      });
      unplannedLineItemIds.push(newId);
      targetLineId = newId;
    }

    for (const u of units) await ctx.db.patch(u._id, { lineItemId: targetLineId, updatedAt: now });
    for (const c of checks) await ctx.db.patch(c._id, { lineItemId: targetLineId });
    for (const m of maintenance) await ctx.db.patch(m._id, { lineItemId: targetLineId, updatedAt: now });
    for (const th of lineThreads) await ctx.db.patch(th._id, { targetId: targetLineId, updatedAt: now });
  }

  return { conflicts, unplannedLineItemIds };
}
