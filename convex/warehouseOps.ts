import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";
import { bumpAssetCounters } from "./lib/counters";
import { assertTestTagAllowsCheckout } from "./lib/testtag";
import { adjustBulkAvailability, coalesceAdjustments, type BulkAdjustment } from "./lib/inventory";
import { type CheckInItem, type CheckInItemType, itemGroupKey, distributeReturn } from "./lib/bulkCheckin";
import {
  ensureSerialisedUnit,
  ensureBulkUnit,
  expandAccessoriesForAsset,
  syncLineItemRollup,
  returnLineUnits,
  checkinAccessoryChildren,
} from "./lib/fulfillment";
import { nextOrdinal } from "./lib/lineItemUnits";
import { getKitByCuid as kitByCuid } from "./lib/kits";

/**
 * Warehouse checkout / check-in — Convex port of warehouse.ts checkOutItems /
 * checkInItems (Phase C mega-flip). Each was one Prisma $transaction coupling
 * asset.status + unit status + line rollup; here it's one atomic Convex mutation
 * (serializable → OCC prevents two projects deploying the same asset). The T&T
 * compliance gate (was a Convex query mid-tx) is inlined via ctx.db
 * (lib/testtag.ts). Scan logs are written in-mutation (assetScanLogs is Convex).
 * Permissions / activity-log / model-attach stay in the server action.
 */

type Ctx = MutationCtx;

async function lineByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function assetByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function lineUnits(ctx: Ctx, lineItemId: string) {
  return await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).collect();
}
async function unitByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
function scanLog(ctx: Ctx, doc: Record<string, unknown>) {
  return ctx.db.insert("assetScanLogs", { id: createId(), ...doc } as never);
}

// ── Checkout helpers ─────────────────────────────────────────────────────────

