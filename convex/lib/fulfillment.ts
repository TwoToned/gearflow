/**
 * Convex port of `src/lib/line-item-fulfillment.ts` (Phase C mega-flip).
 *
 * Every Prisma `$transaction` helper becomes a function taking the Convex
 * `MutationCtx`; the surrounding mutation is the transaction (ACID + serializable
 * via OCC). Two Postgres-specific concurrency tricks in the source collapse here:
 *   - the `SELECT … FOR UPDATE` row lock in expandAccessoriesForAsset (serialised
 *     for free — a Convex mutation is per-document serializable), and
 *   - the `SAVEPOINT` 23505-swallow in createAccessoryChildIfAbsent (just a
 *     check-then-insert; a concurrent racer serializes and the loser re-reads).
 *
 * Keep behaviour in lockstep with the source until the Prisma version is deleted.
 */
import { ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import { adjustBulkAvailability } from "./inventory";
import {
  computeRollupCounters,
  deriveOrderLineStatus,
  deriveOrderLinePrepStatus,
  deriveOrderLineReturnCondition,
  nextOrdinal,
  type UnitLike,
} from "./lineItemUnits";
import { bumpAssetCounters } from "./counters";

type Ctx = MutationCtx;

export async function lineUnits(ctx: Ctx, lineItemId: string) {
  return await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
    .collect();
}

async function assetDocByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function lineDocByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}

/** A parent line's ACCESSORY child lines — one shared query (R-9.8 collect-ratchet:
 *  four call sites duplicated this exact `by_parentLineItemId` + childKind filter
 *  before this helper). */
async function accessoryChildrenOf(ctx: Ctx, organizationId: string, parentLineItemId: string) {
  return (
    await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", parentLineItemId)).collect()
  ).filter((c) => c.organizationId === organizationId && c.childKind === "ACCESSORY");
}

/** A model's configured bulk accessories — shared by every expansion/reconcile
 *  site that reads the model-level template (R-9.8 collect-ratchet). */
async function modelBulkAccessoriesOf(ctx: Ctx, modelId: string) {
  return await ctx.db.query("modelBulkAccessories").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect();
}

/** Recompute + persist a line's rollup counters/status from its unit rows. */
export async function syncLineItemRollup(ctx: Ctx, lineItemId: string): Promise<void> {
  const line = await lineDocByCuid(ctx, lineItemId);
  if (!line) return;
  const units = await lineUnits(ctx, lineItemId);
  const unitLikes: UnitLike[] = units.map((u) => ({
    quantity: u.quantity ?? 0,
    returnedQuantity: u.returnedQuantity ?? 0,
    status: u.status ?? "CONFIRMED",
    prepStatus: u.prepStatus,
    returnCondition: u.returnCondition,
    returnStatus: u.returnStatus,
  }));
  await ctx.db.patch(line._id, {
    ...computeRollupCounters(unitLikes),
    status: deriveOrderLineStatus(line.status ?? "CONFIRMED", unitLikes) as typeof line.status,
    prepStatus: (deriveOrderLinePrepStatus(line.prepStatus, unitLikes) ?? undefined) as typeof line.prepStatus,
    returnCondition: (deriveOrderLineReturnCondition(line.returnCondition, unitLikes) ?? undefined) as typeof line.returnCondition,
    updatedAt: Date.now(),
  });
}

/** Find-or-create the serialised unit for a (line, asset) pair. */
export async function ensureSerialisedUnit(
  ctx: Ctx,
  args: { organizationId: string; lineItemId: string; assetId: string },
): Promise<{ id: string; created: boolean }> {
  const existing = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId_assetId", (q) => q.eq("lineItemId", args.lineItemId).eq("assetId", args.assetId))
    .unique();
  if (existing) return { id: existing.id, created: false };

  const siblings = await lineUnits(ctx, args.lineItemId);
  const id = createId();
  const now = Date.now();
  await ctx.db.insert("projectLineItemUnits", {
    id,
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    ordinal: nextOrdinal(siblings),
    assetId: args.assetId,
    quantity: 1,
    returnedQuantity: 0,
    status: "CONFIRMED",
    createdAt: now,
    updatedAt: now,
  });
  return { id, created: true };
}

/** Find-or-create the single bulk unit row for a line. */
export async function ensureBulkUnit(
  ctx: Ctx,
  args: { organizationId: string; lineItemId: string; bulkAssetId: string; quantity: number },
): Promise<{ id: string; created: boolean }> {
  const units = await lineUnits(ctx, args.lineItemId);
  const existing = units.find((u) => u.bulkAssetId === args.bulkAssetId);
  if (existing) return { id: existing.id, created: false };

  const id = createId();
  const now = Date.now();
  await ctx.db.insert("projectLineItemUnits", {
    id,
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    ordinal: 1,
    bulkAssetId: args.bulkAssetId,
    quantity: args.quantity,
    returnedQuantity: 0,
    status: "CONFIRMED",
    createdAt: now,
    updatedAt: now,
  });
  return { id, created: true };
}

