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
import { resolveLiveVersionIdForProject, versionRows } from "./versionScope";

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
export async function accessoryChildrenOf(ctx: Ctx, organizationId: string, parentLineItemId: string) {
  return (
    // VERSION-SCOPE: safe — child/group rows are always stamped with their parent's versionId at write time (insert-side stamping + materializeVersionRowsNative's FK remap), and reached here only via an already-resolved, version-specific parent id — never mixes versions.
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

/** Find-or-create the serialised unit for a (line, asset) pair. Uses `.collect()` +
 *  take-first rather than `.unique()`: a duplicate row on `by_lineItemId_assetId`
 *  (e.g. from an old double-submit before the client had pending-state guards)
 *  must not turn every future checkout of that asset into a masked Convex system
 *  error — degrade to "use the first one" instead of throwing (see CLAUDE.md's
 *  `.unique()`-on-a-duplicate-row footgun). */
export async function ensureSerialisedUnit(
  ctx: Ctx,
  args: { organizationId: string; lineItemId: string; assetId: string },
): Promise<{ id: string; created: boolean }> {
  const existingRows = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId_assetId", (q) => q.eq("lineItemId", args.lineItemId).eq("assetId", args.assetId))
    .collect();
  const existing = existingRows[0];
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

const RETURN_CONDITION_SEVERITY = { GOOD: 0, DAMAGED: 1, MISSING: 2 } as const;
type ReturnCondition = keyof typeof RETURN_CONDITION_SEVERITY;
function worstReturnCondition(prev: ReturnCondition | null | undefined, next: ReturnCondition): ReturnCondition {
  if (!prev) return next;
  return RETURN_CONDITION_SEVERITY[prev] >= RETURN_CONDITION_SEVERITY[next] ? prev : next;
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
        // Partial returns accumulate: keep the WORST condition seen so a later
        // GOOD return can't hide an earlier DAMAGED/MISSING one.
        returnCondition: worstReturnCondition(unit.returnCondition, args.returnCondition),
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
  bulks: Array<{ bulkAssetId: string; quantity: number; modelId: string | null; modelName: string | null; inclusion: "DEFAULT" | "OPTIONAL" }>;
};

/** A parent line's durable per-line accessory selection (issue #794). Absent/null
 *  ⇒ template behaviour (all model DEFAULTs, no OPTIONALs). */
export type AccessoryPlan = {
  excluded: string[];
  added: Array<{ bulkAssetId: string; quantityPerParent?: number }>;
  /** Required override reason per deselected DEFAULT (issue #794 follow-up) —
   *  audit trail only, not consulted by resolution/expansion. */
  excludedReasons?: Array<{ bulkAssetId: string; reason: string }>;
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
 *
 * `presentBulkIds` — bulk accessories that ALREADY have a child line on this
 * parent line. An accessory line the PM kept on the job is an opt-in even when
 * the plan has no `added` entry (the model's tier may have been flipped to
 * OPTIONAL after the line was built); without it prep would expand nothing for
 * that line and strand it unpacked forever. `plan.excluded` still wins.
 */
export async function resolveLineAccessoryPlan(
  ctx: Ctx,
  organizationId: string,
  assetId: string,
  plan: AccessoryPlan | null | undefined,
  presentBulkIds?: ReadonlySet<string>,
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
    // Asset-level bulk children are always-default: they model physical attachment
    // to this specific unit, not a template tier (issue #794 gating follow-up).
    bulks.push({ bulkAssetId: b.bulkAssetId, quantity: b.quantity, modelId: ba?.modelId ?? null, modelName: await modelName(ctx, ba?.modelId), inclusion: "DEFAULT" });
  }
  for (const m of modelBulks) {
    if (assetBulkIds.has(m.bulkAssetId)) continue; // asset-level override wins
    const inclusion = m.inclusion ?? "DEFAULT";
    if (inclusion === "DEFAULT") {
      if (excluded.has(m.bulkAssetId)) continue; // PM deselected this default for this line
    } else if (!added.has(m.bulkAssetId) && !(presentBulkIds?.has(m.bulkAssetId) && !excluded.has(m.bulkAssetId))) {
      continue; // OPTIONAL, not opted into by this line's plan or already on the line
    }
    const quantity = added.get(m.bulkAssetId)?.quantityPerParent ?? m.quantity;
    const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", m.bulkAssetId)).unique();
    bulks.push({ bulkAssetId: m.bulkAssetId, quantity, modelId: ba?.modelId ?? null, modelName: await modelName(ctx, ba?.modelId), inclusion });
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

  const existing = await accessoryChildrenOf(ctx, organizationId, lineItemId);
  // A bulk accessory line already on this parent counts as opted in (see
  // resolveLineAccessoryPlan), so prep/checkout expand and pack it.
  const presentBulkIds = new Set(existing.filter((e) => e.bulkAssetId && e.status !== "CANCELLED").map((e) => e.bulkAssetId as string));

  const fullProfile = await resolveLineAccessoryPlan(ctx, organizationId, assetId, plan, presentBulkIds);
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
    if (!profiles.has(aid)) profiles.set(aid, await resolveLineAccessoryPlan(ctx, organizationId, aid, plan, presentBulkIds));
  }
  const bulkDemand = new Map<string, number>();
  for (const p of profiles.values()) {
    for (const b of p.bulks) bulkDemand.set(b.bulkAssetId, (bulkDemand.get(b.bulkAssetId) ?? 0) + b.quantity);
  }

  const existingByAsset = new Map(existing.filter((e) => e.assetId).map((e) => [e.assetId as string, e.id]));
  const existingBulk = new Map(existing.filter((e) => e.bulkAssetId).map((e) => [e.bulkAssetId as string, e.id]));

  const created: string[] = [];
  let sort = existing.length;
  const now = Date.now();
  const baseChild = {
    organizationId,
    projectId: line.projectId,
    // #1221 follow-up — inherit the PARENT's own versionId (it's already
    // loaded above), same reasoning as expandAccessoryChildLines/
    // accessoryChildInsertBase: an unstamped child is invisible to every
    // by_versionId read, live or not.
    versionId: line.versionId ?? undefined,
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
        lineageId: childLineId,
        modelId: child.modelId ?? undefined,
        assetId: child.assetId,
        quantity: 1,
        description: child.modelName ?? undefined,
        sortOrder: sort++,
        status: "CONFIRMED",
        accessoryInclusion: "DEFAULT",
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
      if (cl) await ctx.db.patch(cl._id, { quantity: demand, description, accessoryInclusion: bulk.inclusion, updatedAt: now });
    } else {
      childLineId = createId();
      await ctx.db.insert("projectLineItems", {
        ...baseChild,
        id: childLineId,
        lineageId: childLineId,
        modelId: bulk.modelId ?? undefined,
        bulkAssetId: bulk.bulkAssetId,
        quantity: demand,
        description,
        sortOrder: sort++,
        status: "CONFIRMED",
        accessoryInclusion: bulk.inclusion,
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
    // #1221 follow-up — the PARENT's own resolved `versionId` (the target
    // version the parent line was just inserted into, live or not). Every
    // accessory child MUST land in the SAME version as its parent, or it's
    // an orphan row: `versionId` absent matches no `by_versionId` read at
    // all (not even the live one), so before this fix a child inserted here
    // was invisible everywhere, not just on a non-live version — see
    // FEATUREDOCS/78's "closing the Equipment write-side gap" note.
    versionId: string | null | undefined;
  },
): Promise<void> {
  const now = Date.now();
  const plan = parentLine.accessoryPlan ?? null;
  const base = {
    organizationId: parentLine.organizationId,
    projectId: parentLine.projectId,
    versionId: parentLine.versionId ?? undefined,
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
      const childId = createId();
      await ctx.db.insert("projectLineItems", {
        ...base, id: childId, lineageId: childId, modelId: child.modelId ?? undefined, assetId: child.assetId,
        quantity: 1, description: child.modelName ?? undefined, sortOrder: sort++,
        accessoryInclusion: "DEFAULT", createdAt: now, updatedAt: now,
      });
    }
    for (const b of profile.bulks) {
      const childId = createId();
      await ctx.db.insert("projectLineItems", {
        ...base, id: childId, lineageId: childId, modelId: b.modelId ?? undefined, bulkAssetId: b.bulkAssetId,
        quantity: b.quantity, description: b.modelName ? `${b.quantity}x ${b.modelName}` : undefined,
        sortOrder: sort++, accessoryInclusion: b.inclusion, createdAt: now, updatedAt: now,
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
      const childId = createId();
      await ctx.db.insert("projectLineItems", {
        ...base, id: childId, lineageId: childId, modelId: ba?.modelId ?? undefined, bulkAssetId: b.bulkAssetId,
        quantity: qty, description: name ? `${qty}x ${name}` : undefined, sortOrder: sort++,
        accessoryInclusion: inclusion, createdAt: now, updatedAt: now,
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
type WantedSerialised = Map<string, { modelId: string | null; modelName: string | null; inclusion: "DEFAULT" | "OPTIONAL" }>;
type WantedBulk = Map<string, { quantity: number; modelId: string | null; modelName: string | null; inclusion: "DEFAULT" | "OPTIONAL" }>;
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
  // #1221 follow-up — see the identical field on expandAccessoryChildLines'
  // parentLine above: a reconciled child must land in the SAME version as
  // the parent it belongs to, never unstamped.
  versionId: string | null | undefined;
};

type WantedSet = { wantSerialised: WantedSerialised; wantBulk: WantedBulk };
type ExistingAccessoryChildren = Awaited<ReturnType<typeof accessoryChildrenOf>>;

/** The wanted set for an asset-based parent line — every accessory
 *  resolveLineAccessoryPlan resolves for that specific asset. */
async function wantedSetForAsset(ctx: Ctx, organizationId: string, assetId: string, plan: AccessoryPlan | null): Promise<WantedSet> {
  const wantSerialised: WantedSerialised = new Map();
  const wantBulk: WantedBulk = new Map();
  const profile = await resolveLineAccessoryPlan(ctx, organizationId, assetId, plan);
  for (const s of profile.serialised) wantSerialised.set(s.assetId, { modelId: s.modelId, modelName: s.modelName, inclusion: "DEFAULT" });
  for (const b of profile.bulks) wantBulk.set(b.bulkAssetId, { quantity: b.quantity, modelId: b.modelId, modelName: b.modelName, inclusion: b.inclusion });
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
  b: { bulkAssetId: string; quantity: number; inclusion?: "DEFAULT" | "OPTIONAL" },
  added: Map<string, { bulkAssetId: string; quantityPerParent?: number }>,
  parentQuantity: number,
): Promise<WantedBulk extends Map<string, infer V> ? V : never> {
  const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).unique();
  const perParent = added.get(b.bulkAssetId)?.quantityPerParent ?? b.quantity;
  return {
    quantity: perParent * Math.max(parentQuantity, 1),
    modelId: ba?.modelId ?? null,
    modelName: await modelName(ctx, ba?.modelId),
    inclusion: b.inclusion ?? "DEFAULT",
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
  if (child.quantity === want.quantity && child.accessoryInclusion === want.inclusion) return;
  const desc = want.modelName ? `${want.quantity}x ${want.modelName}` : child.description;
  await ctx.db.patch(child._id, { quantity: want.quantity, description: desc, accessoryInclusion: want.inclusion, updatedAt: now });
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
    versionId: parentLine.versionId ?? undefined,
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
    const childId = createId();
    await ctx.db.insert("projectLineItems", {
      ...base, id: childId, lineageId: childId, modelId: s.modelId ?? undefined, assetId,
      quantity: 1, description: s.modelName ?? undefined, sortOrder: sort.n++,
      accessoryInclusion: s.inclusion, createdAt: now, updatedAt: now,
    });
  }
}

async function insertMissingBulkAccessories(
  ctx: Ctx, parentLine: ReconcileParentLine, existingBulkIds: Set<string>, wantBulk: WantedBulk, sort: { n: number }, now: number,
): Promise<void> {
  const base = accessoryChildInsertBase(parentLine);
  for (const [bulkAssetId, b] of wantBulk) {
    if (existingBulkIds.has(bulkAssetId)) continue;
    const childId = createId();
    await ctx.db.insert("projectLineItems", {
      ...base, id: childId, lineageId: childId, modelId: b.modelId ?? undefined, bulkAssetId,
      quantity: b.quantity, description: b.modelName ? `${b.quantity}x ${b.modelName}` : undefined,
      sortOrder: sort.n++, accessoryInclusion: b.inclusion, createdAt: now, updatedAt: now,
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

/** Look up a container's label (widen-step fallback for `prepContainer` —
 *  #1296). `null`/missing/cross-org → `undefined` (no label to stamp). */
async function containerLabelById(ctx: Ctx, organizationId: string, containerId: string | null | undefined): Promise<string | undefined> {
  if (!containerId) return undefined;
  const c = await ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", containerId)).first();
  return c && c.organizationId === organizationId ? c.label : undefined;
}

/**
 * Resolves what a NEWLY-created unit's `containerId` should be (#1296, D9):
 * the caller's explicit value if one was given (a real id, or `null` for
 * "Loose" — the operator has an active rail selection), else the line's
 * `plannedContainerId` (the PM's plan; may itself be absent → loose). An
 * EXISTING unit being re-patched (a repeat prep call for the same
 * asset/bulk row) never falls back to the plan — only an explicit value
 * touches it, so a checklist-only re-prep can't silently move gear.
 */
async function resolveContainerForWrite(
  ctx: Ctx,
  args: { organizationId: string; lineItemId: string; containerId?: string | null },
  isNewUnit: boolean,
): Promise<{ containerId: string | undefined; label: string | undefined } | null> {
  if (args.containerId !== undefined) {
    return { containerId: args.containerId ?? undefined, label: await containerLabelById(ctx, args.organizationId, args.containerId) };
  }
  if (!isNewUnit) return null; // nothing explicit, existing row — leave untouched
  const line = await lineDocByCuid(ctx, args.lineItemId);
  const planned = line?.plannedContainerId ?? undefined;
  return { containerId: planned, label: await containerLabelById(ctx, args.organizationId, planned) };
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
    /** #1296 — the container to pack this prep into. `undefined` = caller
     *  gave no signal (defaults to the line's plan on a NEW unit only);
     *  `null` = explicitly Loose. Superset of the old `prepContainer`
     *  string, which callers may still pass instead (resolved to a real
     *  container one layer up, in checkRecordOps.ts). */
    containerId?: string | null;
    includeAccessoryIds?: Set<string> | null;
    /** Pack ONLY the accessories of an already-packed parent: the parent unit is
     *  left untouched (status, container) and `containerId` applies to the
     *  accessories alone, so they can live in a different box than the parent. */
    accessoriesOnly?: boolean;
  },
): Promise<void> {
  const now = Date.now();
  if (args.accessoriesOnly && !args.assetId) {
    // Bulk / untagged parent: no per-asset accessory units; this just re-runs the
    // whole-parent-packed rollup for its accessory lines.
    await packParentlessAccessories(ctx, args.organizationId, args.lineItemId);
    await syncLineItemRollup(ctx, args.lineItemId);
    return;
  }
  if (args.assetId) {
    let resolved: Awaited<ReturnType<typeof resolveContainerForWrite>>;
    if (args.accessoriesOnly) {
      const parentUnit = (await lineUnits(ctx, args.lineItemId)).find((un) => un.assetId === args.assetId);
      if (!parentUnit || parentUnit.prepStatus !== "PACKED") throw new ConvexError("Prep the item before prepping its accessories");
      resolved = await resolveContainerForWrite(ctx, args, false);
    } else {
      const { id, created } = await ensureSerialisedUnit(ctx, { organizationId: args.organizationId, lineItemId: args.lineItemId, assetId: args.assetId });
      resolved = await resolveContainerForWrite(ctx, args, created);
      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      // Never re-prep a unit that is already OUT — flipping it back to CONFIRMED
      // would silently un-deploy it with no asset/availability change.
      if (u && u.status !== "CHECKED_OUT") {
        await ctx.db.patch(u._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(resolved ? { containerId: resolved.containerId, prepContainer: resolved.label } : {}),
          updatedAt: now,
        });
      }
    }
    await expandAccessoriesForAsset(ctx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      assetId: args.assetId,
      includeAccessoryIds: args.includeAccessoryIds ?? null,
    });
    // Pack the accessory units tied to this parent unit — they inherit the
    // SAME resolution as the parent asset just prepped (existing shape,
    // now keyed on containerId).
    const accChildren = await accessoryChildrenOf(ctx, args.organizationId, args.lineItemId);
    for (const child of accChildren) {
      const narrow = args.includeAccessoryIds ?? null;
      const units = (await lineUnits(ctx, child.id)).filter(
        (un) =>
          un.parentUnitAssetId === args.assetId &&
          un.status !== "CHECKED_OUT" && un.status !== "RETURNED" && un.status !== "CANCELLED" &&
          (!narrow || narrow.has(un.assetId ?? un.bulkAssetId ?? "")),
      );
      for (const un of units) {
        await ctx.db.patch(un._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(resolved ? { containerId: resolved.containerId, prepContainer: resolved.label } : {}),
          updatedAt: now,
        });
      }
      // The warehouse reads packed state off the child LINE, not its units —
      // roll it up here exactly as checkoutAccessoryChildren does, or the
      // accessory stays "unprepped" and Deploy flags it as missing.
      await syncLineItemRollup(ctx, child.id);
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
      const resolved = await resolveContainerForWrite(ctx, args, false);
      await ctx.db.patch(existing._id, {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        quantity: Math.min(ordered, (existing.quantity ?? 0) + addQty),
        ...(resolved ? { containerId: resolved.containerId, prepContainer: resolved.label } : {}),
        updatedAt: now,
      });
    } else {
      const { id } = await ensureBulkUnit(ctx, { organizationId: args.organizationId, lineItemId: args.lineItemId, bulkAssetId: args.bulkAssetId, quantity: Math.min(ordered, addQty) });
      const resolved = await resolveContainerForWrite(ctx, args, true);
      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (u) {
        await ctx.db.patch(u._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(resolved ? { containerId: resolved.containerId, prepContainer: resolved.label } : {}),
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
        const resolved = await resolveContainerForWrite(ctx, args, true);
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
            ...(resolved ? { containerId: resolved.containerId, prepContainer: resolved.label } : {}),
            createdAt: now,
            updatedAt: now,
          });
        }
      } else if (await packSingleGenericIntoContainer(ctx, args)) {
        // A qty-1 custom/generic line packed into a REAL container got a unit
        // row carrying `containerId` (membership is per-unit, §3.3) — without
        // one the warehouse tabs and container labels cannot place it.
      } else {
        // Single-unit / legacy generic line, no real container — whole-line
        // prep (unchanged). `projectLineItems.containerId` is reserved for a
        // CONTAINER's own reverse lookup, so this branch stamps only the
        // widen-step label, same as before #1296.
        const resolved = args.containerId !== undefined
          ? { label: await containerLabelById(ctx, args.organizationId, args.containerId) }
          : null;
        await ctx.db.patch(line._id, {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          ...(resolved ? { prepContainer: resolved.label } : {}),
          updatedAt: now,
        });
      }
    }
  }
  // A parent with no serialised asset (bulk / untagged) has no per-asset accessory
  // units, so its accessory child lines would otherwise never read PACKED.
  if (!args.assetId) await packParentlessAccessories(ctx, args.organizationId, args.lineItemId);
  await syncLineItemRollup(ctx, args.lineItemId);
}

/** Qty-1 generic line (custom item, no asset): when it lands in a real container,
 *  back it with one unit row so `containerId` exists. Returns false (caller keeps
 *  the label-only whole-line path) when no real container is involved. */
async function packSingleGenericIntoContainer(
  ctx: Ctx,
  args: { organizationId: string; lineItemId: string; containerId?: string | null },
): Promise<boolean> {
  const existing = await lineUnits(ctx, args.lineItemId);
  const resolved = await resolveContainerForWrite(ctx, args, existing.length === 0);
  if (!resolved?.containerId) return false;
  const now = Date.now();
  const patch = {
    status: "CONFIRMED" as const,
    prepStatus: "PACKED" as const,
    containerId: resolved.containerId,
    prepContainer: resolved.label,
    updatedAt: now,
  };
  const unit = existing[0];
  if (unit) {
    if (unit.status !== "CHECKED_OUT") await ctx.db.patch(unit._id, patch);
  } else {
    await ctx.db.insert("projectLineItemUnits", {
      id: createId(), organizationId: args.organizationId, lineItemId: args.lineItemId,
      ordinal: nextOrdinal(existing), quantity: 1, returnedQuantity: 0, createdAt: now, ...patch,
    });
  }
  return true;
}

/** Pack the accessory child lines of a bulk/untagged parent once the WHOLE parent
 *  line is packed. These children carry no `parentUnitAssetId` (there is no parent
 *  asset), so checkout/return cascade them unscoped — see checkoutAccessoryChildren. */
async function packParentlessAccessories(ctx: Ctx, organizationId: string, parentLineItemId: string): Promise<void> {
  const parent = await lineDocByCuid(ctx, parentLineItemId);
  if (!parent) return;
  const assigned = (await lineUnits(ctx, parentLineItemId)).reduce((n, u) => n + (u.quantity ?? 0), 0);
  if (assigned < (parent.quantity ?? 0)) return; // wait for the whole line
  const now = Date.now();
  for (const child of await accessoryChildrenOf(ctx, organizationId, parentLineItemId)) {
    const unitId = await ensureParentlessAccessoryUnit(ctx, organizationId, child);
    if (!unitId) continue;
    const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", unitId)).unique();
    if (u && u.status !== "CHECKED_OUT" && u.status !== "RETURNED") {
      await ctx.db.patch(u._id, { status: "CONFIRMED", prepStatus: "PACKED", updatedAt: now });
    }
    await syncLineItemRollup(ctx, child.id);
  }
}

/** The unit id backing a parent-less accessory child line, or null if it has no asset. */
async function ensureParentlessAccessoryUnit(
  ctx: Ctx,
  organizationId: string,
  child: { id: string; bulkAssetId?: string; assetId?: string; quantity?: number },
): Promise<string | null> {
  if (child.bulkAssetId) {
    return (await ensureBulkUnit(ctx, { organizationId, lineItemId: child.id, bulkAssetId: child.bulkAssetId, quantity: child.quantity ?? 1 })).id;
  }
  if (child.assetId) return (await ensureSerialisedUnit(ctx, { organizationId, lineItemId: child.id, assetId: child.assetId })).id;
  return null;
}

/**
 * #1296 widen-step legacy path: resolve a free-text container label (the OLD
 * `prepContainer` API arg) to a real `projectContainers` row, minting a new
 * CUSTOM one if this project's live version has no container with that exact
 * label yet — so an old client that still sends a label keeps working
 * end-to-end (create-on-first-use, same idempotent shape
 * `ensureContainerOnProjectCore` uses for an ASSET container). Retired along
 * with the legacy arg itself in phase 5 (build plan phase 1c note).
 */
export async function resolveOrCreateContainerByLabel(
  ctx: Ctx,
  args: { organizationId: string; projectId: string; label: string; now: number },
): Promise<string> {
  const versionId = await resolveLiveVersionIdForProject(ctx, args.projectId, args.organizationId);
  const containers = (await versionRows(ctx, "projectContainers", versionId)).filter((c) => c.organizationId === args.organizationId);
  const existing = containers.find((c) => c.label === args.label);
  if (existing) return existing.id;

  const containerId = createId();
  const lineItemId = createId();
  const lines = (await versionRows(ctx, "projectLineItems", versionId)).filter((l) => l.organizationId === args.organizationId);
  const lineSort = lines.reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
  await ctx.db.insert("projectLineItems", {
    id: lineItemId, organizationId: args.organizationId, projectId: args.projectId, versionId, lineageId: lineItemId,
    type: "EQUIPMENT", isCustomItem: true, description: args.label,
    quantity: 1, sortOrder: lineSort, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PACKED",
    prepContainer: args.label, containerId, isContainerLineItem: true, createdAt: args.now, updatedAt: args.now,
  });
  const containerSort = containers.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1) + 1;
  await ctx.db.insert("projectContainers", {
    id: containerId, organizationId: args.organizationId, projectId: args.projectId, versionId, lineageId: containerId,
    kind: "CUSTOM", label: args.label, lineItemId, sortOrder: containerSort, createdAt: args.now, updatedAt: args.now,
  });
  return containerId;
}

/** A container flip `syncContainerStatuses` applied — the caller (warehouseOps.ts,
 *  which owns `setAssetsStatus`) uses this to flip the underlying asset too when
 *  the container is an ASSET kind, keeping fulfillment.ts one-directional
 *  (warehouseOps.ts imports FROM here, never the reverse). */
export interface ContainerStatusFlip {
  containerId: string;
  lineItemId: string;
  assetId?: string;
  status: "CHECKED_OUT" | "RETURNED";
}

/** Loads a container's own line item + its live (non-CANCELLED) member units,
 *  org-checked at every hop — `null` when there's nothing to roll up. Split
 *  out of `syncContainerStatuses` to keep each helper's branching under the
 *  complexity ratchet (R-3.6). */
async function loadContainerFlipContext(ctx: Ctx, containerId: string, organizationId: string) {
  const container = await ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", containerId)).first();
  if (!container || container.organizationId !== organizationId) return null;
  const containerLI = await lineDocByCuid(ctx, container.lineItemId);
  if (!containerLI || containerLI.organizationId !== organizationId) return null;

  const members = (await ctx.db.query("projectLineItemUnits").withIndex("by_containerId", (q) => q.eq("containerId", containerId)).collect())
    .filter((u) => u.organizationId === organizationId && u.status !== "CANCELLED");
  if (members.length === 0) return null;
  return { containerLI, members };
}

/** `null` when the container's members don't (yet) unanimously agree on a
 *  status the container line item doesn't already have. */
function resolveContainerFlipStatus(
  containerLI: { status?: string },
  members: Array<{ status?: string }>,
): "CHECKED_OUT" | "RETURNED" | null {
  if (members.every((u) => u.status === "CHECKED_OUT") && containerLI.status !== "CHECKED_OUT") return "CHECKED_OUT";
  if (members.every((u) => u.status === "RETURNED") && containerLI.status !== "RETURNED") return "RETURNED";
  return null;
}

async function flipForContainer(
  ctx: Ctx,
  containerId: string,
  args: { organizationId: string; userId: string; now: number },
): Promise<ContainerStatusFlip | null> {
  const context = await loadContainerFlipContext(ctx, containerId, args.organizationId);
  if (!context) return null;
  const { containerLI, members } = context;
  const status = resolveContainerFlipStatus(containerLI, members);
  if (!status) return null;

  if (status === "CHECKED_OUT") {
    await ctx.db.patch(containerLI._id, {
      status: "CHECKED_OUT", checkedOutQuantity: containerLI.quantity ?? 1,
      checkedOutAt: args.now, checkedOutById: args.userId, updatedAt: args.now,
    });
  } else {
    await ctx.db.patch(containerLI._id, {
      status: "RETURNED", returnedQuantity: 1,
      returnedAt: args.now, returnedById: args.userId, returnCondition: "GOOD", updatedAt: args.now,
    });
  }
  return { containerId, lineItemId: containerLI.id, assetId: containerLI.assetId ?? undefined, status };
}

/**
 * #1296 — the container status roll-up, moved server-side and keyed by
 * `containerId` (replaces `syncContainersBatchCore`'s label bucketing).
 * "Contents" is every unit with `containerId === X` — nesting needs no
 * separate traversal: a container packed inside another is itself just a
 * line item, and if IT gets physically packed via `prepUnit`, that write
 * lands a unit with `containerId` pointing at the OUTER box, so the outer
 * box's own by_containerId read already sees it (§3.5). CANCELLED units
 * (tombstones) never block an "all deployed/returned" verdict.
 */
export async function syncContainerStatuses(
  ctx: Ctx,
  containerIds: Iterable<string>,
  args: { organizationId: string; userId: string; now: number },
): Promise<ContainerStatusFlip[]> {
  const flips: ContainerStatusFlip[] = [];
  const seen = new Set<string>();
  for (const containerId of containerIds) {
    if (seen.has(containerId)) continue;
    seen.add(containerId);
    const flip = await flipForContainer(ctx, containerId, args);
    if (flip) flips.push(flip);
  }
  return flips;
}