/** Returns "continue" when the asset is already on its own unit (skip finalize). */
async function checkOutSerializedItem(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; targetAssetId: string; userId: string; projectLocationId: string | null; projectId: string; notes?: string; now: number },
): Promise<"continue" | "done"> {
  const asset = await assetByCuid(ctx, p.targetAssetId);
  if (!asset || asset.organizationId !== p.organizationId) throw new ConvexError("Asset not found in this organization");
  if (asset.status === "CHECKED_OUT") {
    // `.find()` over the collected units, not `ctx.db…unique()` on
    // by_lineItemId_assetId — that index is non-unique, so a stray duplicate
    // row for the pair would make `.unique()` throw a raw, unmasked Convex
    // system error instead of the intended ConvexError below (see the same
    // fix in ensureSerialisedUnit, convex/lib/fulfillment.ts).
    const ownUnit = (await lineUnits(ctx, p.lineItemId)).find((u) => u.assetId === p.targetAssetId);
    if (ownUnit && ownUnit.status === "CHECKED_OUT") return "continue";
    throw new ConvexError(`Asset ${asset.assetTag} is already deployed`);
  }
  if (asset.status === "RETIRED" || asset.status === "IN_MAINTENANCE" || asset.status === "LOST" || asset.status === "SOLD") {
    throw new ConvexError(`Asset ${asset.assetTag} is ${(asset.status as string).replace("_", " ").toLowerCase()} and cannot be deployed`);
  }
  const { id: unitId } = await ensureSerialisedUnit(ctx, { organizationId: p.organizationId, lineItemId: p.lineItemId, assetId: p.targetAssetId });
  const unit = await unitByCuid(ctx, unitId);
  if (unit && unit.status !== "CHECKED_OUT") {
    await ctx.db.patch(unit._id, { status: "CHECKED_OUT", checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
  await ctx.db.patch(asset._id, { status: "CHECKED_OUT", ...(p.projectLocationId ? { locationId: p.projectLocationId } : {}), updatedAt: p.now });
  await bumpAssetCounters(ctx, asset.organizationId, asset, { isActive: asset.isActive, status: "CHECKED_OUT" });
  await scanLog(ctx, { organizationId: p.organizationId, assetId: p.targetAssetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: p.notes ?? undefined });
  return "done";
}

async function checkOutBulkItem(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; lineItemQuantity: number; bulkAssetId: string; checkoutQty: number; userId: string; projectId: string; notes?: string; now: number; isKitChild: boolean },
): Promise<void> {
  const priorUnits = await lineUnits(ctx, p.lineItemId);
  const priorCheckedOutQty = priorUnits.find((u) => u.bulkAssetId === p.bulkAssetId && u.status === "CHECKED_OUT")?.quantity ?? 0;
  const { id: unitId } = await ensureBulkUnit(ctx, { organizationId: p.organizationId, lineItemId: p.lineItemId, bulkAssetId: p.bulkAssetId, quantity: p.checkoutQty });
  const unit = await unitByCuid(ctx, unitId);
  if (unit) {
    await ctx.db.patch(unit._id, { status: "CHECKED_OUT", quantity: p.checkoutQty, checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
  // Standalone (non-kit-child) bulk lines consume the shared shelf pool directly
  // (issue #801 #2) — kit members instead go through the kit's own
  // collectKitBulkAdjustments off `kitBulkItems`, and accessory children are
  // out of scope here (see FEATUREDOCS/48's SHIPS_WITH/DEDICATED split); both
  // set isKitChild, so this single flag is the right gate. Deduct only the
  // DELTA over what this line already had checked out, so a repeat/idempotent
  // checkout call for the same total quantity doesn't double-consume stock.
  if (!p.isKitChild) {
    const delta = p.checkoutQty - priorCheckedOutQty;
    if (delta !== 0) {
      await adjustBulkAvailability(ctx, p.organizationId, [{ bulkAssetId: p.bulkAssetId, delta: -delta }]);
    }
  }
  await scanLog(ctx, { organizationId: p.organizationId, bulkAssetId: p.bulkAssetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: p.notes || `Checked out ${p.checkoutQty} of ${p.lineItemQuantity}` });
}

async function checkOutDeployWholeLine(ctx: Ctx, p: { lineItemId: string; lineItemQuantity: number; userId: string; now: number }): Promise<void> {
  const line = await lineByCuid(ctx, p.lineItemId);
  if (line) {
    await ctx.db.patch(line._id, { status: "CHECKED_OUT", checkedOutQuantity: p.lineItemQuantity, checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
}

/**
 * Deploy the prepped "generic" units of an untagged multi-quantity line (rows
 * with neither an asset nor a bulk asset — the partial-prep model). Flips up to
 * `want` of them to CHECKED_OUT so a partial deploy leaves the rest waiting.
 * Returns false when the line has no such units (legacy whole-line deploy).
 */
async function checkOutGenericUnits(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; want?: number; userId: string; projectId: string; notes?: string; now: number },
): Promise<boolean> {
  const units = (await lineUnits(ctx, p.lineItemId))
    .filter((u) => !u.assetId && !u.bulkAssetId && u.status !== "CHECKED_OUT" && u.status !== "RETURNED" && u.prepStatus === "PACKED")
    .sort((a, b) => a.ordinal - b.ordinal);
  if (units.length === 0) return false;
  const want = p.want ?? units.length;
  const toFlip = units.slice(0, Math.max(1, Math.min(want, units.length)));
  for (const u of toFlip) {
    await ctx.db.patch(u._id, { status: "CHECKED_OUT", checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
  await scanLog(ctx, { organizationId: p.organizationId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: p.notes || `Deployed ${toFlip.length} unit(s)` });
  return true;
}

/** Cascade checkout to a parent line's accessory children (per parent unit / whole line).
 *  `includeAccessoryIds`, when given, narrows to only those accessories (by assetId or
 *  bulkAssetId) — the warehouse verified-set / partial-deploy escape hatch (issue #794).
 *  Absent ⇒ every not-yet-deployed accessory unit in scope cascades (today's behaviour). */
async function checkoutAccessoryChildren(
  ctx: Ctx,
  p: { organizationId: string; projectId: string; parentLineItemId: string; parentUnitAssetId: string | null; userId: string; projectLocationId: string | null; includeAccessoryIds?: Set<string> | null; now: number },
): Promise<{ assetsTouched: string[] }> {
  const children = (
    await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", p.parentLineItemId)).collect()
  ).filter((c) => c.organizationId === p.organizationId && c.childKind === "ACCESSORY");
  if (children.length === 0) return { assetsTouched: [] };

  const units: Array<{ _id: import("./_generated/dataModel").Id<"projectLineItemUnits">; assetId?: string; bulkAssetId?: string; status?: string }> = [];
  for (const child of children) {
    for (const u of await lineUnits(ctx, child.id)) {
      if (u.status === "CHECKED_OUT") continue;
      if (p.parentUnitAssetId && u.parentUnitAssetId !== p.parentUnitAssetId) continue;
      if (p.includeAccessoryIds && !p.includeAccessoryIds.has(u.assetId ?? u.bulkAssetId ?? "")) continue;
      units.push(u);
    }
  }
  // Gate the accessory units actually flipping now (unit-scoped, like the source).
  await assertTestTagAllowsCheckout(ctx, p.organizationId, {
    assetIds: units.map((u) => u.assetId).filter((x): x is string => !!x),
    bulkAssetIds: units.map((u) => u.bulkAssetId).filter((x): x is string => !!x),
  });

  const assetsTouched: string[] = [];
  for (const u of units) {
    await ctx.db.patch(u._id, { status: "CHECKED_OUT", checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
    if (u.assetId) {
      const asset = await assetByCuid(ctx, u.assetId);
      if (asset) {
        await ctx.db.patch(asset._id, { status: "CHECKED_OUT", ...(p.projectLocationId ? { locationId: p.projectLocationId } : {}), updatedAt: p.now });
        await bumpAssetCounters(ctx, asset.organizationId, asset, { isActive: asset.isActive, status: "CHECKED_OUT" });
      }
      assetsTouched.push(u.assetId);
      await scanLog(ctx, { organizationId: p.organizationId, assetId: u.assetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: "Accessory — moved with parent" });
    } else if (u.bulkAssetId) {
      await scanLog(ctx, { organizationId: p.organizationId, bulkAssetId: u.bulkAssetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: "Accessory — moved with parent" });
    }
  }
  for (const child of children) await syncLineItemRollup(ctx, child.id);
  return { assetsTouched };
}

async function finalizeCheckoutItem(
  ctx: Ctx,
  p: {
    organizationId: string; lineItemId: string; targetAssetId: string | null; projectId: string; userId: string;
    projectLocationId: string | null; includeAccessories: boolean; includeAccessoryIds?: Set<string> | null; now: number;
  },
): Promise<void> {
  if (p.includeAccessories) {
    if (p.targetAssetId) {
      await expandAccessoriesForAsset(ctx, {
        organizationId: p.organizationId, lineItemId: p.lineItemId, assetId: p.targetAssetId,
        includeAccessoryIds: p.includeAccessoryIds,
      });
    }
    await checkoutAccessoryChildren(ctx, {
      organizationId: p.organizationId, projectId: p.projectId, parentLineItemId: p.lineItemId,
      parentUnitAssetId: p.targetAssetId, userId: p.userId, projectLocationId: p.projectLocationId,
      includeAccessoryIds: p.includeAccessoryIds, now: p.now,
    });
  }
  await syncLineItemRollup(ctx, p.lineItemId);
}

/** Batch T&T preflight: gather every asset/bulk id the batch will touch and assert. */
async function gatherTestTagAssetsAndAssert(
  ctx: Ctx,
  organizationId: string,
  projectId: string,
  items: Array<{ lineItemId: string; assetId?: string }>,
): Promise<{
  preflight: Array<{ id: string; assetId?: string; bulkAssetId?: string }>;
  unitsByLine: Map<string, Awaited<ReturnType<typeof lineUnits>>>;
}> {
  const preflightLineItems: Array<{ id: string; assetId?: string; bulkAssetId?: string }> = [];
  // Cache each line's units here so the immediately-following expand stage reuses
  // them instead of re-reading. Safe: both stages run BEFORE any mutation, so the
  // snapshot is stable. (Do NOT extend this cache into the mutating main loop.)
  const unitsByLine = new Map<string, Awaited<ReturnType<typeof lineUnits>>>();
  const assetIds: string[] = [];
  const bulkIds: string[] = [];
  for (const it of items) {
    const li = await lineByCuid(ctx, it.lineItemId);
    if (!li || li.organizationId !== organizationId || li.projectId !== projectId) continue;
    preflightLineItems.push({ id: li.id, assetId: li.assetId, bulkAssetId: li.bulkAssetId });
    if (li.assetId) assetIds.push(li.assetId);
    if (li.bulkAssetId) bulkIds.push(li.bulkAssetId);
    const units = await lineUnits(ctx, li.id);
    unitsByLine.set(li.id, units);
    for (const u of units) {
      if (u.assetId) assetIds.push(u.assetId);
      if (u.bulkAssetId) bulkIds.push(u.bulkAssetId);
    }
    if (it.assetId) assetIds.push(it.assetId);
  }
  await assertTestTagAllowsCheckout(ctx, organizationId, { assetIds, bulkAssetIds: bulkIds });
  return { preflight: preflightLineItems, unitsByLine };
}

/** Expand "deploy whole prepped line" into one item per prepped unit. */
async function expandPrepUnitAssignments(
  ctx: Ctx,
  organizationId: string,
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string; includeAccessoryIds?: string[] }>,
  preflight: Array<{ id: string; assetId?: string; bulkAssetId?: string }>,
  unitsByLine: Map<string, Awaited<ReturnType<typeof lineUnits>>>,
): Promise<Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string; includeAccessoryIds?: string[] }>> {
  const out: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string; includeAccessoryIds?: string[] }> = [];
  for (const item of items) {
    if (item.assetId) { out.push(item); continue; }
    const row = preflight.find((l) => l.id === item.lineItemId);
    if (row?.assetId || row?.bulkAssetId) { out.push(item); continue; }
    // Reuse the units gather already read this same (pre-mutation) snapshot;
    // fall back to a read only for a line gather skipped (wrong org/project).
    const units = (unitsByLine.get(item.lineItemId) ?? (await lineUnits(ctx, item.lineItemId)))
      .filter((u) => u.status !== "CHECKED_OUT" && (u.assetId || u.bulkAssetId))
      .sort((a, b) => a.ordinal - b.ordinal);
    if (units.length === 0) { out.push(item); continue; }
    const want = item.quantity ?? units.length;
    const toDeploy = units.slice(0, Math.max(1, Math.min(want, units.length)));
    for (const u of toDeploy) {
      out.push({
        lineItemId: item.lineItemId,
        ...(u.assetId ? { assetId: u.assetId } : { quantity: u.quantity ?? 1 }),
        notes: item.notes,
        includeAccessoryIds: item.includeAccessoryIds,
      });
    }
  }
  return out;
}

// ── Mutations ────────────────────────────────────────────────────────────────

const checkoutItemArg = v.object({
  lineItemId: v.string(),
  assetId: v.optional(v.string()),
  quantity: v.optional(v.number()),
  notes: v.optional(v.string()),
  // Narrows this item's accessory cascade to a verified subset (assetId/bulkAssetId)
  // — the warehouse "Deploy Verified Only" partial-deploy escape hatch (issue #794).
  // Absent = every not-yet-deployed accessory in scope cascades (today's behaviour).
  includeAccessoryIds: v.optional(v.array(v.string())),
});

export type CheckoutItemsArgs = {
  organizationId: string;
  projectId: string;
  userId: string;
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string; includeAccessoryIds?: string[] }>;
  includeAccessories: boolean;
  now: number;
};

/** Core atomic checkout: T&T preflight, prep-unit expansion, serialised/bulk/generic
 *  status flips, accessory cascade, scan logs. Shared by the requireService mirror
 *  AND the browser-direct `warehouseWrites.checkOutItems`. Org-validates the project +
 *  each line (by_cuid is GLOBAL) exactly as before. */
export async function checkoutItemsCore(ctx: Ctx, a: CheckoutItemsArgs): Promise<{ updatedLineIds: string[] }> {
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
    if (!project || project.organizationId !== a.organizationId) throw new ConvexError("Project not found");
    const projectLocationId = project.locationId ?? null;

    const { preflight, unitsByLine } = await gatherTestTagAssetsAndAssert(ctx, a.organizationId, a.projectId, a.items);
    const expanded = await expandPrepUnitAssignments(ctx, a.organizationId, a.items, preflight, unitsByLine);

    const updated = new Set<string>();
    for (const item of expanded) {
      const lineItem = await lineByCuid(ctx, item.lineItemId);
      if (!lineItem || lineItem.projectId !== a.projectId || lineItem.organizationId !== a.organizationId) {
        throw new ConvexError(`Line item ${item.lineItemId} not found in project`);
      }
      const targetAssetId = item.assetId || lineItem.assetId || null;
      if (targetAssetId) {
        const res = await checkOutSerializedItem(ctx, {
          organizationId: a.organizationId, lineItemId: lineItem.id, targetAssetId, userId: a.userId,
          projectLocationId, projectId: a.projectId, notes: item.notes, now: a.now,
        });
        if (res === "continue") continue;
      } else if (lineItem.bulkAssetId) {
        await checkOutBulkItem(ctx, {
          organizationId: a.organizationId, lineItemId: lineItem.id, lineItemQuantity: lineItem.quantity ?? 0,
          bulkAssetId: lineItem.bulkAssetId, checkoutQty: item.quantity || lineItem.quantity || 0, userId: a.userId,
          projectId: a.projectId, notes: item.notes, now: a.now, isKitChild: !!lineItem.isKitChild,
        });
      } else {
        // No serialised asset, no bulk asset. Prefer deploying the prepped
        // generic units (untagged multi-qty partial support); only legacy lines
        // that were never unit-prepped fall back to the whole-line flip.
        const flipped = await checkOutGenericUnits(ctx, {
          organizationId: a.organizationId, lineItemId: lineItem.id, want: item.quantity,
          userId: a.userId, projectId: a.projectId, notes: item.notes, now: a.now,
        });
        if (!flipped) {
          await checkOutDeployWholeLine(ctx, { lineItemId: lineItem.id, lineItemQuantity: lineItem.quantity ?? 0, userId: a.userId, now: a.now });
          updated.add(lineItem.id);
          continue;
        }
        // Generic units flipped — fall through to finalize (accessories + rollup).
      }
      await finalizeCheckoutItem(ctx, {
        organizationId: a.organizationId, lineItemId: lineItem.id, targetAssetId, projectId: a.projectId,
        userId: a.userId, projectLocationId, includeAccessories: a.includeAccessories,
        includeAccessoryIds: item.includeAccessoryIds ? new Set(item.includeAccessoryIds) : null,
        now: a.now,
      });
      updated.add(lineItem.id);
    }
    return { updatedLineIds: [...updated] };
}

export const checkoutItems = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    items: v.array(checkoutItemArg),
    includeAccessories: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return checkoutItemsCore(ctx, a);
  },
});

export async function defaultLocationId(ctx: Ctx, organizationId: string): Promise<string | null> {
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
  return locs.find((l) => l.isDefault)?.id ?? null;
}
async function linesByAsset(ctx: Ctx, assetId: string, organizationId: string) {
  return (await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect())
    .filter((l) => l.organizationId === organizationId);
}

// ── Kit checkout / checkin helpers ───────────────────────────────────────────

async function kitParentLine(ctx: Ctx, projectId: string, organizationId: string, kitId: string) {
  const rows = await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  return rows.find((r) => r.projectId === projectId && r.organizationId === organizationId && !r.isKitChild) ?? null;
}
async function childLines(ctx: Ctx, parentId: string, organizationId: string) {
  return (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", parentId)).collect())
    .filter((c) => c.organizationId === organizationId);
}
async function kitSerializedAssetIds(ctx: Ctx, kitId: string): Promise<string[]> {
  return (await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect()).map((k) => k.assetId);
}

/**
 * Kit per-unit fulfillment (Phase 3) — composition parity guard.
 *
 * A project's kit is a SNAPSHOT (child lines + their units) frozen when the kit
 * was added; `kitSerializedItems` is the LIVE definition, which can drift
 * independently (warehouse edits, CSV import). Since Phase 3 the asset flip is
 * driven by the snapshot (child-line assets), while verification (T&T preflight,
 * the per-item check flow) still reads the live definition. If the two diverge,
 * verification validates one asset set and deployment touches another — so we
 * error and make the operator re-add the kit to resync, rather than silently
 * deploying an unverified set. Serialised members only (bulk uses availability,
 * not per-asset status).
 *
 * Compared by MODEL + quantity, not exact serial: a per-job serial substitution
 * (kit-member reassign, Phase 4) legitimately points a member at a different
 * same-model asset, so exact-serial parity would false-positive. The guard's real
 * job is STRUCTURAL drift — a member added/removed, or a model changed. Actual
 * serials are still verified by tag-scan at checkout (T&T + the check flow).
 */
async function kitModelCounts(ctx: Ctx, assetIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of assetIds) {
    const a = await assetByCuid(ctx, id);
    const model = a?.modelId ?? `__no-model:${id}`;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return counts;
}

async function assertKitCompositionParity(ctx: Ctx, kitLineId: string, kitId: string, organizationId: string) {
  const children = await childLines(ctx, kitLineId, organizationId);
  const snapshot = await kitModelCounts(ctx, children.filter((c) => !c.kitId && c.assetId).map((c) => c.assetId!));
  const definition = await kitModelCounts(ctx, await kitSerializedAssetIds(ctx, kitId));
  const models = new Set([...snapshot.keys(), ...definition.keys()]);
  const driftModels = [...models].filter((m) => (snapshot.get(m) ?? 0) !== (definition.get(m) ?? 0));
  if (driftModels.length > 0) {
    throw new ConvexError({
      kind: "KIT_COMPOSITION_DRIFT",
      kitId,
      message: "This kit's contents (models/quantities) changed since it was added to the project. Remove and re-add the kit to resync, then deploy.",
      driftModels,
    });
  }
}
async function collectKitBulkAdjustments(ctx: Ctx, kitId: string, organizationId: string, sign: -1 | 1): Promise<BulkAdjustment[]> {
  const bulks = await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  return bulks.filter((b) => b.organizationId === organizationId).map((b) => ({ bulkAssetId: b.bulkAssetId, delta: sign * b.quantity }));
}
export async function setAssetsStatus(ctx: Ctx, assetIds: string[], status: string, locationId: string | null, clearLocIfNull: boolean, now: number) {
  for (const id of assetIds) {
    const a = await assetByCuid(ctx, id);
    if (!a) continue;
    if (locationId != null) {
      await ctx.db.patch(a._id, { status: status as typeof a.status, locationId, updatedAt: now });
    } else if (clearLocIfNull) {
      const { _id, _creationTime, locationId: _l, ...rest } = a;
      await ctx.db.replace(_id, { ...rest, status: status as typeof a.status, updatedAt: now });
    } else {
      await ctx.db.patch(a._id, { status: status as typeof a.status, updatedAt: now });
    }
    // §3.6 dashboard counter: this is the choke point for warehouse status churn
    // (nearly every check-out/-in/force-return funnels here). isActive is untouched.
    await bumpAssetCounters(ctx, a.organizationId, a, { isActive: a.isActive, status });
  }
}

// ── Kit per-unit fulfillment (Phase 1) ───────────────────────────────────────
// Additively maintain kit MEMBER UNIT rows alongside the legacy kit line/asset
// path. This phase the legacy path still OWNS line status, asset status +
// counters, and bulk availability (setAssetsStatus above); these helpers touch
// ONLY the projectLineItemUnit rows, so members become visible/trackable per job
// exactly like loose gear. A member line with no unit (a pre-change kit not yet
// backfilled) is a silent no-op — Phase 2 backfill fills those, and prep
// self-heals any prepped after the migration. Phase 3 moves asset-flipping into
// the unit path and deletes the legacy belt. See
// docs/designs/kit-per-unit-fulfillment.md.

/** Apply `makePatch(unit)` to every unit on `lineItemId` whose current status is
 *  in `fromStatuses` (or all units when null). `updatedAt` is stamped for you. */
async function patchLineUnitRows(
  ctx: Ctx,
  lineItemId: string,
  fromStatuses: string[] | null,
  makePatch: (u: Awaited<ReturnType<typeof lineUnits>>[number]) => Record<string, unknown>,
  now: number,
): Promise<number> {
  let n = 0;
  for (const u of await lineUnits(ctx, lineItemId)) {
    if (fromStatuses && !fromStatuses.includes(u.status ?? "")) continue;
    await ctx.db.patch(u._id, { ...makePatch(u), updatedAt: now });
    n++;
  }
  return n;
}

/** Walk a kit's member lines — direct children + nested-kit grandchildren — and
 *  patch their unit rows. A nested-kit PARENT child line carries no units of its
 *  own (its grandchildren do), so it is skipped as a unit target. */
async function patchKitMemberUnits(
  ctx: Ctx,
  kitParentLineId: string,
  organizationId: string,
  fromStatuses: string[] | null,
  makePatch: (u: Awaited<ReturnType<typeof lineUnits>>[number]) => Record<string, unknown>,
  now: number,
): Promise<void> {
  for (const c of await childLines(ctx, kitParentLineId, organizationId)) {
    if (c.kitId) {
      for (const gc of await childLines(ctx, c.id, organizationId)) {
        if (!gc.kitId) await patchLineUnitRows(ctx, gc.id, fromStatuses, makePatch, now);
      }
    } else {
      await patchLineUnitRows(ctx, c.id, fromStatuses, makePatch, now);
    }
  }
}

/** A kit's serialised member lines — direct serialised children plus the
 *  serialised members of any nested kit. These are valid accessory parents
 *  (childKind unset), so their asset-level accessories expand under them. */
async function serialisedKitMemberLines(ctx: Ctx, kitParentLineId: string, organizationId: string) {
  const out: Array<{ id: string; assetId: string }> = [];
  for (const c of await childLines(ctx, kitParentLineId, organizationId)) {
    if (c.kitId) {
      for (const gc of await childLines(ctx, c.id, organizationId)) if (!gc.kitId && gc.assetId) out.push({ id: gc.id, assetId: gc.assetId });
    } else if (c.assetId) {
      out.push({ id: c.id, assetId: c.assetId });
    }
  }
  return out;
}

/** Deploy each kit member's asset-level accessories with the kit. Reuses the
 *  loose-gear helpers, which own the accessory unit AND asset flip (the kit belt
 *  covers member assets, not accessory assets). Idempotent: expand is find-or-create
 *  so this works whether or not the kit was prepped first. */
async function cascadeKitAccessoriesOut(ctx: Ctx, kitParentLineId: string, organizationId: string, p: { projectId: string; userId: string; loc: string | null; now: number }) {
  for (const m of await serialisedKitMemberLines(ctx, kitParentLineId, organizationId)) {
    await expandAccessoriesForAsset(ctx, { organizationId, lineItemId: m.id, assetId: m.assetId });
    await checkoutAccessoryChildren(ctx, { organizationId, projectId: p.projectId, parentLineItemId: m.id, parentUnitAssetId: m.assetId, userId: p.userId, projectLocationId: p.loc, now: p.now });
  }
}

/** Return each kit member's accessories with the kit. */
async function cascadeKitAccessoriesIn(ctx: Ctx, kitParentLineId: string, organizationId: string, p: { projectId: string; userId: string; defaultLocationId: string | null; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }) {
  for (const m of await serialisedKitMemberLines(ctx, kitParentLineId, organizationId)) {
    await checkinAccessoryChildren(ctx, { organizationId, projectId: p.projectId, parentLineItemId: m.id, returnCondition: p.returnCondition, userId: p.userId, defaultLocationId: p.defaultLocationId, returnedAssetId: m.assetId });
  }
}

/** Reverse each kit member's accessories with the kit (un-deploy / un-return), so a
 *  move-back never leaves an accessory stranded a stage ahead of its parent. */
async function cascadeKitAccessoriesReverse(ctx: Ctx, kitParentLineId: string, organizationId: string, p: { fromStatus: string; toStatus: "CONFIRMED" | "CHECKED_OUT"; toPrepStatus?: "PACKED"; assetStatus: string; locationId: string | null; clearLoc: boolean; now: number }) {
  for (const m of await serialisedKitMemberLines(ctx, kitParentLineId, organizationId)) {
    await reverseAccessoryChildren(ctx, { organizationId, parentLineItemId: m.id, ...p });
  }
}

/** Extract a human-readable message from a thrown Convex error for a per-kit
 *  {succeeded, errors} report (the batch catches pre-write validation throws and
 *  records them per item instead of aborting the whole call). */
function kitBatchErrorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const d = e.data as unknown;
    if (typeof d === "string") return d;
    if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      if (typeof o.message === "string") return o.message;
      if (o.kind === "TESTTAG_BLOCK") return "Blocked by Test & Tag compliance";
      return JSON.stringify(d);
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** Pre-write validation for a kit checkout: composition parity (this kit + each
 *  nested kit) and the T&T preflight over their permanent composition. THROWS
 *  before any write, so a batch can run it per item and skip a drifted/blocked kit
 *  cleanly (no writes staged) without sinking the rest. */
async function checkoutKitPreflight(ctx: Ctx, a: KitOpArgs, kitLine: KitParentLine): Promise<void> {
  const children = await childLines(ctx, kitLine.id, a.organizationId);
  const nestedKitChildren = children.filter((c) => c.kitId);
  const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];

  // Parity: the project's kit snapshot (what we deploy) must match the live kit
  // definition (what T&T verifies) — for this kit and each nested kit.
  await assertKitCompositionParity(ctx, kitLine.id, a.kitId, a.organizationId);
  for (const nestedChild of nestedKitChildren) {
    await assertKitCompositionParity(ctx, nestedChild.id, nestedChild.kitId!, a.organizationId);
  }

  // T&T preflight over this kit + nested kits' permanent composition.
  const ttAssets: string[] = [...(await kitSerializedAssetIds(ctx, a.kitId))];
  const ttBulk: string[] = (await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect()).map((b) => b.bulkAssetId);
  for (const nk of nestedKitIds) {
    ttAssets.push(...(await kitSerializedAssetIds(ctx, nk)));
    ttBulk.push(...(await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", nk)).collect()).map((b) => b.bulkAssetId));
  }
  await assertTestTagAllowsCheckout(ctx, a.organizationId, { assetIds: ttAssets, bulkAssetIds: ttBulk });
}

/** Write phase of checkoutKit for ONE already-validated kit (preflight passed).
 *  `loc` (the project location) is passed so a batch resolves it once. Returns
 *  [kitId, ...nestedKitIds]. CONSUMES bulk availability — `adjustBulkAvailability`
 *  can throw on a short bulk (all-or-nothing per the singular). */
async function checkoutKitCore(ctx: Ctx, a: KitOpArgs, kitLine: KitParentLine, loc: string | null): Promise<string[]> {
    const children = await childLines(ctx, kitLine.id, a.organizationId);
    const nestedKitChildren = children.filter((c) => c.kitId);
    const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];

    // checkedOutQuantity must be the LINE's own quantity, not a hardcoded 1 — a bulk
    // kit member with quantity 16 was rolling up as "1 on the job", which then let the
    // return path decrement only 1 at a time. Each line deploys its full quantity.
    const deployBase = { status: "CHECKED_OUT" as const, checkedOutAt: a.now, checkedOutById: a.userId, updatedAt: a.now };
    const deployLine = (line: { quantity?: number }) => ({ ...deployBase, checkedOutQuantity: line.quantity ?? 1 });
    await ctx.db.patch(kitLine._id, deployLine(kitLine));
    for (const c of children) await ctx.db.patch(c._id, deployLine(c));

    for (const nestedChild of nestedKitChildren) {
      for (const gc of await childLines(ctx, nestedChild.id, a.organizationId)) await ctx.db.patch(gc._id, deployLine(gc));
      const nk = await kitByCuid(ctx, nestedChild.kitId!);
      if (nk) await ctx.db.patch(nk._id, { status: "CHECKED_OUT", ...(loc ? { locationId: loc } : {}), updatedAt: a.now });
    }

    await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), "CHECKED_OUT", loc, false, a.now);
    for (const nestedChild of nestedKitChildren) {
      const gcs = await childLines(ctx, nestedChild.id, a.organizationId);
      await setAssetsStatus(ctx, gcs.filter((g) => g.assetId).map((g) => g.assetId!), "CHECKED_OUT", loc, false, a.now);
    }

    const kit = await kitByCuid(ctx, a.kitId);
    if (kit) await ctx.db.patch(kit._id, { status: "CHECKED_OUT", ...(loc ? { locationId: loc } : {}), updatedAt: a.now });

    const adjustments: BulkAdjustment[] = [...(await collectKitBulkAdjustments(ctx, a.kitId, a.organizationId, -1))];
    for (const nk of nestedKitIds) adjustments.push(...(await collectKitBulkAdjustments(ctx, nk, a.organizationId, -1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));

    // Kit per-unit: flip member units CONFIRMED → CHECKED_OUT (unit rows only;
    // the belt above owns asset status this phase), then deploy each member's
    // asset-level accessories with the kit.
    await patchKitMemberUnits(ctx, kitLine.id, a.organizationId, ["CONFIRMED"], () => ({ status: "CHECKED_OUT", checkedOutAt: a.now, checkedOutById: a.userId }), a.now);
    await cascadeKitAccessoriesOut(ctx, kitLine.id, a.organizationId, { projectId: a.projectId, userId: a.userId, loc, now: a.now });

    await scanLog(ctx, { organizationId: a.organizationId, kitId: a.kitId, projectId: a.projectId, action: "CHECK_OUT", scannedById: a.userId, scannedAt: a.now, notes: "Kit deployed with all contents" });
    return [a.kitId, ...nestedKitIds];
}

/** Full singular kit checkout: parent-line lookup (org+project scoped) + project loc
 *  + preflight (composition parity + T&T) + write core. Shared by the requireService
 *  mirror AND the browser-direct `warehouseWrites.checkOutKit`. */
export async function checkoutKitFull(ctx: Ctx, a: KitOpArgs): Promise<{ kitId: string; affectedKitIds: string[] }> {
  const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, a.kitId);
  if (!kitLine) throw new ConvexError("Kit not found on this project");
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
  const loc = project?.locationId ?? null;
  await checkoutKitPreflight(ctx, a, kitLine);
  const affectedKitIds = await checkoutKitCore(ctx, a, kitLine, loc);
  return { kitId: a.kitId, affectedKitIds };
}

export const checkoutKit = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return checkoutKitFull(ctx, a);
  },
});

/**
 * Batch kit checkout (bulk single-call invariant, Phase 3): deploy N kits in ONE
 * array mutation instead of the client firing one `checkoutKit` per kit. `loc`
 * (the shared project location — all kits are on `projectId`) is resolved ONCE.
 * Per-item guards, in the singular's order: (1) org+project re-check via
 * `kitParentLine` — a kit not on this org's project is SKIPPED with an error; (2)
 * `checkoutKitPreflight` (composition parity + T&T) runs BEFORE any write, so a
 * drifted/blocked kit is caught and SKIPPED cleanly ({succeeded, errors}) without
 * sinking the rest — matching the old independent per-kit mutations. Only AFTER a
 * kit passes preflight does its write core run. CAUTION: the write core CONSUMES
 * bulk availability; a short-bulk (or accessory-level T&T) failure throws mid-write,
 * and because a Convex mutation is ONE transaction that rolls the whole batch back
 * (atomic) — the client surfaces the error and the operator retries.
 */
/** Core batch kit checkout (partial-success): per-item org+project re-check via
 *  kitParentLine + preflight-then-write, collecting per-kit errors. Shared by the
 *  requireService mirror AND the browser-direct `warehouseWrites.checkOutKitsBatch`. */
export async function checkoutKitsBatchCore(ctx: Ctx, a: KitsBatchArgs): Promise<KitBatchResult> {
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
    const loc = project?.locationId ?? null;
    const succeeded: string[] = [];
    const errors: { kitId: string; message: string }[] = [];
    const affected = new Set<string>();
    for (const kitId of a.kitIds) {
      const ka: KitOpArgs = { organizationId: a.organizationId, projectId: a.projectId, userId: a.userId, kitId, now: a.now };
      const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, kitId);
      if (!kitLine) { errors.push({ kitId, message: "Kit not found on this project" }); continue; }
      // Pre-write validation only — a throw here has staged no writes, so the kit is
      // skipped cleanly and the rest of the batch proceeds.
      try {
        await checkoutKitPreflight(ctx, ka, kitLine);
      } catch (e) {
        errors.push({ kitId, message: kitBatchErrorMessage(e) });
        continue;
      }
      const aff = await checkoutKitCore(ctx, ka, kitLine, loc);
      succeeded.push(kitId);
      for (const k of aff) affected.add(k);
    }
    return { succeeded, errors, affectedKitIds: [...affected] };
}

