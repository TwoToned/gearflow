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
import {
  computeRollupCounters,
  deriveOrderLineStatus,
  deriveOrderLinePrepStatus,
  nextOrdinal,
  type UnitLike,
} from "./lineItemUnits";

type Ctx = MutationCtx;

async function lineUnits(ctx: Ctx, lineItemId: string) {
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
    const returnQty = args.quantity ?? 1;
    const bulkUnits = units
      .filter((u) => u.bulkAssetId === targetBulkId && u.status === "CHECKED_OUT")
      .sort((a, b) => a.ordinal - b.ordinal);
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

  const children = (
    await ctx.db
      .query("projectLineItems")
      .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", args.parentLineItemId))
      .collect()
  ).filter((c) => c.organizationId === args.organizationId && c.childKind === "ACCESSORY");
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

async function modelName(ctx: Ctx, modelId: string | null | undefined): Promise<string | null> {
  if (!modelId) return null;
  const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).unique();
  return m?.name ?? null;
}

/** A parent asset's per-unit accessory profile (serialised children + bulk accessories). */
export async function resolveAssetAccessories(
  ctx: Ctx,
  organizationId: string,
  assetId: string,
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
  const modelBulks = asset.modelId
    ? await ctx.db.query("modelBulkAccessories").withIndex("by_modelId", (q) => q.eq("modelId", asset.modelId!)).collect()
    : [];

  const bulks: AccessoryProfile["bulks"] = [];
  for (const b of childBulkItems) {
    const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).unique();
    bulks.push({ bulkAssetId: b.bulkAssetId, quantity: b.quantity, modelId: ba?.modelId ?? null, modelName: await modelName(ctx, ba?.modelId) });
  }
  for (const m of modelBulks) {
    if (assetBulkIds.has(m.bulkAssetId)) continue;
    const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", m.bulkAssetId)).unique();
    bulks.push({ bulkAssetId: m.bulkAssetId, quantity: m.quantity, modelId: ba?.modelId ?? null, modelName: await modelName(ctx, ba?.modelId) });
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

  const fullProfile = await resolveAssetAccessories(ctx, organizationId, assetId);
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
    if (!profiles.has(aid)) profiles.set(aid, await resolveAssetAccessories(ctx, organizationId, aid));
  }
  const bulkDemand = new Map<string, number>();
  for (const p of profiles.values()) {
    for (const b of p.bulks) bulkDemand.set(b.bulkAssetId, (bulkDemand.get(b.bulkAssetId) ?? 0) + b.quantity);
  }

  const existing = (
    await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", lineItemId)).collect()
  ).filter((e) => e.childKind === "ACCESSORY" && e.organizationId === organizationId);
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
  },
): Promise<void> {
  const now = Date.now();
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
    const profile = await resolveAssetAccessories(ctx, parentLine.organizationId, parentLine.assetId);
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
    const modelBulks = await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_modelId", (q) => q.eq("modelId", parentLine.modelId!))
      .collect();
    if (modelBulks.length === 0) return;
    for (const b of modelBulks) {
      const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).unique();
      const qty = b.quantity * Math.max(parentLine.quantity, 1);
      const name = await modelName(ctx, ba?.modelId);
      await ctx.db.insert("projectLineItems", {
        ...base, id: createId(), modelId: ba?.modelId ?? undefined, bulkAssetId: b.bulkAssetId,
        quantity: qty, description: name ? `${qty}x ${name}` : undefined, sortOrder: sort++, createdAt: now, updatedAt: now,
      });
    }
  }
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
    const accChildren = (
      await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", args.lineItemId)).collect()
    ).filter((c) => c.childKind === "ACCESSORY");
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
    const { id } = await ensureBulkUnit(ctx, { organizationId: args.organizationId, lineItemId: args.lineItemId, bulkAssetId: args.bulkAssetId, quantity: args.quantity ?? 1 });
    const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (u) {
      await ctx.db.patch(u._id, {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
        ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer ?? undefined } : {}),
        updatedAt: now,
      });
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