/** Find-or-create a per-parent-unit ACCESSORY unit on an accessory child line. */
export async function ensureAccessoryUnit(
  ctx: Ctx,
  args: {
    organizationId: string;
    lineItemId: string;
    parentUnitAssetId: string;
    assetId?: string | null;
    bulkAssetId?: string | null;
    quantity: number;
  },
): Promise<{ id: string; created: boolean }> {
  const units = await lineUnits(ctx, args.lineItemId);
  const existing = units.find(
    (u) =>
      u.parentUnitAssetId === args.parentUnitAssetId &&
      (args.assetId ? u.assetId === args.assetId : u.bulkAssetId === (args.bulkAssetId ?? undefined)),
  );
  if (existing) return { id: existing.id, created: false };

  const id = createId();
  const now = Date.now();
  await ctx.db.insert("projectLineItemUnits", {
    id,
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    ordinal: nextOrdinal(units),
    assetId: args.assetId ?? undefined,
    bulkAssetId: args.assetId ? undefined : args.bulkAssetId ?? undefined,
    parentUnitAssetId: args.parentUnitAssetId,
    quantity: args.quantity,
    returnedQuantity: 0,
    status: "CONFIRMED",
    createdAt: now,
    updatedAt: now,
  });
  return { id, created: true };
}

/** Return condition → canonical asset status on checkin. */
export function assetStatusFromReturnCondition(
  cond: "GOOD" | "DAMAGED" | "MISSING",
): "AVAILABLE" | "IN_MAINTENANCE" | "LOST" {
  if (cond === "DAMAGED") return "IN_MAINTENANCE";
  if (cond === "MISSING") return "LOST";
  return "AVAILABLE";
}

async function setAssetStatus(ctx: Ctx, assetId: string, status: string, locationId: string | null) {
  const a = await assetDocByCuid(ctx, assetId);
  if (!a) return;
  // locationId may be cleared: patch can't set undefined, so replace when clearing.
  if (locationId === null) {
    const { _id, _creationTime, locationId: _drop, ...rest } = a;
    await ctx.db.replace(_id, { ...rest, status: status as typeof a.status, updatedAt: Date.now() });
  } else {
    await ctx.db.patch(a._id, { status: status as typeof a.status, locationId, updatedAt: Date.now() });
  }
  // §3.6 dashboard counter: check-in / return status churn (CHECKED_OUT→AVAILABLE
  // etc.) flows through here, not warehouseOps.setAssetsStatus. isActive untouched.
  await bumpAssetCounters(ctx, a.organizationId, a, { isActive: a.isActive, status });
}

/**
 * Return one or many units on a line — the single source of truth for what
 * "returning" means physically (flip unit rows to RETURNED, restore assets).
 * Couples asset.status + unit status; caller owns syncLineItemRollup.
 */