export const checkoutKitsBatch = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return checkoutKitsBatchCore(ctx, a);
  },
});

/** Core of checkinKit for ONE validated kit. `defaultLocationId` (org default) is
 *  passed so a batch resolves it once. Returns [kitId, ...nestedKitIds]. */
async function checkinKitCore(ctx: Ctx, a: KitCheckinArgs, kitLine: KitParentLine, defaultLocationId: string | null): Promise<string[]> {
    const newKitStatus = a.returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : a.returnCondition === "MISSING" ? "INCOMPLETE" : "AVAILABLE";
    const assetStatus = a.returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : a.returnCondition === "MISSING" ? "LOST" : "AVAILABLE";
    const ret = { status: "RETURNED" as const, returnedQuantity: 1, returnedAt: a.now, returnedById: a.userId, returnCondition: a.returnCondition, updatedAt: a.now };

    await ctx.db.patch(kitLine._id, ret);
    const children = (await childLines(ctx, kitLine.id, a.organizationId)).filter((c) => c.status === "CHECKED_OUT");
    for (const c of children) await ctx.db.patch(c._id, ret);

    const nestedKitChildren = children.filter((c) => c.kitId);
    const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];
    for (const nestedChild of nestedKitChildren) {
      for (const gc of (await childLines(ctx, nestedChild.id, a.organizationId)).filter((g) => g.status === "CHECKED_OUT")) await ctx.db.patch(gc._id, ret);
      const nk = await kitByCuid(ctx, nestedChild.kitId!);
      if (nk) await ctx.db.patch(nk._id, { status: newKitStatus, ...(defaultLocationId ? { locationId: defaultLocationId } : {}), updatedAt: a.now });
    }

    await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), assetStatus, defaultLocationId, true, a.now);
    for (const nestedChild of nestedKitChildren) {
      const gcs = await childLines(ctx, nestedChild.id, a.organizationId);
      await setAssetsStatus(ctx, gcs.filter((g) => g.assetId).map((g) => g.assetId!), assetStatus, defaultLocationId, true, a.now);
    }

    const kit = await kitByCuid(ctx, a.kitId);
    if (kit) await ctx.db.patch(kit._id, { status: newKitStatus, ...(defaultLocationId ? { locationId: defaultLocationId } : {}), updatedAt: a.now });

    const adjustments: BulkAdjustment[] = [...(await collectKitBulkAdjustments(ctx, a.kitId, a.organizationId, 1))];
    for (const nk of nestedKitIds) adjustments.push(...(await collectKitBulkAdjustments(ctx, nk, a.organizationId, 1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));

    // Kit per-unit: flip member units CHECKED_OUT → RETURNED (unit rows only),
    // then return each member's accessories with the kit. Bulk members return
    // their full quantity. RETURNED units are retained as job history (deprep/close
    // never delete them).
    await patchKitMemberUnits(ctx, kitLine.id, a.organizationId, ["CHECKED_OUT"], (u) => ({ status: "RETURNED", returnedQuantity: u.quantity ?? 1, returnedAt: a.now, returnedById: a.userId, returnCondition: a.returnCondition }), a.now);
    await cascadeKitAccessoriesIn(ctx, kitLine.id, a.organizationId, { projectId: a.projectId, userId: a.userId, defaultLocationId, returnCondition: a.returnCondition });

    await scanLog(ctx, { organizationId: a.organizationId, kitId: a.kitId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: `Kit returned — condition: ${a.returnCondition}` });
    return [a.kitId, ...nestedKitIds];
}