export async function returnLineUnits(
  ctx: Ctx,
  args: {
    organizationId: string;
    projectId: string;
    lineItemId: string;
    assetId?: string | null;
    bulkAssetId?: string | null;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string | null;
    userId: string;
    defaultLocationId: string | null;
  },
): Promise<{ unitsFlipped: number; assetsTouched: string[] }> {
  const assetStatus = assetStatusFromReturnCondition(args.returnCondition);
  const now = Date.now();
  const lineItem = await lineDocByCuid(ctx, args.lineItemId);
  if (!lineItem || lineItem.projectId !== args.projectId || lineItem.organizationId !== args.organizationId) {
    throw new ConvexError("line item not found for return");
  }
  const units = await lineUnits(ctx, lineItem.id);

  // 1. Specific asset (scan)
  const targetAssetId = args.assetId || lineItem.assetId || null;
  if (targetAssetId) {
    const unit = units.find((u) => u.assetId === targetAssetId);
    if (!unit) {
      // Kit child / legacy line — flip the line + asset directly.
      await ctx.db.patch(lineItem._id, {
        status: "RETURNED",
        returnedQuantity: lineItem.quantity ?? 0,
        returnedAt: now,
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || undefined,
        updatedAt: now,
      });
      await setAssetStatus(ctx, targetAssetId, assetStatus, args.defaultLocationId);
      return { unitsFlipped: 0, assetsTouched: [targetAssetId] };
    }
    if (unit.status === "CHECKED_OUT") {
      await ctx.db.patch(unit._id, {
        status: "RETURNED",
        returnedAt: now,
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || undefined,
        updatedAt: now,
      });
      await setAssetStatus(ctx, targetAssetId, assetStatus, args.defaultLocationId);
      return { unitsFlipped: 1, assetsTouched: [targetAssetId] };
    }
    return { unitsFlipped: 0, assetsTouched: [targetAssetId] };
  }

  // 2. Bulk line return
  const targetBulkId = args.bulkAssetId || lineItem.bulkAssetId || null;
  if (targetBulkId) {
    const bulkUnits = units
      .filter((u) => u.bulkAssetId === targetBulkId && u.status === "CHECKED_OUT")
      .sort((a, b) => a.ordinal - b.ordinal);
    // Default to the FULL remaining checked-out quantity, not 1. The old `?? 1`
    // meant one click returned a single unit, forcing "click return 16 times" for a
    // 16-unit bulk line. When the caller passes an explicit quantity, honour it.
    const totalRemaining = bulkUnits.reduce((sum, u) => sum + ((u.quantity ?? 0) - (u.returnedQuantity ?? 0)), 0);
    const returnQty = args.quantity ?? totalRemaining;
    let remaining = returnQty;
    for (const unit of bulkUnits) {
      if (remaining <= 0) break;
      const qty = unit.quantity ?? 0;
      const prevReturned = unit.returnedQuantity ?? 0;
      const canReturn = Math.min(remaining, qty - prevReturned);
      if (canReturn <= 0) continue;
      const newReturned = prevReturned + canReturn;
      const fullyReturned = newReturned >= qty;
      await ctx.db.patch(unit._id, {
        returnedQuantity: newReturned,
        status: fullyReturned ? "RETURNED" : "CHECKED_OUT",
        returnedAt: fullyReturned ? now : unit.returnedAt,
        returnedById: fullyReturned ? args.userId : unit.returnedById,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || unit.returnNotes,
        updatedAt: now,
      });
      remaining -= canReturn;
    }
    // Standalone (non-kit-child) bulk lines release back to the shared shelf
    // pool directly (issue #801 #2), mirroring collectKitBulkAdjustments'
    // unconditional restore on kit check-in — a bulk asset has no per-unit
    // condition bucket to route DAMAGED/MISSING returns into, so (like kits)
    // the full actually-returned quantity always goes back regardless of
    // `returnCondition`. Kit members never reach this branch through their own
    // checkin (patchKitMemberUnits, not returnLineUnits); accessory children are
    // out of scope here (see FEATUREDOCS/48's SHIPS_WITH/DEDICATED split) —
    // both set isKitChild, so this single flag is the right gate.
    const actuallyReturned = returnQty - remaining;
    if (!lineItem.isKitChild && actuallyReturned > 0) {
      await adjustBulkAvailability(ctx, args.organizationId, [{ bulkAssetId: targetBulkId, delta: actuallyReturned }]);
    }
    return { unitsFlipped: bulkUnits.length, assetsTouched: [] };
  }

  // 3. Partial or whole-line return
  const outUnits = units.filter((u) => u.status === "CHECKED_OUT").sort((a, b) => a.ordinal - b.ordinal);
  if (outUnits.length === 0) {
    await ctx.db.patch(lineItem._id, {
      status: "RETURNED",
      returnedQuantity: lineItem.checkedOutQuantity || lineItem.quantity || 0,
      returnedAt: now,
      returnedById: args.userId,
      returnCondition: args.returnCondition,
      returnNotes: args.notes || undefined,
      updatedAt: now,
    });
    return { unitsFlipped: 0, assetsTouched: [] };
  }
  const unitsToFlip =
    args.quantity != null
      ? outUnits.slice(0, Math.max(0, Math.min(args.quantity, outUnits.length)))
      : outUnits;
  const assetsTouched: string[] = [];
  for (const u of unitsToFlip) {
    await ctx.db.patch(u._id, {
      status: "RETURNED",
      returnedAt: now,
      returnedById: args.userId,
      returnCondition: args.returnCondition,
      returnNotes: args.notes || undefined,
      ...(u.bulkAssetId ? { returnedQuantity: u.quantity ?? 0 } : {}),
      updatedAt: now,
    });
    if (u.assetId) {
      await setAssetStatus(ctx, u.assetId, assetStatus, args.defaultLocationId);
      assetsTouched.push(u.assetId);
    }
  }
  return { unitsFlipped: unitsToFlip.length, assetsTouched };
}

/** Return a parent line's accessory children alongside the parent (scoped by parent unit). */
export async function checkinAccessoryChildren(
  ctx: Ctx,
  args: {
    organizationId: string;
    projectId: string;
    parentLineItemId: string;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    userId: string;
    defaultLocationId: string | null;
    returnedAssetId?: string | null;
  },
): Promise<{ assetsTouched: string[] }> {
  const returnedAssetId = args.returnedAssetId ?? null;
  const assetStatus = assetStatusFromReturnCondition(args.returnCondition);
  const now = Date.now();

  const children = await accessoryChildrenOf(ctx, args.organizationId, args.parentLineItemId);
  if (children.length === 0) return { assetsTouched: [] };

  const assetsTouched: string[] = [];
  for (const child of children) {
    const units = (await lineUnits(ctx, child.id)).filter(
      (u) =>
        u.status === "CHECKED_OUT" &&
        (returnedAssetId ? u.parentUnitAssetId === returnedAssetId : true),
    );
    for (const u of units) {
      await ctx.db.patch(u._id, {
        status: "RETURNED",
        returnedAt: now,
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        ...(u.bulkAssetId ? { returnedQuantity: u.quantity ?? 0 } : {}),
        updatedAt: now,
      });
      if (u.assetId) {
        await setAssetStatus(ctx, u.assetId, assetStatus, args.defaultLocationId);
        assetsTouched.push(u.assetId);
      }
    }
    await syncLineItemRollup(ctx, child.id);
  }
  return { assetsTouched };
}

type AccessoryProfile = {
  serialised: Array<{ assetId: string; modelId: string | null; modelName: string | null }>;
  bulks: Array<{ bulkAssetId: string; quantity: number; modelId: string | null; modelName: string | null }>;
};

/** A parent line's durable per-line accessory selection (issue #794). Absent/null
 *  ⇒ template behaviour (all model DEFAULTs, no OPTIONALs). */
export type AccessoryPlan = {
  excluded: string[];
  added: Array<{ bulkAssetId: string; quantityPerParent?: number }>;
};