/** Full check-in for one kit (parent-line lookup + default loc + core). Shared. */
export async function checkinKitFull(ctx: Ctx, a: KitCheckinArgs): Promise<{ kitId: string; affectedKitIds: string[] }> {
  const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, a.kitId);
  if (!kitLine) throw new ConvexError("Kit not found on this project");
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.organizationId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
  const defaultLoc = locs.find((l) => l.isDefault)?.id ?? null;
  const affectedKitIds = await checkinKitCore(ctx, a, kitLine, defaultLoc);
  return { kitId: a.kitId, affectedKitIds };
}

export const checkinKit = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), userId: v.string(), kitId: v.string(),
    returnCondition: v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING")), now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return checkinKitFull(ctx, a);
  },
});

/**
 * Batch kit check-in (bulk single-call invariant, Phase 3): return N kits in ONE
 * array mutation instead of one `checkinKit` per kit. The org default location is
 * resolved ONCE. Per-item org+project re-check via `kitParentLine`: a kit not on
 * this org's project is SKIPPED with an error before any of its writes
 * ({succeeded, errors}). Check-in only RELEASES bulk availability (+1), which can't
 * underflow, so a valid kit's core completes; but like any Convex mutation this is
 * ONE transaction, so a genuine mid-execution failure (e.g. a missing bulk asset)
 * rolls the whole batch back (atomic) and the operator retries.
 */
export type CheckinKitsBatchArgs = {
  organizationId: string; projectId: string; userId: string;
  items: Array<{ kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }>;
  now: number;
};

/** Core batch check-in (per-kit org/project re-check, default loc once). Shared. */
export async function checkinKitsBatchCore(ctx: Ctx, a: CheckinKitsBatchArgs): Promise<KitBatchResult> {
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.organizationId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
  const defaultLoc = locs.find((l) => l.isDefault)?.id ?? null;
  const succeeded: string[] = [];
  const errors: { kitId: string; message: string }[] = [];
  const affected = new Set<string>();
  for (const item of a.items) {
    const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, item.kitId);
    if (!kitLine) { errors.push({ kitId: item.kitId, message: "Kit not found on this project" }); continue; }
    const aff = await checkinKitCore(ctx, { organizationId: a.organizationId, projectId: a.projectId, userId: a.userId, kitId: item.kitId, returnCondition: item.returnCondition, now: a.now }, kitLine, defaultLoc);
    succeeded.push(item.kitId);
    for (const k of aff) affected.add(k);
  }
  return { succeeded, errors, affectedKitIds: [...affected] };
}

export const checkinKitsBatch = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), userId: v.string(),
    items: v.array(v.object({ kitId: v.string(), returnCondition: v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING")) })),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return checkinKitsBatchCore(ctx, a);
  },
});

export type CheckinItemsArgs = {
  organizationId: string;
  projectId: string;
  userId: string;
  items: Array<{
    lineItemId: string;
    assetId?: string;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string;
  }>;
  now: number;
};

/** Core check-in (unit returns, asset/bulk restores, scan logs, accessory cascade,
 *  line rollups). Shared by the requireService mutation + the browser-direct write. */
export async function checkinItemsCore(ctx: Ctx, a: CheckinItemsArgs): Promise<{ updatedLineIds: string[] }> {
  // org default location to restore assets to
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.organizationId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
  const defaultLocationId = locs.find((l) => l.isDefault)?.id ?? null;

  const updated = new Set<string>();
  for (const item of a.items) {
    const { unitsFlipped, assetsTouched } = await returnLineUnits(ctx, {
      organizationId: a.organizationId, projectId: a.projectId, lineItemId: item.lineItemId, assetId: item.assetId,
      returnCondition: item.returnCondition, quantity: item.quantity, notes: item.notes, userId: a.userId, defaultLocationId,
    });
    if (assetsTouched.length === 1) {
      await scanLog(ctx, { organizationId: a.organizationId, assetId: assetsTouched[0], projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: item.notes ?? undefined });
    } else if (unitsFlipped > 0 || assetsTouched.length > 0) {
      await scanLog(ctx, { organizationId: a.organizationId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: item.notes || `Returned ${unitsFlipped} unit(s)` });
    }
    await syncLineItemRollup(ctx, item.lineItemId);
    if (unitsFlipped > 0) {
      await checkinAccessoryChildren(ctx, {
        organizationId: a.organizationId, projectId: a.projectId, parentLineItemId: item.lineItemId,
        returnCondition: item.returnCondition ?? "GOOD", userId: a.userId, defaultLocationId, returnedAssetId: item.assetId ?? null,
      });
    }
    updated.add(item.lineItemId);
  }
  return { updatedLineIds: [...updated] };
}

export const checkinItems = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    items: v.array(v.object({
      lineItemId: v.string(),
      assetId: v.optional(v.string()),
      returnCondition: v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING")),
      quantity: v.optional(v.number()),
      notes: v.optional(v.string()),
    })),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return checkinItemsCore(ctx, a);
  },
});

// ── Move-back (reverse a stage) ──────────────────────────────────────────────
// Every warehouse stage's primary button advances gear one step; these mutations
// are the inverse (Deployed→Prepped, Returned→Deployed, De-prepped→Returned).
// They mirror the matching forward mutation exactly, flipping unit + asset status
// (and kit bulk availability) back. Whole units only — no sub-quantity split of a
// bulk pool. Kits go through their own reverse (like checkoutKit / checkinKit).

/** Flip a line's units from one status to another (whole units, up to `want`),
 *  restoring each serialised unit's asset status + location. Also reports the
 *  bulk units flipped (`bulkFlips`) — PURE reporting only, no availability side
 *  effect here; callers that own a top-level (non-kit-child) line decide
 *  whether to apply it via `adjustBulkAvailability` (issue #801 #2 move-back
 *  parity — see undeployItemsCore / unreturnItemsCore). */
async function flipLineUnits(
  ctx: Ctx,
  p: {
    organizationId: string; lineItemId: string;
    fromStatus: string; toStatus: "CONFIRMED" | "CHECKED_OUT";
    toPrepStatus?: "PACKED"; resetReturnedQty?: boolean;
    assetStatus: string; locationId: string | null; clearLoc: boolean;
    want?: number; now: number;
  },
): Promise<{ flipped: number; assetIds: string[]; bulkFlips: Array<{ bulkAssetId: string; quantity: number }> }> {
  const units = (await lineUnits(ctx, p.lineItemId))
    .filter((u) => u.status === p.fromStatus)
    .sort((a, b) => a.ordinal - b.ordinal);
  const toFlip = p.want != null ? units.slice(0, Math.max(0, Math.min(p.want, units.length))) : units;
  const assetIds: string[] = [];
  const bulkFlips: Array<{ bulkAssetId: string; quantity: number }> = [];
  for (const u of toFlip) {
    await ctx.db.patch(u._id, {
      status: p.toStatus,
      ...(p.toPrepStatus ? { prepStatus: p.toPrepStatus } : {}),
      ...(p.resetReturnedQty ? { returnedQuantity: 0 } : {}),
      updatedAt: p.now,
    });
    if (u.assetId) assetIds.push(u.assetId);
    if (u.bulkAssetId) bulkFlips.push({ bulkAssetId: u.bulkAssetId, quantity: u.quantity ?? 0 });
  }
  if (assetIds.length > 0) await setAssetsStatus(ctx, assetIds, p.assetStatus, p.locationId, p.clearLoc, p.now);
  return { flipped: toFlip.length, assetIds, bulkFlips };
}

/** Apply issue #801 #2 standalone-bulk availability adjustments for a set of
 *  flipped bulk units, honoring the isKitChild gate (kit members own their own
 *  adjustment via collectKitBulkAdjustments off `kitBulkItems`, not per-unit
 *  flips). `sign` is +1 to release stock back to the shelf (undeploy) or -1 to
 *  re-consume it (unreturn) — mirrors kit move-back's documented "+1"/"-1". */
async function applyBulkFlipAvailability(
  ctx: Ctx,
  organizationId: string,
  isKitChild: boolean | undefined,
  bulkFlips: Array<{ bulkAssetId: string; quantity: number }>,
  sign: 1 | -1,
): Promise<void> {
  if (isKitChild) return;
  for (const bf of bulkFlips) {
    if (bf.quantity > 0) await adjustBulkAvailability(ctx, organizationId, [{ bulkAssetId: bf.bulkAssetId, delta: sign * bf.quantity }]);
  }
}

/** Cascade a line's ACCESSORY children back with their parent (whole units). */
async function reverseAccessoryChildren(
  ctx: Ctx,
  p: { organizationId: string; parentLineItemId: string; fromStatus: string; toStatus: "CONFIRMED" | "CHECKED_OUT"; toPrepStatus?: "PACKED"; assetStatus: string; locationId: string | null; clearLoc: boolean; now: number },
): Promise<void> {
  const children = (await childLines(ctx, p.parentLineItemId, p.organizationId)).filter((c) => c.childKind === "ACCESSORY");
  for (const child of children) {
    await flipLineUnits(ctx, {
      organizationId: p.organizationId, lineItemId: child.id,
      fromStatus: p.fromStatus, toStatus: p.toStatus, toPrepStatus: p.toPrepStatus,
      assetStatus: p.assetStatus, locationId: p.locationId, clearLoc: p.clearLoc, now: p.now,
    });
    await syncLineItemRollup(ctx, child.id);
  }
}