async function modelName(ctx: Ctx, modelId: string | null | undefined): Promise<string | null> {
  if (!modelId) return null;
  const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).unique();
  return m?.name ?? null;
}

/**
 * The one function every accessory-expansion site consults — office add
 * (`expandAccessoryChildLines`), warehouse prep, and warehouse checkout
 * (`expandAccessoriesForAsset`) — so a deselected/added accessory can never be
 * resurrected by a site that re-derives the set from raw config (issue #794
 * design: "office decides, warehouse verifies", one source of truth per rule —
 * POLICY R-3.1/R-8.2.4).
 *
 * Effective set = asset-level serialised + bulk children (always included —
 * physically attached, no plan control) UNION model DEFAULT bulk accessories
 * MINUS `plan.excluded` UNION model OPTIONAL bulk accessories the PM opted
 * into via `plan.added` (using `quantityPerParent` if given, else the model's
 * template quantity). Asset-level still wins `bulkAssetId` conflicts with the
 * model, same as before. `plan` absent/null ⇒ template behaviour (every
 * DEFAULT, no OPTIONALs) — existing lines with no plan are unaffected.
 */
export async function resolveLineAccessoryPlan(
  ctx: Ctx,
  organizationId: string,
  assetId: string,
  plan: AccessoryPlan | null | undefined,
): Promise<AccessoryProfile> {
  const asset = await assetDocByCuid(ctx, assetId);
  if (!asset || asset.organizationId !== organizationId) return { serialised: [], bulks: [] };

  const childAssets = await ctx.db
    .query("assets")
    .withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", assetId))
    .collect();
  const childBulkItems = await ctx.db
    .query("assetBulkChildren")
    .withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", assetId))
    .collect();
  const assetBulkIds = new Set(childBulkItems.map((b) => b.bulkAssetId));
  const modelBulks = asset.modelId ? await modelBulkAccessoriesOf(ctx, asset.modelId) : [];

  const excluded = new Set(plan?.excluded ?? []);
  const added = new Map((plan?.added ?? []).map((a) => [a.bulkAssetId, a]));

  const bulks: AccessoryProfile["bulks"] = [];
  for (const b of childBulkItems) {
    const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).unique();
    bulks.push({ bulkAssetId: b.bulkAssetId, quantity: b.quantity, modelId: ba?.modelId ?? null, modelName: await modelName(ctx, ba?.modelId) });
  }
  for (const m of modelBulks) {
    if (assetBulkIds.has(m.bulkAssetId)) continue; // asset-level override wins
    const inclusion = m.inclusion ?? "DEFAULT";
    if (inclusion === "DEFAULT") {
      if (excluded.has(m.bulkAssetId)) continue; // PM deselected this default for this line
    } else if (!added.has(m.bulkAssetId)) {
      continue; // OPTIONAL, not opted into by this line's plan
    }
    const quantity = added.get(m.bulkAssetId)?.quantityPerParent ?? m.quantity;
    const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", m.bulkAssetId)).unique();
    bulks.push({ bulkAssetId: m.bulkAssetId, quantity, modelId: ba?.modelId ?? null, modelName: await modelName(ctx, ba?.modelId) });
  }
  const serialised: AccessoryProfile["serialised"] = [];
  for (const c of childAssets) {
    serialised.push({ assetId: c.id, modelId: c.modelId ?? null, modelName: await modelName(ctx, c.modelId) });
  }
  return { serialised, bulks };
}

/** Expand a specific serialised asset's permanent accessories onto a line as child lines. */
export async function expandAccessoriesForAsset(
  ctx: Ctx,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId: string;
    includeAccessoryIds?: Set<string> | null;
  },
): Promise<string[]> {
  const { organizationId, lineItemId, assetId } = args;
  const includeAccessoryIds = args.includeAccessoryIds ?? null;
  const line = await lineDocByCuid(ctx, lineItemId);
  if (!line || line.organizationId !== organizationId || line.childKind) return [];
  const plan = (line.accessoryPlan as AccessoryPlan | undefined) ?? null;

  const fullProfile = await resolveLineAccessoryPlan(ctx, organizationId, assetId, plan);
  const profile: AccessoryProfile = includeAccessoryIds
    ? {
        serialised: fullProfile.serialised.filter((s) => includeAccessoryIds.has(s.assetId)),
        bulks: fullProfile.bulks.filter((b) => includeAccessoryIds.has(b.bulkAssetId)),
      }
    : fullProfile;
  if (profile.serialised.length === 0 && profile.bulks.length === 0) return [];

  // Total bulk demand summed across every ACTIVE parent unit (the per-handheld
  // battery-kit invariant). The Prisma FOR UPDATE lock is unnecessary here —
  // the mutation is serializable, so a concurrent expansion sees committed units.
  const allUnits = await lineUnits(ctx, lineItemId);
  const parentAssetIds = new Set<string>([assetId]);
  for (const u of allUnits) {
    if (u.assetId && u.status !== "RETURNED" && u.status !== "CANCELLED") parentAssetIds.add(u.assetId);
  }
  const profiles = new Map<string, AccessoryProfile>([[assetId, profile]]);
  for (const aid of parentAssetIds) {
    if (!profiles.has(aid)) profiles.set(aid, await resolveLineAccessoryPlan(ctx, organizationId, aid, plan));
  }
  const bulkDemand = new Map<string, number>();
  for (const p of profiles.values()) {
    for (const b of p.bulks) bulkDemand.set(b.bulkAssetId, (bulkDemand.get(b.bulkAssetId) ?? 0) + b.quantity);
  }

  const existing = await accessoryChildrenOf(ctx, organizationId, lineItemId);
  const existingByAsset = new Map(existing.filter((e) => e.assetId).map((e) => [e.assetId as string, e.id]));
  const existingBulk = new Map(existing.filter((e) => e.bulkAssetId).map((e) => [e.bulkAssetId as string, e.id]));

  const created: string[] = [];
  let sort = existing.length;
  const now = Date.now();
  const baseChild = {
    organizationId,
    projectId: line.projectId,
    type: "EQUIPMENT" as const,
    isKitChild: true,
    childKind: "ACCESSORY" as const,
    parentLineItemId: lineItemId,
    categoryId: line.categoryId,
    groupId: line.groupId,
    pricingType: line.pricingType,
    duration: line.duration,
  };

  for (const child of profile.serialised) {
    let childLineId = existingByAsset.get(child.assetId) ?? null;
    if (!childLineId) {
      childLineId = createId();
      await ctx.db.insert("projectLineItems", {
        ...baseChild,
        id: childLineId,
        modelId: child.modelId ?? undefined,
        assetId: child.assetId,
        quantity: 1,
        description: child.modelName ?? undefined,
        sortOrder: sort++,
        status: "CONFIRMED",
        createdAt: now,
        updatedAt: now,
      });
      existingByAsset.set(child.assetId, childLineId);
      created.push(childLineId);
    }
    await ensureAccessoryUnit(ctx, { organizationId, lineItemId: childLineId, parentUnitAssetId: assetId, assetId: child.assetId, quantity: 1 });
  }

  for (const bulk of profile.bulks) {
    const demand = bulkDemand.get(bulk.bulkAssetId) ?? bulk.quantity;
    const description = bulk.modelName ? `${demand}x ${bulk.modelName}` : undefined;
    let childLineId = existingBulk.get(bulk.bulkAssetId) ?? null;
    if (childLineId) {
      const cl = await lineDocByCuid(ctx, childLineId);
      if (cl) await ctx.db.patch(cl._id, { quantity: demand, description, updatedAt: now });
    } else {
      childLineId = createId();
      await ctx.db.insert("projectLineItems", {
        ...baseChild,
        id: childLineId,
        modelId: bulk.modelId ?? undefined,
        bulkAssetId: bulk.bulkAssetId,
        quantity: demand,
        description,
        sortOrder: sort++,
        status: "CONFIRMED",
        createdAt: now,
        updatedAt: now,
      });
      existingBulk.set(bulk.bulkAssetId, childLineId);
      created.push(childLineId);
    }
    await ensureAccessoryUnit(ctx, { organizationId, lineItemId: childLineId, parentUnitAssetId: assetId, bulkAssetId: bulk.bulkAssetId, quantity: bulk.quantity });
  }
  return created;
}

/**
 * Create-time accessory expansion (port of line-items.ts expandAccessoryChildren).
 * Creates accessory CHILD LINES (no units — units materialise at prep) for a new
 * parent line: a specific serialised asset expands its own serialised+bulk
 * children unioned with its model defaults; a model-level line expands the
 * model's default bulk accessories scaled by the line quantity.
 */
export async function expandAccessoryChildLines(
  ctx: Ctx,
  parentLine: {
    id: string;
    assetId: string | null | undefined;
    modelId: string | null | undefined;
    quantity: number;
    categoryId: string | null | undefined;
    groupId: string | null | undefined;
    duration: number | null | undefined;
    pricingType: string | null | undefined;
    organizationId: string;
    projectId: string;
    accessoryPlan?: AccessoryPlan | null;
  },
): Promise<void> {
  const now = Date.now();
  const plan = parentLine.accessoryPlan ?? null;
  const base = {
    organizationId: parentLine.organizationId,
    projectId: parentLine.projectId,
    type: "EQUIPMENT" as const,
    isKitChild: true,
    childKind: "ACCESSORY" as const,
    parentLineItemId: parentLine.id,
    categoryId: parentLine.categoryId ?? undefined,
    groupId: parentLine.groupId ?? undefined,
    pricingType: (parentLine.pricingType ?? undefined) as never,
    duration: parentLine.duration ?? undefined,
    status: "CONFIRMED" as const,
  };
  let sort = 0;

  if (parentLine.assetId) {
    const profile = await resolveLineAccessoryPlan(ctx, parentLine.organizationId, parentLine.assetId, plan);
    if (profile.serialised.length === 0 && profile.bulks.length === 0) return;
    for (const child of profile.serialised) {
      await ctx.db.insert("projectLineItems", {
        ...base, id: createId(), modelId: child.modelId ?? undefined, assetId: child.assetId,
        quantity: 1, description: child.modelName ?? undefined, sortOrder: sort++, createdAt: now, updatedAt: now,
      });
    }
    for (const b of profile.bulks) {
      await ctx.db.insert("projectLineItems", {
        ...base, id: createId(), modelId: b.modelId ?? undefined, bulkAssetId: b.bulkAssetId,
        quantity: b.quantity, description: b.modelName ? `${b.quantity}x ${b.modelName}` : undefined,
        sortOrder: sort++, createdAt: now, updatedAt: now,
      });
    }
    return;
  }

  if (parentLine.modelId) {
    const modelBulks = await modelBulkAccessoriesOf(ctx, parentLine.modelId);
    if (modelBulks.length === 0) return;
    const excluded = new Set(plan?.excluded ?? []);
    const added = new Map((plan?.added ?? []).map((a) => [a.bulkAssetId, a]));
    for (const b of modelBulks) {
      const inclusion = b.inclusion ?? "DEFAULT";
      if (inclusion === "DEFAULT") {
        if (excluded.has(b.bulkAssetId)) continue;
      } else if (!added.has(b.bulkAssetId)) {
        continue;
      }
      const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).unique();
      const perParent = added.get(b.bulkAssetId)?.quantityPerParent ?? b.quantity;
      const qty = perParent * Math.max(parentLine.quantity, 1);
      const name = await modelName(ctx, ba?.modelId);
      await ctx.db.insert("projectLineItems", {
        ...base, id: createId(), modelId: ba?.modelId ?? undefined, bulkAssetId: b.bulkAssetId,
        quantity: qty, description: name ? `${qty}x ${name}` : undefined, sortOrder: sort++, createdAt: now, updatedAt: now,
      });
    }
  }
}