const reverseItemArg = v.object({ lineItemId: v.string(), assetId: v.optional(v.string()), quantity: v.optional(v.number()) });

/** Deployed → Prepped: reverse checkoutItems. Units CHECKED_OUT → prepped,
 *  assets back to AVAILABLE at the default location. */
export type ReverseItemsArgs = {
  organizationId: string;
  projectId: string;
  userId: string;
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>;
  now: number;
};

/** Core Deployed → Prepped (reverse checkoutItems). Shared by requireService + browser. */
export async function undeployItemsCore(ctx: Ctx, a: ReverseItemsArgs): Promise<{ updatedLineIds: string[] }> {
  const defLoc = await defaultLocationId(ctx, a.organizationId);
  const updated = new Set<string>();
  for (const item of a.items) {
    const line = await lineByCuid(ctx, item.lineItemId);
    if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) throw new ConvexError(`Line item ${item.lineItemId} not found in project`);
    const { flipped, bulkFlips } = await flipLineUnits(ctx, {
      organizationId: a.organizationId, lineItemId: line.id, fromStatus: "CHECKED_OUT",
      toStatus: "CONFIRMED", toPrepStatus: "PACKED", assetStatus: "AVAILABLE",
      locationId: defLoc, clearLoc: true, want: item.quantity, now: a.now,
    });
    const wholeLine = flipped === 0 && line.status === "CHECKED_OUT";
    if (wholeLine) {
      // Legacy unit-less line — set counters directly; a rollup would zero them.
      await ctx.db.patch(line._id, { status: "CONFIRMED", prepStatus: "PACKED", checkedOutQuantity: 0, updatedAt: a.now });
    }
    await applyBulkFlipAvailability(ctx, a.organizationId, line.isKitChild, bulkFlips, 1);
    await reverseAccessoryChildren(ctx, { organizationId: a.organizationId, parentLineItemId: line.id, fromStatus: "CHECKED_OUT", toStatus: "CONFIRMED", toPrepStatus: "PACKED", assetStatus: "AVAILABLE", locationId: defLoc, clearLoc: true, now: a.now });
    if (!wholeLine) await syncLineItemRollup(ctx, line.id);
    await scanLog(ctx, { organizationId: a.organizationId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: "Moved back to Prepped (un-deploy)" });
    updated.add(line.id);
  }
  return { updatedLineIds: [...updated] };
}

export const undeployItems = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), items: v.array(reverseItemArg), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return undeployItemsCore(ctx, a);
  },
});

/** Returned → Deployed: reverse checkinItems. Units RETURNED → CHECKED_OUT,
 *  assets back out at the project location. */
/** Core Returned → Deployed (reverse checkinItems). Shared by requireService + browser. */
export async function unreturnItemsCore(ctx: Ctx, a: ReverseItemsArgs): Promise<{ updatedLineIds: string[] }> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
  const projLoc = project?.locationId ?? null;
  const updated = new Set<string>();
  for (const item of a.items) {
    const line = await lineByCuid(ctx, item.lineItemId);
    if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) throw new ConvexError(`Line item ${item.lineItemId} not found in project`);
    const { flipped, bulkFlips } = await flipLineUnits(ctx, {
      organizationId: a.organizationId, lineItemId: line.id, fromStatus: "RETURNED",
      toStatus: "CHECKED_OUT", resetReturnedQty: true, assetStatus: "CHECKED_OUT",
      locationId: projLoc, clearLoc: false, want: item.quantity, now: a.now,
    });
    const wholeLine = flipped === 0 && line.status === "RETURNED";
    if (wholeLine) {
      // Legacy unit-less line — restore checked-out counters directly; a rollup
      // would zero checkedOutQuantity (no units to recompute from).
      await ctx.db.patch(line._id, { status: "CHECKED_OUT", returnedQuantity: 0, checkedOutQuantity: line.quantity ?? 0, checkedOutAt: a.now, checkedOutById: a.userId, updatedAt: a.now });
    }
    await applyBulkFlipAvailability(ctx, a.organizationId, line.isKitChild, bulkFlips, -1);
    await reverseAccessoryChildren(ctx, { organizationId: a.organizationId, parentLineItemId: line.id, fromStatus: "RETURNED", toStatus: "CHECKED_OUT", assetStatus: "CHECKED_OUT", locationId: projLoc, clearLoc: false, now: a.now });
    if (!wholeLine) await syncLineItemRollup(ctx, line.id);
    await scanLog(ctx, { organizationId: a.organizationId, projectId: a.projectId, action: "CHECK_OUT", scannedById: a.userId, scannedAt: a.now, notes: "Moved back to Deployed (un-return)" });
    updated.add(line.id);
  }
  return { updatedLineIds: [...updated] };
}

export const unreturnItems = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), items: v.array(reverseItemArg), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return unreturnItemsCore(ctx, a);
  },
});

/** De-prepped → Returned: re-pack a returned line (prepStatus back to PACKED).
 *  Status stays RETURNED; this only reverses the de-prep prepStatus reset. */
export type UndeprepLineArgs = { organizationId: string; projectId: string; lineItemId: string; now: number };

/** Core De-prepped → Returned (re-pack a returned line). Shared by requireService + browser. */
export async function undeprepLineCore(ctx: Ctx, a: UndeprepLineArgs): Promise<{ id: string }> {
  const line = await lineByCuid(ctx, a.lineItemId);
  if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) throw new ConvexError("Line item not found in project");
  await ctx.db.patch(line._id, { prepStatus: "PACKED", updatedAt: a.now });
  for (const child of (await childLines(ctx, a.lineItemId, a.organizationId)).filter((c) => c.childKind === "ACCESSORY")) {
    await ctx.db.patch(child._id, { prepStatus: "PACKED", updatedAt: a.now });
  }
  return { id: a.lineItemId };
}

export const undeprepLine = mutation({
  args: { organizationId: v.string(), projectId: v.string(), lineItemId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return undeprepLineCore(ctx, a);
  },
});

/** Deployed → Prepped for a whole kit: reverse checkoutKit. */
type KitOpArgs = { organizationId: string; projectId: string; userId: string; kitId: string; now: number };
type KitCheckinArgs = KitOpArgs & { returnCondition: "GOOD" | "DAMAGED" | "MISSING" };
type KitParentLine = NonNullable<Awaited<ReturnType<typeof kitParentLine>>>;

/** Core of undeployKit for ONE validated kit (parent line found). `defLoc` is passed
 *  so a batch resolves it once. Returns [kitId, ...nestedKitIds]. */
async function undeployKitCore(ctx: Ctx, a: KitOpArgs, kitLine: KitParentLine, defLoc: string | null): Promise<string[]> {
    const prepped = { status: "CONFIRMED" as const, prepStatus: "PACKED" as const, checkedOutQuantity: 0, updatedAt: a.now };

    const children = await childLines(ctx, kitLine.id, a.organizationId);
    const nestedKitChildren = children.filter((c) => c.kitId);
    const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];

    await ctx.db.patch(kitLine._id, prepped);
    for (const c of children) await ctx.db.patch(c._id, prepped);
    for (const nestedChild of nestedKitChildren) {
      for (const gc of await childLines(ctx, nestedChild.id, a.organizationId)) await ctx.db.patch(gc._id, prepped);
      const nk = await kitByCuid(ctx, nestedChild.kitId!);
      if (nk) await ctx.db.patch(nk._id, { status: "AVAILABLE", ...(defLoc ? { locationId: defLoc } : {}), updatedAt: a.now });
    }
    await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), "AVAILABLE", defLoc, true, a.now);
    for (const nestedChild of nestedKitChildren) {
      const gcs = await childLines(ctx, nestedChild.id, a.organizationId);
      await setAssetsStatus(ctx, gcs.filter((g) => g.assetId).map((g) => g.assetId!), "AVAILABLE", defLoc, true, a.now);
    }
    const kit = await kitByCuid(ctx, a.kitId);
    if (kit) await ctx.db.patch(kit._id, { status: "AVAILABLE", ...(defLoc ? { locationId: defLoc } : {}), updatedAt: a.now });

    // Restore bulk availability the checkout consumed (+1, opposite of checkout's -1).
    const adjustments: BulkAdjustment[] = [...(await collectKitBulkAdjustments(ctx, a.kitId, a.organizationId, 1))];
    for (const nk of nestedKitIds) adjustments.push(...(await collectKitBulkAdjustments(ctx, nk, a.organizationId, 1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));

    // Kit per-unit: member units CHECKED_OUT → CONFIRMED (re-packed), and reverse
    // the members' accessories with them.
    await patchKitMemberUnits(ctx, kitLine.id, a.organizationId, ["CHECKED_OUT"], () => ({ status: "CONFIRMED", prepStatus: "PACKED" }), a.now);
    await cascadeKitAccessoriesReverse(ctx, kitLine.id, a.organizationId, { fromStatus: "CHECKED_OUT", toStatus: "CONFIRMED", toPrepStatus: "PACKED", assetStatus: "AVAILABLE", locationId: defLoc, clearLoc: true, now: a.now });

    await scanLog(ctx, { organizationId: a.organizationId, kitId: a.kitId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: "Kit moved back to Prepped (un-deploy)" });
    return [a.kitId, ...nestedKitIds];
}

/** Full Deployed → Prepped for one kit (parent-line lookup + defLoc + core). Shared. */
export async function undeployKitFull(ctx: Ctx, a: KitOpArgs): Promise<{ kitId: string; affectedKitIds: string[] }> {
  const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, a.kitId);
  if (!kitLine) throw new ConvexError("Kit not found on this project");
  const defLoc = await defaultLocationId(ctx, a.organizationId);
  const affectedKitIds = await undeployKitCore(ctx, a, kitLine, defLoc);
  return { kitId: a.kitId, affectedKitIds };
}

export const undeployKit = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return undeployKitFull(ctx, a);
  },
});

/**
 * Batch un-deploy (bulk single-call invariant, Phase 3): move N kits Deployed→Prepped
 * in ONE array mutation instead of the client firing one `undeployKit` per kit.
 * Per-item org+project re-check via `kitParentLine`: a kit not on this org's project is
 * SKIPPED with an error before any of its writes ({succeeded, errors}). Un-deploy only
 * RESTORES bulk availability (+1), so a valid kit's core can't underflow — the batch
 * effectively completes for every eligible kit. (Note: like any Convex mutation this is
 * ONE transaction, so a genuine mid-execution failure would roll the whole batch back;
 * the client surfaces the error and the operator retries.) `defLoc` resolved once.
 */
export type KitsBatchArgs = { organizationId: string; projectId: string; userId: string; kitIds: string[]; now: number };
export type KitBatchResult = { succeeded: string[]; errors: { kitId: string; message: string }[]; affectedKitIds: string[] };

/** Core batch Deployed → Prepped (per-kit org/project re-check, defLoc once). Shared. */
export async function undeployKitsBatchCore(ctx: Ctx, a: KitsBatchArgs): Promise<KitBatchResult> {
  const defLoc = await defaultLocationId(ctx, a.organizationId);
  const succeeded: string[] = [];
  const errors: { kitId: string; message: string }[] = [];
  const affected = new Set<string>();
  for (const kitId of a.kitIds) {
    const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, kitId);
    if (!kitLine) { errors.push({ kitId, message: "Kit not found on this project" }); continue; }
    const aff = await undeployKitCore(ctx, { organizationId: a.organizationId, projectId: a.projectId, userId: a.userId, kitId, now: a.now }, kitLine, defLoc);
    succeeded.push(kitId);
    for (const k of aff) affected.add(k);
  }
  return { succeeded, errors, affectedKitIds: [...affected] };
}

export const undeployKitsBatch = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return undeployKitsBatchCore(ctx, a);
  },
});

/** Returned → Deployed for a whole kit: reverse checkinKit. */
/** Core of unreturnKit for ONE validated kit. `projLoc` passed so a batch resolves it once. */
async function unreturnKitCore(ctx: Ctx, a: KitOpArgs, kitLine: KitParentLine, projLoc: string | null): Promise<string[]> {
    const deployed = { status: "CHECKED_OUT" as const, returnedQuantity: 0, checkedOutAt: a.now, checkedOutById: a.userId, updatedAt: a.now };

    const children = (await childLines(ctx, kitLine.id, a.organizationId)).filter((c) => c.status === "RETURNED");
    const nestedKitChildren = children.filter((c) => c.kitId);
    const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];

    await ctx.db.patch(kitLine._id, deployed);
    for (const c of children) await ctx.db.patch(c._id, deployed);
    for (const nestedChild of nestedKitChildren) {
      for (const gc of (await childLines(ctx, nestedChild.id, a.organizationId)).filter((g) => g.status === "RETURNED")) await ctx.db.patch(gc._id, deployed);
      const nk = await kitByCuid(ctx, nestedChild.kitId!);
      if (nk) await ctx.db.patch(nk._id, { status: "CHECKED_OUT", ...(projLoc ? { locationId: projLoc } : {}), updatedAt: a.now });
    }
    await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), "CHECKED_OUT", projLoc, false, a.now);
    for (const nestedChild of nestedKitChildren) {
      const gcs = await childLines(ctx, nestedChild.id, a.organizationId);
      await setAssetsStatus(ctx, gcs.filter((g) => g.assetId).map((g) => g.assetId!), "CHECKED_OUT", projLoc, false, a.now);
    }
    const kit = await kitByCuid(ctx, a.kitId);
    if (kit) await ctx.db.patch(kit._id, { status: "CHECKED_OUT", ...(projLoc ? { locationId: projLoc } : {}), updatedAt: a.now });

    // Re-consume bulk availability the return restored (-1, opposite of checkin's +1).
    const adjustments: BulkAdjustment[] = [...(await collectKitBulkAdjustments(ctx, a.kitId, a.organizationId, -1))];
    for (const nk of nestedKitIds) adjustments.push(...(await collectKitBulkAdjustments(ctx, nk, a.organizationId, -1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));

    // Kit per-unit: member units RETURNED → CHECKED_OUT. Clear the return stamps
    // so a re-deployed unit doesn't carry contradictory returned* history.
    await patchKitMemberUnits(ctx, kitLine.id, a.organizationId, ["RETURNED"], () => ({ status: "CHECKED_OUT", returnedQuantity: 0, checkedOutAt: a.now, checkedOutById: a.userId, returnedAt: undefined, returnedById: undefined, returnCondition: undefined, returnStatus: undefined, returnNotes: undefined }), a.now);
    await cascadeKitAccessoriesReverse(ctx, kitLine.id, a.organizationId, { fromStatus: "RETURNED", toStatus: "CHECKED_OUT", assetStatus: "CHECKED_OUT", locationId: projLoc, clearLoc: false, now: a.now });

    await scanLog(ctx, { organizationId: a.organizationId, kitId: a.kitId, projectId: a.projectId, action: "CHECK_OUT", scannedById: a.userId, scannedAt: a.now, notes: "Kit moved back to Deployed (un-return)" });
    return [a.kitId, ...nestedKitIds];
}

/** Full Returned → Deployed for one kit (parent-line lookup + projLoc + core). Shared. */
export async function unreturnKitFull(ctx: Ctx, a: KitOpArgs): Promise<{ kitId: string; affectedKitIds: string[] }> {
  const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, a.kitId);
  if (!kitLine) throw new ConvexError("Kit not found on this project");
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
  const projLoc = project?.locationId ?? null;
  const affectedKitIds = await unreturnKitCore(ctx, a, kitLine, projLoc);
  return { kitId: a.kitId, affectedKitIds };
}

export const unreturnKit = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return unreturnKitFull(ctx, a);
  },
});

/**
 * Batch un-return (bulk single-call invariant, Phase 3): move N kits Returned→Deployed
 * in ONE array mutation instead of one `unreturnKit` per kit. Per-item org+project
 * re-check via `kitParentLine`: a kit not on this org's project is SKIPPED with an error
 * before any of its writes ({succeeded, errors}). Un-return RE-CONSUMES bulk availability
 * (−1), so — unlike un-deploy — a valid kit could in principle underflow; because a
 * Convex mutation is ONE transaction, such a mid-execution failure rolls the whole batch
 * back (atomic) rather than leaving it half-applied. The client surfaces the error and
 * the operator retries. `projLoc` resolved once (all kits share the projectId).
 */
/** Core batch Returned → Deployed (per-kit org/project re-check, projLoc once). Shared. */
export async function unreturnKitsBatchCore(ctx: Ctx, a: KitsBatchArgs): Promise<KitBatchResult> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
  const projLoc = project?.locationId ?? null;
  const succeeded: string[] = [];
  const errors: { kitId: string; message: string }[] = [];
  const affected = new Set<string>();
  for (const kitId of a.kitIds) {
    const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, kitId);
    if (!kitLine) { errors.push({ kitId, message: "Kit not found on this project" }); continue; }
    const aff = await unreturnKitCore(ctx, { organizationId: a.organizationId, projectId: a.projectId, userId: a.userId, kitId, now: a.now }, kitLine, projLoc);
    succeeded.push(kitId);
    for (const k of aff) affected.add(k);
  }
  return { succeeded, errors, affectedKitIds: [...affected] };
}

export const unreturnKitsBatch = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return unreturnKitsBatchCore(ctx, a);
  },
});

// ── Force-return + container/quick-add (Group E3/E4) ──────────────────────────

const FORCE_RET = (now: number) => ({ status: "RETURNED" as const, returnedQuantity: 1, returnedAt: now, returnCondition: "GOOD" as const, updatedAt: now });

/** Kit per-unit: force-return the CHECKED_OUT unit(s) bound to one asset, wherever
 *  they live (loose line or kit member). Mirrors FORCE_RET onto the unit row so
 *  force-return doesn't leave a member unit stuck CHECKED_OUT (split-brain). */
async function forceReturnAssetUnits(ctx: Ctx, organizationId: string, assetId: string, userId: string, now: number) {
  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", organizationId).eq("assetId", assetId).eq("status", "CHECKED_OUT"))
    .collect();
  for (const u of units) {
    await ctx.db.patch(u._id, { status: "RETURNED", returnedQuantity: u.quantity ?? 1, returnedAt: now, returnedById: userId, returnCondition: "GOOD", updatedAt: now });
  }
}

/**
 * Core force-return for ONE already-validated (existing, in-org, non-AVAILABLE) asset:
 * return every CHECKED_OUT line for the asset across all projects, flip its
 * CHECKED_OUT units → RETURNED, and reset the asset to AVAILABLE at `loc` (the default
 * location, PASSED so a batch resolves it once). Guards live in the callers so the
 * singular can throw while the batch skips + collects. Shared by the requireService
 * mirror AND the browser-direct `warehouseWrites.forceReturnAsset`.
 */
export async function forceReturnAssetCore(ctx: Ctx, organizationId: string, assetId: string, userId: string, now: number, loc: string | null): Promise<void> {
  for (const li of await linesByAsset(ctx, assetId, organizationId)) {
    if (li.status === "CHECKED_OUT") await ctx.db.patch(li._id, FORCE_RET(now));
  }
  await forceReturnAssetUnits(ctx, organizationId, assetId, userId, now);
  await setAssetsStatus(ctx, [assetId], "AVAILABLE", loc, true, now);
}

export const forceReturnAsset = mutation({
  args: { organizationId: v.string(), assetId: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const asset = await assetByCuid(ctx, a.assetId);
    if (!asset || asset.organizationId !== a.organizationId) throw new ConvexError("Asset not found");
    if (asset.status === "AVAILABLE") throw new ConvexError("Asset is already available");
    const loc = await defaultLocationId(ctx, a.organizationId);
    await forceReturnAssetCore(ctx, a.organizationId, a.assetId, a.userId, a.now, loc);
    return { success: true };
  },
});

/**
 * Batch force-return of serialised assets: skip any missing / cross-org / non-CHECKED_OUT
 * asset (per-item, partial-success), return the rest. `loc` resolved once. Returns the
 * ids actually reset so a caller can name them for an audit. Shared by the requireService
 * mirror AND the browser-direct `warehouseWrites.bulkForceReturnAssets`.
 */
export async function bulkForceReturnAssetsCore(ctx: Ctx, organizationId: string, assetIds: string[], userId: string, now: number, loc: string | null): Promise<{ succeeded: string[] }> {
  const succeeded: string[] = [];
  for (const assetId of assetIds) {
    const asset = await assetByCuid(ctx, assetId);
    if (!asset || asset.organizationId !== organizationId || asset.status !== "CHECKED_OUT") continue;
    await forceReturnAssetCore(ctx, organizationId, assetId, userId, now, loc);
    succeeded.push(assetId);
  }
  return { succeeded };
}

export const bulkForceReturnAssets = mutation({
  args: { organizationId: v.string(), assetIds: v.array(v.string()), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const loc = await defaultLocationId(ctx, a.organizationId);
    const { succeeded } = await bulkForceReturnAssetsCore(ctx, a.organizationId, a.assetIds, a.userId, a.now, loc);
    return { count: succeeded.length };
  },
});

async function restoreKitParentLine(
  ctx: Ctx,
  parent: { _id: import("./_generated/dataModel").Id<"projectLineItems">; id: string; status?: string },
  organizationId: string,
  loc: string | null,
  now: number,
  kitsToRestore: Set<string>,
): Promise<void> {
  const children = await childLines(ctx, parent.id, organizationId);
  const nestedKitChildren = children.filter((c) => c.kitId);
  for (const child of nestedKitChildren) {
    const grandchildren = await childLines(ctx, child.id, organizationId);
    for (const gc of grandchildren) if (gc.status === "CHECKED_OUT") await ctx.db.patch(gc._id, FORCE_RET(now));
    await setAssetsStatus(ctx, grandchildren.filter((g) => g.assetId).map((g) => g.assetId!), "AVAILABLE", loc, true, now);
  }
  const childKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];
  for (const nk of childKitIds) {
    kitsToRestore.add(nk);
    const k = await kitByCuid(ctx, nk);
    if (k) {
      if (loc != null) await ctx.db.patch(k._id, { status: "AVAILABLE", locationId: loc, updatedAt: now });
      else { const { _id, _creationTime, locationId: _l, ...rest } = k; await ctx.db.replace(_id, { ...rest, status: "AVAILABLE", updatedAt: now }); }
    }
  }
  for (const c of children) if (c.status === "CHECKED_OUT") await ctx.db.patch(c._id, FORCE_RET(now));
  await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), "AVAILABLE", loc, true, now);
  if (parent.status === "CHECKED_OUT") await ctx.db.patch(parent._id, FORCE_RET(now));
}

/**
 * Core force-return for ONE already-validated (existing, in-org, non-AVAILABLE) kit:
 * restore every parent line + children/grandchildren, nested kits + their assets,
 * member units + accessories, bulk quantities, and the root kit. `loc` (the default
 * location) is PASSED so a batch resolves it once. Returns the set of kit ids it
 * restored (incl. nested kits). Guards live in the callers so the singular can throw
 * while the batch collects per-item errors.
 */
export async function forceReturnKitCore(
  ctx: Ctx,
  organizationId: string,
  kit: NonNullable<Awaited<ReturnType<typeof kitByCuid>>>,
  userId: string,
  now: number,
  loc: string | null,
): Promise<string[]> {
  const kitsToRestore = new Set<string>([kit.id]);

  const parents = (await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kit.id)).collect())
    .filter((l) => l.organizationId === organizationId && !l.isKitChild);
  for (const p of parents) {
    await restoreKitParentLine(ctx, p, organizationId, loc, now, kitsToRestore);
    // Kit per-unit: flip this kit's CHECKED_OUT member units → RETURNED (and its
    // accessories) so a force-return doesn't leave members stuck deployed.
    await patchKitMemberUnits(ctx, p.id, organizationId, ["CHECKED_OUT"], (u) => ({ status: "RETURNED", returnedQuantity: u.quantity ?? 1, returnedAt: now, returnedById: userId, returnCondition: "GOOD" }), now);
    await cascadeKitAccessoriesIn(ctx, p.id, organizationId, { projectId: p.projectId, userId, defaultLocationId: loc, returnCondition: "GOOD" });
  }

  if (loc != null) await ctx.db.patch(kit._id, { status: "AVAILABLE", locationId: loc, updatedAt: now });
  else { const { _id, _creationTime, locationId: _l, ...rest } = kit; await ctx.db.replace(_id, { ...rest, status: "AVAILABLE", updatedAt: now }); }

  const adjustments: BulkAdjustment[] = [];
  for (const kid of kitsToRestore) adjustments.push(...(await collectKitBulkAdjustments(ctx, kid, organizationId, 1)));
  if (adjustments.length > 0) await adjustBulkAvailability(ctx, organizationId, coalesceAdjustments(adjustments));
  return [...kitsToRestore];
}