/**
 * Reconcile a parent line's accessory children to a NEWLY-SAVED `accessoryPlan` —
 * the post-add "Edit accessories" path (issue #794). Diffs the wanted set (same
 * DEFAULT-minus-excluded / OPTIONAL-plus-added resolution `expandAccessoryChildLines`
 * uses) against existing children: creates newly-added children, deletes newly-
 * excluded ones (plus their units), and rescales a kept bulk child's quantity —
 * closing the "quantity-merge path never rescales" limitation for this path.
 * Caller owns the deploy-lock guard (block once any unit of the PARENT has
 * shipped); this function additionally refuses to delete a child that itself has
 * a CHECKED_OUT unit, since narrowing a live deployment isn't a "plan edit".
 */
type WantedSerialised = Map<string, { modelId: string | null; modelName: string | null }>;
type WantedBulk = Map<string, { quantity: number; modelId: string | null; modelName: string | null }>;
type ReconcileParentLine = {
  id: string;
  assetId: string | null | undefined;
  modelId: string | null | undefined;
  quantity: number;
  categoryId: string | null | undefined;
  groupId: string | null | undefined;
  duration: number | null | undefined;
  pricingType: string | null | undefined;
  organizationId: string;
  projectId: string;
};

type WantedSet = { wantSerialised: WantedSerialised; wantBulk: WantedBulk };
type ExistingAccessoryChildren = Awaited<ReturnType<typeof accessoryChildrenOf>>;

/** The wanted set for an asset-based parent line — every accessory
 *  resolveLineAccessoryPlan resolves for that specific asset. */
async function wantedSetForAsset(ctx: Ctx, organizationId: string, assetId: string, plan: AccessoryPlan | null): Promise<WantedSet> {
  const wantSerialised: WantedSerialised = new Map();
  const wantBulk: WantedBulk = new Map();
  const profile = await resolveLineAccessoryPlan(ctx, organizationId, assetId, plan);
  for (const s of profile.serialised) wantSerialised.set(s.assetId, { modelId: s.modelId, modelName: s.modelName });
  for (const b of profile.bulks) wantBulk.set(b.bulkAssetId, { quantity: b.quantity, modelId: b.modelId, modelName: b.modelName });
  return { wantSerialised, wantBulk };
}

/** Whether a single model bulk accessory belongs in the effective set. */
function isWantedModelBulk(b: { bulkAssetId: string; inclusion?: "DEFAULT" | "OPTIONAL" }, excluded: Set<string>, added: Map<string, { bulkAssetId: string; quantityPerParent?: number }>): boolean {
  return (b.inclusion ?? "DEFAULT") === "DEFAULT" ? !excluded.has(b.bulkAssetId) : added.has(b.bulkAssetId);
}

/** Resolve one wanted model bulk accessory's map entry (quantity scaled by
 *  parent line quantity, bulk-asset model name resolved). */
async function resolveWantedModelBulkEntry(
  ctx: Ctx,
  b: { bulkAssetId: string; quantity: number },
  added: Map<string, { bulkAssetId: string; quantityPerParent?: number }>,
  parentQuantity: number,
): Promise<WantedBulk extends Map<string, infer V> ? V : never> {
  const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).unique();
  const perParent = added.get(b.bulkAssetId)?.quantityPerParent ?? b.quantity;
  return {
    quantity: perParent * Math.max(parentQuantity, 1),
    modelId: ba?.modelId ?? null,
    modelName: await modelName(ctx, ba?.modelId),
  };
}

/** The wanted set for a model-based parent line — no serialised accessories
 *  (no specific asset to resolve them from), only the model's bulk template
 *  filtered by inclusion/plan. */