export const forceReturnKit = mutation({
  args: { organizationId: v.string(), kitId: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await kitByCuid(ctx, a.kitId);
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    if (kit.status === "AVAILABLE") throw new ConvexError("Kit is already available");
    const loc = await defaultLocationId(ctx, a.organizationId);
    const affectedKitIds = await forceReturnKitCore(ctx, a.organizationId, kit, a.userId, a.now, loc);
    return { success: true, affectedKitIds };
  },
});

/**
 * Batch force-return (bulk single-call invariant, Phase 3): force-return N kits in
 * ONE Convex array mutation instead of the client firing one server round-trip per
 * kit. Partial-success ({succeeded, errors}) — a missing / cross-org / already-AVAILABLE
 * kit is skipped with an error and can't abort the batch. Per-item `organizationId`
 * re-check (`by_cuid` is a GLOBAL index → a cross-tenant id must be rejected). `loc`
 * is resolved once for the whole batch.
 */
/**
 * Batch force-return loop (partial-success): per-item `organizationId` re-check
 * (`by_cuid` is a GLOBAL index) — a missing / cross-org / already-AVAILABLE kit is
 * skipped with an error and can't abort the batch. `loc` resolved once by the caller.
 * Shared by the requireService mirror AND the browser-direct `warehouseWrites.forceReturnKits`.
 */
export async function forceReturnKitsBatchCore(ctx: Ctx, organizationId: string, kitIds: string[], userId: string, now: number, loc: string | null): Promise<{ succeeded: string[]; errors: { kitId: string; error: string }[]; affectedKitIds: string[] }> {
  const succeeded: string[] = [];
  const errors: { kitId: string; error: string }[] = [];
  const affected = new Set<string>();
  for (const kitId of kitIds) {
    const kit = await kitByCuid(ctx, kitId);
    if (!kit || kit.organizationId !== organizationId) { errors.push({ kitId, error: "Kit not found" }); continue; }
    if (kit.status === "AVAILABLE") { errors.push({ kitId, error: "Kit is already available" }); continue; }
    const aff = await forceReturnKitCore(ctx, organizationId, kit, userId, now, loc);
    succeeded.push(kitId);
    for (const k of aff) affected.add(k);
  }
  return { succeeded, errors, affectedKitIds: [...affected] };
}

export const forceReturnKitsBatch = mutation({
  args: { organizationId: v.string(), kitIds: v.array(v.string()), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const loc = await defaultLocationId(ctx, a.organizationId);
    return forceReturnKitsBatchCore(ctx, a.organizationId, a.kitIds, a.userId, a.now, loc);
  },
});

export type QuickAddArgs = {
  organizationId: string; projectId: string; modelId: string;
  assetId?: string; bulkAssetId?: string; quantity?: number; prepContainer?: string; userId: string; now: number;
};

/** Core quick-add: T&T preflight, EQUIPMENT line-item create (prepped), scan log.
 *  NO logActivity (scanLog only) — matches the server. Shared by the requireService
 *  mirror AND the browser-direct `warehouseWrites.quickAddAndCheckOut`. The browser
 *  write org-validates the client modelId/assetId/bulkAssetId BEFORE calling this
 *  (this core inserts them verbatim, as the trusted server always did). */
export async function quickAddCore(ctx: Ctx, a: QuickAddArgs): Promise<{ id: string }> {
    await assertTestTagAllowsCheckout(ctx, a.organizationId, {
      assetIds: a.assetId ? [a.assetId] : [], bulkAssetIds: a.bulkAssetId ? [a.bulkAssetId] : [],
    });
    const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
      .filter((l) => l.organizationId === a.organizationId);
    const sortOrder = lines.reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
    const id = createId();
    await ctx.db.insert("projectLineItems", {
      id, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT", modelId: a.modelId,
      assetId: a.assetId, bulkAssetId: a.bulkAssetId, quantity: a.quantity ?? 1, sortOrder, status: "CONFIRMED",
      checkedOutQuantity: 0, prepStatus: "PENDING", prepContainer: a.prepContainer, createdAt: a.now, updatedAt: a.now,
    });
    await scanLog(ctx, { organizationId: a.organizationId, ...(a.assetId ? { assetId: a.assetId } : {}), ...(a.bulkAssetId ? { bulkAssetId: a.bulkAssetId } : {}), projectId: a.projectId, action: "CHECK_OUT", scannedById: a.userId, scannedAt: a.now, notes: "Added to project and prepped via warehouse scan" });
    return { id };
}

export const quickAdd = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), modelId: v.string(),
    assetId: v.optional(v.string()), bulkAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()), prepContainer: v.optional(v.string()), userId: v.string(), now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return quickAddCore(ctx, a);
  },
});

export type EnsureContainerArgs = { organizationId: string; projectId: string; assetId: string; modelId: string; containerName: string; now: number };

/** Core check-then-create of a container line item (idempotent via the existing
 *  (asset, project, isContainerLineItem) uniqueness check). Shared. */
export async function ensureContainerOnProjectCore(ctx: Ctx, a: EnsureContainerArgs): Promise<{ id: string; created: boolean }> {
  const existing = (await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", a.assetId)).collect())
    .find((l) => l.projectId === a.projectId && l.organizationId === a.organizationId && l.isContainerLineItem);
  if (existing) return { id: existing.id, created: false };
  const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
    .filter((l) => l.organizationId === a.organizationId);
  const sortOrder = lines.reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
  const id = createId();
  await ctx.db.insert("projectLineItems", {
    id, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT", modelId: a.modelId, assetId: a.assetId,
    quantity: 1, sortOrder, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PACKED", prepContainer: a.containerName,
    isContainerLineItem: true, createdAt: a.now, updatedAt: a.now,
  });
  return { id, created: true };
}

export const ensureContainerOnProject = mutation({
  args: { organizationId: v.string(), projectId: v.string(), assetId: v.string(), modelId: v.string(), containerName: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return ensureContainerOnProjectCore(ctx, a);
  },
});

export type ClearPrepContainerArgs = { organizationId: string; projectId: string; containerName: string; now: number };

/** Core clear-prep-container (strip prepContainer off every line in the container). Shared. */
export async function clearPrepContainerCore(ctx: Ctx, a: ClearPrepContainerArgs): Promise<{ success: true }> {
  const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
    .filter((l) => l.organizationId === a.organizationId && l.prepContainer === a.containerName);
  for (const l of lines) {
    const { _id, _creationTime, prepContainer: _p, ...rest } = l;
    await ctx.db.replace(_id, { ...rest, updatedAt: a.now });
  }
  return { success: true };
}

export const clearPrepContainer = mutation({
  args: { organizationId: v.string(), projectId: v.string(), containerName: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return clearPrepContainerCore(ctx, a);
  },
});

export type SetSalePickedArgs = { organizationId: string; lineItemId: string; picked: boolean; now: number };

/**
 * NEW_STOCK sale-item pick checklist toggle (2026-08 warehouse sales-prep split).
 * Deliberately NOT the scan-driven `flipLineUnits`/prepStatus family below — a
 * NEW_STOCK sale line has no asset/bulk unit to flip. Callers (warehouseWrites.ts)
 * are responsible for confirming the line is actually a NEW_STOCK sale line before
 * calling this — it re-checks here too so a bad caller can't flip the field on an
 * EQUIPMENT line and confuse it with real prep status.
 */
export async function setSalePickedCore(ctx: Ctx, a: SetSalePickedArgs): Promise<{ id: string }> {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", a.lineItemId)).first();
  if (!line || line.organizationId !== a.organizationId) throw new ConvexError("Line item not found");
  if (line.type !== "SALE" || line.saleMode !== "NEW_STOCK") {
    throw new ConvexError("Only NEW_STOCK sale line items can be marked picked");
  }
  await ctx.db.patch(line._id, { salePickedAt: a.picked ? a.now : undefined, updatedAt: a.now });
  return { id: a.lineItemId };
}

/**
 * Batch container roll-up (bulk single-call invariant, Phase 3): sync N containers
 * in ONE array mutation instead of the client firing one `syncContainerStatus` per
 * container after a bulk checkout/checkin. The project's lines are read ONCE and
 * bucketed by `prepContainer` (the singular re-scanned by_projectId every call);
 * every line carries exactly one prepContainer, so the buckets are disjoint and a
 * prior container's patch can't stale another's snapshot — identical to N singular
 * calls. Each container runs the singular's rollup logic (flip the container line +
 * its asset when all contents are uniformly deployed/returned). Org scoping is
 * inherent (by_projectId scan filtered to organizationId).
 */
export type SyncContainersBatchArgs = { organizationId: string; projectId: string; containerNames: string[]; userId: string; now: number };

/** Core batch container roll-up (read lines once, bucket by prepContainer, flip each
 *  container line + asset when contents are uniformly deployed/returned). Shared. */
export async function syncContainersBatchCore(ctx: Ctx, a: SyncContainersBatchArgs): Promise<{ results: Array<{ containerName: string; updated: boolean; status?: string }> }> {
  const allLines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
    .filter((l) => l.organizationId === a.organizationId);
  const results: Array<{ containerName: string; updated: boolean; status?: string }> = [];
  for (const containerName of a.containerNames) {
      const lines = allLines.filter((l) => l.prepContainer === containerName);
      const containerLI = lines.find((l) => l.isContainerLineItem);
      if (!containerLI) { results.push({ containerName, updated: false }); continue; }
      const contents = lines.filter((l) => !l.isContainerLineItem);
      if (contents.length === 0) { results.push({ containerName, updated: false }); continue; }
      const allDeployed = contents.every((i) => i.status === "CHECKED_OUT");
      const allReturned = contents.every((i) => i.status === "RETURNED");
      const allDeployedFlag = allDeployed && containerLI.status !== "CHECKED_OUT";
      const allReturnedFlag = allReturned && containerLI.status !== "RETURNED";
      if (!allDeployedFlag && !allReturnedFlag) { results.push({ containerName, updated: false }); continue; }
      if (allDeployedFlag) {
        await ctx.db.patch(containerLI._id, { status: "CHECKED_OUT", checkedOutQuantity: containerLI.quantity ?? 1, checkedOutAt: a.now, checkedOutById: a.userId, updatedAt: a.now });
      } else {
        await ctx.db.patch(containerLI._id, { status: "RETURNED", returnedQuantity: 1, returnedAt: a.now, returnedById: a.userId, returnCondition: "GOOD", updatedAt: a.now });
      }
      if (containerLI.assetId) {
        await setAssetsStatus(ctx, [containerLI.assetId], allDeployedFlag ? "CHECKED_OUT" : "AVAILABLE", null, false, a.now);
      }
      results.push({ containerName, updated: true, status: allDeployedFlag ? "CHECKED_OUT" : "RETURNED" });
    }
    return { results };
}

export const syncContainersBatch = mutation({
  args: { organizationId: v.string(), projectId: v.string(), containerNames: v.array(v.string()), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    return syncContainersBatchCore(ctx, a);
  },
});

// ── Bulk check-in (Group G) ───────────────────────────────────────────────────

export const checkInBulkTotals = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), userId: v.string(),
    returns: v.array(v.object({ key: v.string(), quantity: v.number(), condition: v.optional(v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING"))) })),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const wanted = a.returns.filter((r) => r && typeof r.quantity === "number" && r.quantity > 0);
    if (wanted.length === 0) return { returned: [] as Array<{ key: string; quantity: number; condition: string }> };

    const defaultLoc = await defaultLocationId(ctx, a.organizationId);
    // Range-scan only CHECKED_OUT lines for this project via the composite index
    // (was: collect ALL of the project's lines then JS-filter on status). The
    // remaining predicate (org / not-subhire-group / accessory-or-not-kit-child)
    // stays a JS post-filter over the now-smaller candidate set.
    const rows = (await ctx.db.query("projectLineItems")
      .withIndex("by_projectId_status", (q) => q.eq("projectId", a.projectId).eq("status", "CHECKED_OUT"))
      .collect())
      .filter((r) => r.organizationId === a.organizationId && !r.subHireGroupId && (!r.isKitChild || r.childKind === "ACCESSORY"))
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));

    // Batch-load the distinct models the rows reference once (rows share models),
    // instead of a per-row models.by_cuid point-read inside toInput.
    const modelIds = [...new Set(rows.map((r) => r.modelId).filter((m): m is string => !!m))];
    const modelById = new Map(
      (await Promise.all(
        modelIds.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique()),
      ))
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .map((m) => [m.id, m] as const),
    );

    const toInput = async (child: typeof rows[number]): Promise<CheckInItem> => {
      const units = await lineUnits(ctx, child.id);
      let outstanding: number;
      if (units.length > 0) {
        outstanding = units.reduce((s, u) => u.status === "CHECKED_OUT" ? s + Math.max(0, (u.quantity ?? 0) - (u.returnedQuantity ?? 0)) : s, 0);
      } else outstanding = child.status !== "CHECKED_OUT" ? 0 : Math.max(0, (child.checkedOutQuantity ?? 0) - (child.returnedQuantity ?? 0));
      let itemType: CheckInItemType;
      if (child.childKind === "ACCESSORY") itemType = "ACCESSORY";
      else if (child.isCustomItem) itemType = "CUSTOM";
      else if (child.subHireId) itemType = "SUBHIRE";
      else if (child.bulkAssetId) itemType = "OWNED_BULK";
      else itemType = "OWNED_SERIALISED";
      const model = child.modelId ? modelById.get(child.modelId) ?? null : null;
      return {
        lineItemId: child.id, modelId: child.modelId ?? null, modelName: model?.name ?? null, modelNumber: model?.modelNumber ?? null,
        assetId: child.assetId ?? null, bulkAssetId: child.bulkAssetId ?? null, subHireId: child.subHireId ?? null,
        isCustomItem: !!child.isCustomItem, childKind: child.childKind ?? null, sortOrder: child.sortOrder ?? 0, outstanding, itemType,
      };
    };

    const byKey = new Map<string, CheckInItem[]>();
    const labelByKey = new Map<string, string>();
    for (const r of rows) {
      const input = await toInput(r);
      const key = itemGroupKey(input);
      if (!key) continue;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(input);
      if (!labelByKey.has(key)) labelByKey.set(key, input.modelName ?? (input.itemType === "ACCESSORY" ? "Accessory" : "Item"));
    }

    const summary: Array<{ key: string; quantity: number; condition: string }> = [];
    for (const req of wanted) {
      const condition = req.condition ?? "GOOD";
      const groupChildren = byKey.get(req.key) ?? [];
      const { allocations, distributed } = distributeReturn(groupChildren, req.quantity);
      if (distributed < req.quantity) {
        const available = groupChildren.reduce((s, c) => s + Math.max(0, c.outstanding), 0);
        throw new ConvexError(`Cannot return ${req.quantity} of "${labelByKey.get(req.key) ?? req.key}" — only ${available} currently deployed.`);
      }
      const assetsTouched: string[] = [];
      for (const alloc of allocations) {
        if (alloc.itemType === "SUBHIRE" || alloc.itemType === "CUSTOM") {
          const line = await lineByCuid(ctx, alloc.lineItemId);
          if (!line) continue;
          const newReturned = (line.returnedQuantity ?? 0) + alloc.quantity;
          const fully = newReturned >= (line.checkedOutQuantity ?? 0);
          await ctx.db.patch(line._id, {
            status: fully ? "RETURNED" : "CHECKED_OUT", returnedQuantity: newReturned, returnCondition: condition,
            ...(fully ? { returnedAt: a.now, returnedById: a.userId } : {}), updatedAt: a.now,
          });
          continue;
        }
        const { assetsTouched: touched } = await returnLineUnits(ctx, {
          organizationId: a.organizationId, projectId: a.projectId, lineItemId: alloc.lineItemId,
          assetId: alloc.assetId ?? undefined, bulkAssetId: alloc.bulkAssetId ?? undefined,
          returnCondition: condition, quantity: alloc.quantity, userId: a.userId, defaultLocationId: defaultLoc,
        });
        await syncLineItemRollup(ctx, alloc.lineItemId);
        assetsTouched.push(...touched);
      }
      for (const assetId of assetsTouched) {
        await scanLog(ctx, { organizationId: a.organizationId, assetId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: `Bulk check-in (${condition})` });
      }
      await scanLog(ctx, { organizationId: a.organizationId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: `Bulk check-in: ${distributed}x ${labelByKey.get(req.key) ?? req.key} (${condition})` });
      summary.push({ key: req.key, quantity: distributed, condition });
    }
    return { returned: summary };
  },
});