async function wantedSetForModel(ctx: Ctx, parentLine: ReconcileParentLine, plan: AccessoryPlan | null): Promise<WantedSet> {
  const wantBulk: WantedBulk = new Map();
  const modelBulks = await modelBulkAccessoriesOf(ctx, parentLine.modelId!);
  const excluded = new Set(plan?.excluded ?? []);
  const added = new Map((plan?.added ?? []).map((a) => [a.bulkAssetId, a]));
  for (const b of modelBulks) {
    if (!isWantedModelBulk(b, excluded, added)) continue;
    wantBulk.set(b.bulkAssetId, await resolveWantedModelBulkEntry(ctx, b, added, parentLine.quantity));
  }
  return { wantSerialised: new Map(), wantBulk };
}

/** The effective accessory set a plan resolves to for a parent line — same
 *  DEFAULT-minus-excluded / OPTIONAL-plus-added resolution as
 *  expandAccessoryChildLines, factored out so reconcileLineAccessoryChildren
 *  stays under the complexity ratchet (R-3.6). */
async function computeWantedAccessorySet(ctx: Ctx, parentLine: ReconcileParentLine, plan: AccessoryPlan | null): Promise<WantedSet> {
  if (parentLine.assetId) return wantedSetForAsset(ctx, parentLine.organizationId, parentLine.assetId, plan);
  if (parentLine.modelId) return wantedSetForModel(ctx, parentLine, plan);
  return { wantSerialised: new Map(), wantBulk: new Map() };
}

function isWantedChild(child: ExistingAccessoryChildren[number], wanted: WantedSet): boolean {
  if (child.assetId) return wanted.wantSerialised.has(child.assetId);
  if (child.bulkAssetId) return wanted.wantBulk.has(child.bulkAssetId);
  return false;
}

/** Rescale a kept bulk child's quantity if the wanted set's demand changed. */
async function rescaleKeptBulkChild(ctx: Ctx, child: ExistingAccessoryChildren[number], wanted: WantedSet, now: number): Promise<void> {
  if (!child.bulkAssetId) return;
  const want = wanted.wantBulk.get(child.bulkAssetId)!;
  if (child.quantity === want.quantity) return;
  const desc = want.modelName ? `${want.quantity}x ${want.modelName}` : child.description;
  await ctx.db.patch(child._id, { quantity: want.quantity, description: desc, updatedAt: now });
}

/** Delete a no-longer-wanted accessory child + its units. Throws if a unit has
 *  itself already deployed — narrowing a live deployment isn't a "plan edit". */
async function dropAccessoryChild(ctx: Ctx, child: ExistingAccessoryChildren[number]): Promise<void> {
  const units = await lineUnits(ctx, child.id);
  if (units.some((u) => u.status === "CHECKED_OUT")) {
    throw new ConvexError(
      `${child.description ?? "An accessory"} on this line has already deployed — return it before editing the accessory plan.`,
    );
  }
  for (const u of units) await ctx.db.delete(u._id);
  await ctx.db.delete(child._id);
}

/** Drop (or rescale) existing accessory children the wanted set no longer covers. */
async function dropUnwantedAccessoryChildren(ctx: Ctx, existing: ExistingAccessoryChildren, wanted: WantedSet, now: number): Promise<void> {
  for (const child of existing) {
    if (isWantedChild(child, wanted)) await rescaleKeptBulkChild(ctx, child, wanted, now);
    else await dropAccessoryChild(ctx, child);
  }
}

/** Shared insert base for a newly-reconciled accessory child. */
function accessoryChildInsertBase(parentLine: ReconcileParentLine) {
  return {
    organizationId: parentLine.organizationId,
    projectId: parentLine.projectId,
    type: "EQUIPMENT" as const,
    isKitChild: true,
    childKind: "ACCESSORY" as const,
    parentLineItemId: parentLine.id,
    categoryId: parentLine.categoryId ?? undefined,
    groupId: parentLine.groupId ?? undefined,
    pricingType: (parentLine.pricingType ?? undefined) as never,
    duration: parentLine.duration ?? undefined,
    status: "CONFIRMED" as const,
  };
}

async function insertMissingSerialisedAccessories(
  ctx: Ctx, parentLine: ReconcileParentLine, existingAssetIds: Set<string>, wantSerialised: WantedSerialised, sort: { n: number }, now: number,
): Promise<void> {
  const base = accessoryChildInsertBase(parentLine);
  for (const [assetId, s] of wantSerialised) {
    if (existingAssetIds.has(assetId)) continue;
    await ctx.db.insert("projectLineItems", {
      ...base, id: createId(), modelId: s.modelId ?? undefined, assetId,
      quantity: 1, description: s.modelName ?? undefined, sortOrder: sort.n++, createdAt: now, updatedAt: now,
    });
  }
}

async function insertMissingBulkAccessories(
  ctx: Ctx, parentLine: ReconcileParentLine, existingBulkIds: Set<string>, wantBulk: WantedBulk, sort: { n: number }, now: number,
): Promise<void> {
  const base = accessoryChildInsertBase(parentLine);
  for (const [bulkAssetId, b] of wantBulk) {
    if (existingBulkIds.has(bulkAssetId)) continue;
    await ctx.db.insert("projectLineItems", {
      ...base, id: createId(), modelId: b.modelId ?? undefined, bulkAssetId,
      quantity: b.quantity, description: b.modelName ? `${b.quantity}x ${b.modelName}` : undefined,
      sortOrder: sort.n++, createdAt: now, updatedAt: now,
    });
  }
}

/** Create child lines for wanted accessories that don't already exist. */
async function insertMissingAccessoryChildren(ctx: Ctx, parentLine: ReconcileParentLine, existing: ExistingAccessoryChildren, wanted: WantedSet, now: number): Promise<void> {
  const existingAssetIds = new Set(existing.filter((c) => c.assetId).map((c) => c.assetId as string));
  const existingBulkIds = new Set(existing.filter((c) => c.bulkAssetId).map((c) => c.bulkAssetId as string));
  const sort = { n: existing.length };
  await insertMissingSerialisedAccessories(ctx, parentLine, existingAssetIds, wanted.wantSerialised, sort, now);
  await insertMissingBulkAccessories(ctx, parentLine, existingBulkIds, wanted.wantBulk, sort, now);
}

export async function reconcileLineAccessoryChildren(ctx: Ctx, parentLine: ReconcileParentLine, plan: AccessoryPlan | null): Promise<void> {
  const now = Date.now();
  const wanted = await computeWantedAccessorySet(ctx, parentLine, plan);
  const existing = await accessoryChildrenOf(ctx, parentLine.organizationId, parentLine.id);
  await dropUnwantedAccessoryChildren(ctx, existing, wanted, now);
  await insertMissingAccessoryChildren(ctx, parentLine, existing, wanted, now);
}

/** Mark a unit prepped/packed (pick-and-pack before checkout). Rolls the line up. */
export async function prepUnit(
  ctx: Ctx,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId?: string | null;
    bulkAssetId?: string | null;
    quantity?: number;
    prepContainer?: string | null;
    includeAccessoryIds?: Set<string> | null;
  },
): Promise<void> {
  const now = Date.now();
  if (args.assetId) {
    const { id } = await ensureSerialisedUnit(ctx, { organizationId: args.organizationId, lineItemId: args.lineItemId, assetId: args.assetId });
    const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (u) {
      await ctx.db.patch(u._id, {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
        updatedAt: now,
      });
    }
    await expandAccessoriesForAsset(ctx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      assetId: args.assetId,
      includeAccessoryIds: args.includeAccessoryIds ?? null,
    });
    // Pack the accessory units tied to this parent unit.
    const accChildren = await accessoryChildrenOf(ctx, args.organizationId, args.lineItemId);
    for (const child of accChildren) {
      const units = (await lineUnits(ctx, child.id)).filter(
        (un) => un.parentUnitAssetId === args.assetId && un.status !== "CHECKED_OUT",
      );
      for (const un of units) {
        await ctx.db.patch(un._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
          updatedAt: now,
        });
      }
    }
  } else if (args.bulkAssetId) {
    // A bulk line keeps ONE unit per (line, bulkAsset) carrying the packed quantity.
    // The old code OVERWROTE that unit's quantity to args.quantity on every call, so
    // when the client expanded a bulk prep into N `{quantity: 1}` entries the unit
    // collapsed to 1 (last write wins) — the "16 on the job but shows qty 1" bug.
    // ACCUMULATE instead (capped at the line's ordered quantity): correct whether
    // the caller sends one aggregate entry or N per-unit entries, and correct for
    // incremental prep (prep 3, then 5 more → 8).
    const addQty = args.quantity ?? 1;
    const line = await lineDocByCuid(ctx, args.lineItemId);
    const ordered = line?.quantity ?? addQty;
    const existing = (await lineUnits(ctx, args.lineItemId)).find((un) => un.bulkAssetId === args.bulkAssetId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        quantity: Math.min(ordered, (existing.quantity ?? 0) + addQty),
        ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
        updatedAt: now,
      });
    } else {
      const { id } = await ensureBulkUnit(ctx, { organizationId: args.organizationId, lineItemId: args.lineItemId, bulkAssetId: args.bulkAssetId, quantity: Math.min(ordered, addQty) });
      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (u) {
        await ctx.db.patch(u._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
          updatedAt: now,
        });
      }
    }
  } else {
    const line = await lineDocByCuid(ctx, args.lineItemId);
    if (line) {
      const ordered = line.quantity ?? 0;
      if (ordered > 1) {
        // Untagged multi-quantity line (no serialised asset, no bulk asset).
        // Track prep per unit — one qty-1 "generic" row per packed item — so a
        // partial selection packs only that many and the rest stay in Pick.
        // (Whole-line prep here is what caused "prep 1 of 10 → all 10 move".)
        const existing = await lineUnits(ctx, args.lineItemId);
        const assigned = existing.reduce((n, u) => n + (u.quantity ?? 0), 0);
        const room = Math.max(0, ordered - assigned);
        const toCreate = Math.min(Math.max(1, args.quantity ?? 1), room);
        let ordinal = nextOrdinal(existing);
        for (let i = 0; i < toCreate; i++) {
          await ctx.db.insert("projectLineItemUnits", {
            id: createId(),
            organizationId: args.organizationId,
            lineItemId: args.lineItemId,
            ordinal: ordinal++,
            quantity: 1,
            returnedQuantity: 0,
            status: "CONFIRMED",
            prepStatus: "PACKED",
            ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        // Single-unit / legacy generic line — whole-line prep (unchanged).
        await ctx.db.patch(line._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
          updatedAt: now,
        });
      }
    }
  }
  await syncLineItemRollup(ctx, args.lineItemId);
}