/**
 * Reassign a serialised unit from its current line to another line on the SAME
 * project + SAME model — the "correct the auto-pick" action from the equipment
 * tab. The physical asset does NOT move (same project, same deployment); only
 * which order line it fulfils changes. Both lines' rollups are recomputed.
 *
 * Guards (all ConvexError so the payload survives the prod boundary):
 *  - unit must be serialised (has assetId) and not RETURNED/CANCELLED (history);
 *  - target line must be same org, same project, same model as the asset;
 *  - the asset can't already be on the target line (unique (line, asset));
 *  - the target line can't be over-assigned past its quantity.
 * Permission / activity-log stay in the server action (this is service-only).
 */
/**
 * Core serialised-unit reassign (move a unit to a different line on the same project +
 * model). `now` is PASSED so the browser wrapper writes a deterministic timestamp
 * shared with its audit row. All guards live here (thorough) — the browser wrapper
 * still org-validates the client FKs at its boundary before calling. Shared by the
 * requireService mirror AND browser-direct `warehouseWrites.reassignLineItemUnit`.
 */
export async function reassignSerialisedUnitCore(ctx: Ctx, organizationId: string, unitId: string, targetLineItemId: string, now: number) {
  const unit = await unitByCuid(ctx, unitId);
  if (!unit || unit.organizationId !== organizationId) throw new ConvexError("Unit not found in this organization");
  if (!unit.assetId) throw new ConvexError("Only serialised (asset-tagged) units can be reassigned");
  if (unit.status === "RETURNED" || unit.status === "CANCELLED") {
    throw new ConvexError("Returned units are history and can't be reassigned");
  }
  const sourceLineId = unit.lineItemId;
  if (sourceLineId === targetLineItemId) return { moved: false as const };

  const [sourceLine, targetLine, asset] = await Promise.all([
    lineByCuid(ctx, sourceLineId),
    lineByCuid(ctx, targetLineItemId),
    assetByCuid(ctx, unit.assetId),
  ]);
  if (!sourceLine) throw new ConvexError("Source line not found");
  if (!targetLine || targetLine.organizationId !== organizationId) throw new ConvexError("Target line not found in this organization");
  if (targetLine.projectId !== sourceLine.projectId) throw new ConvexError("Can only reassign within the same project");
  if (!asset || asset.organizationId !== organizationId) throw new ConvexError("Asset not found in this organization");
  if (!asset.modelId || targetLine.modelId !== asset.modelId) throw new ConvexError("That line is a different model");
  if (targetLine.isKitChild) throw new ConvexError("Kit members are fulfilled by the kit; reassign the kit instead");

  const clash = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId_assetId", (q) => q.eq("lineItemId", targetLineItemId).eq("assetId", unit.assetId!))
    .unique();
  if (clash) throw new ConvexError(`${asset.assetTag} is already on the target line`);

  const targetSiblings = await lineUnits(ctx, targetLineItemId);
  const assigned = targetSiblings.filter((u) => u.status !== "CANCELLED").length;
  if (assigned >= (targetLine.quantity ?? 0)) throw new ConvexError("Target line is already fully assigned");

  await ctx.db.patch(unit._id, {
    lineItemId: targetLineItemId,
    ordinal: nextOrdinal(targetSiblings),
    updatedAt: now,
  });
  await syncLineItemRollup(ctx, sourceLineId);
  await syncLineItemRollup(ctx, targetLineItemId);
  return {
    moved: true as const,
    assetTag: asset.assetTag,
    fromLineItemId: sourceLineId,
    toLineItemId: targetLineItemId,
  };
}

export const reassignSerialisedUnit = mutation({
  args: {
    organizationId: v.string(),
    unitId: v.string(),
    targetLineItemId: v.string(),
  },
  handler: async (ctx, { organizationId, unitId, targetLineItemId }) => {
    await requireService(ctx);
    return reassignSerialisedUnitCore(ctx, organizationId, unitId, targetLineItemId, Date.now());
  },
});

/**
 * Kit-member serial reassign (Phase 4). A kit member is bound to its kit slot, so
 * "reassign" here means SWAP which physical serial fills that slot on this job —
 * point the member's unit (and its snapshot child line) at a different same-model
 * AVAILABLE asset — NOT move it to another line (that's reassignSerialisedUnit for
 * loose gear). The kit DEFINITION (kitSerializedItems) is shared across projects
 * and is never touched; only this project's snapshot changes. The parity guard is
 * model-based, so a same-model swap doesn't trip it.
 *
 * Before deployment only: once the member is CHECKED_OUT the asset is physically
 * out, so a swap would be a physical return+redeploy (out of scope — un-deploy the
 * kit first). Pre-deployment neither asset's status changes (both stay AVAILABLE
 * until checkout), so this is a pure pointer swap.
 */
/**
 * Core kit-member serial swap. `now` is PASSED so the browser wrapper writes a
 * deterministic timestamp shared with its audit row. All guards live here (thorough) —
 * the browser wrapper still org-validates the client FKs at its boundary before
 * calling. Shared by the requireService mirror AND browser-direct
 * `warehouseWrites.reassignKitMemberSerial`.
 */
export async function reassignKitMemberSerialCore(ctx: Ctx, organizationId: string, unitId: string, newAssetId: string, now: number) {
  const unit = await unitByCuid(ctx, unitId);
  if (!unit || unit.organizationId !== organizationId) throw new ConvexError("Unit not found in this organization");
  if (!unit.assetId) throw new ConvexError("Only serialised (asset-tagged) members can be reassigned");
  if (unit.status === "CHECKED_OUT") throw new ConvexError("This member is deployed — un-deploy the kit before swapping its serial");
  if (unit.status === "RETURNED" || unit.status === "CANCELLED") throw new ConvexError("Returned units are history and can't be reassigned");
  if (unit.assetId === newAssetId) return { moved: false as const };

  const line = await lineByCuid(ctx, unit.lineItemId);
  if (!line) throw new ConvexError("Line not found");
  if (!line.isKitChild) throw new ConvexError("Loose gear reassigns by line — use reassignSerialisedUnit");

  const [current, next] = await Promise.all([assetByCuid(ctx, unit.assetId), assetByCuid(ctx, newAssetId)]);
  if (!current) throw new ConvexError("Current asset not found");
  if (!next || next.organizationId !== organizationId) throw new ConvexError("Replacement asset not found in this organization");
  if (!next.modelId || next.modelId !== current.modelId) throw new ConvexError("Replacement must be the same model");
  if (next.status !== "AVAILABLE") throw new ConvexError(`${next.assetTag} is not available`);
  if (next.isActive === false) throw new ConvexError(`${next.assetTag} is retired`);

  // The replacement must not already fill another live member of THIS kit.
  if (line.parentLineItemId) {
    for (const sib of await childLines(ctx, line.parentLineItemId, organizationId)) {
      const sibUnits = await lineUnits(ctx, sib.id);
      if (sibUnits.some((u) => u.assetId === newAssetId && u.status !== "CANCELLED" && u.status !== "RETURNED")) {
        throw new ConvexError(`${next.assetTag} is already assigned to this kit`);
      }
    }
  }

  // Swap the serial on both the unit and its snapshot child line. Pre-deployment
  // neither asset's status changes (both AVAILABLE until checkout).
  await ctx.db.patch(unit._id, { assetId: newAssetId, updatedAt: now });
  await ctx.db.patch(line._id, { assetId: newAssetId, updatedAt: now });
  await syncLineItemRollup(ctx, line.id);
  return { moved: true as const, fromAssetTag: current.assetTag, toAssetTag: next.assetTag, lineItemId: line.id };
}

export const reassignKitMemberSerial = mutation({
  args: { organizationId: v.string(), unitId: v.string(), newAssetId: v.string() },
  handler: async (ctx, { organizationId, unitId, newAssetId }) => {
    await requireService(ctx);
    return reassignKitMemberSerialCore(ctx, organizationId, unitId, newAssetId, Date.now());
  },
});
