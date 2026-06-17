/**
 * Shared transaction-level helpers for the line-item fulfillment model.
 *
 * The order line (`ProjectLineItem`) keeps its quantity and its denormalised
 * rollup fields; the truth for each physical unit lives in
 * `ProjectLineItemUnit`. Checkout / check-in / prep / kit flows all mutate
 * unit rows and then call `syncLineItemRollup` so the order line never
 * drifts from its units.
 *
 * See docs/designs/line-item-fulfillment-model.md.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  computeRollupCounters,
  deriveOrderLineStatus,
  deriveOrderLinePrepStatus,
  nextOrdinal,
} from "@/lib/line-item-units";
import { getModelMap } from "@/lib/models-read";

/** Columns the rollup needs off each unit row. */
const UNIT_ROLLUP_SELECT = {
  quantity: true,
  returnedQuantity: true,
  status: true,
  prepStatus: true,
  returnCondition: true,
  returnStatus: true,
} as const;

/**
 * Recompute a line item's rollup counters and derived display status from
 * its unit rows, and persist them. MUST be called inside the same
 * transaction as the unit write that triggered it.
 */
export async function syncLineItemRollup(
  tx: Prisma.TransactionClient,
  lineItemId: string,
): Promise<void> {
  const line = await tx.projectLineItem.findUnique({
    where: { id: lineItemId },
    select: { status: true, prepStatus: true },
  });
  if (!line) return;

  const units = await tx.projectLineItemUnit.findMany({
    where: { lineItemId },
    select: UNIT_ROLLUP_SELECT,
  });

  await tx.projectLineItem.update({
    where: { id: lineItemId },
    data: {
      ...computeRollupCounters(units),
      status: deriveOrderLineStatus(line.status, units),
      // The warehouse UI routes prep ↔ deploy on line.prepStatus.
      // Without this, a packed unit never moves the line off PULLED.
      prepStatus: deriveOrderLinePrepStatus(line.prepStatus, units),
    },
  });
}

/**
 * Find the existing unit for a (lineItem, asset) pair, or create one.
 * Serialised assets are one unit per asset (`quantity` 1); the
 * `[lineItemId, assetId]` unique index makes this idempotent under
 * concurrent scans.
 */
export async function ensureSerialisedUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId: string;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.projectLineItemUnit.findUnique({
    where: {
      lineItemId_assetId: {
        lineItemId: args.lineItemId,
        assetId: args.assetId,
      },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const siblings = await tx.projectLineItemUnit.findMany({
    where: { lineItemId: args.lineItemId },
    select: { ordinal: true },
  });
  const unit = await tx.projectLineItemUnit.create({
    data: {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      ordinal: nextOrdinal(siblings),
      assetId: args.assetId,
      quantity: 1,
      status: "CONFIRMED",
    },
    select: { id: true },
  });
  return { id: unit.id, created: true };
}

/**
 * Find the bulk unit row for a line, or create it. A bulk line has a single
 * unit row carrying the quantity (bulk assets are a stock pool, not
 * individually identifiable units).
 */
export async function ensureBulkUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    bulkAssetId: string;
    quantity: number;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.projectLineItemUnit.findFirst({
    where: { lineItemId: args.lineItemId, bulkAssetId: args.bulkAssetId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const unit = await tx.projectLineItemUnit.create({
    data: {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      ordinal: 1,
      bulkAssetId: args.bulkAssetId,
      quantity: args.quantity,
      status: "CONFIRMED",
    },
    select: { id: true },
  });
  return { id: unit.id, created: true };
}

/**
 * Ensure a per-parent-unit ACCESSORY unit on an accessory child line.
 *
 * Unlike ensureBulkUnit (one row per bulkAssetId for a whole line), accessory
 * units are keyed by the PARENT unit they travel with (`parentUnitAssetId`) —
 * the specific handheld a battery kit is packed under. So a qty-3 handheld line
 * with a battery accessory ends up with three battery units, one per handheld,
 * each independently prepped / deployed / returned / excluded. Dedups on
 * (lineItemId, parentUnitAssetId, accessory identity). Serialised accessory
 * assets also satisfy the (lineItemId, assetId) unique index.
 */
export async function ensureAccessoryUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    parentUnitAssetId: string;
    assetId?: string | null;
    bulkAssetId?: string | null;
    quantity: number;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.projectLineItemUnit.findFirst({
    where: {
      lineItemId: args.lineItemId,
      parentUnitAssetId: args.parentUnitAssetId,
      ...(args.assetId
        ? { assetId: args.assetId }
        : { bulkAssetId: args.bulkAssetId ?? undefined }),
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const siblings = await tx.projectLineItemUnit.findMany({
    where: { lineItemId: args.lineItemId },
    select: { ordinal: true },
  });
  const unit = await tx.projectLineItemUnit.create({
    data: {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      ordinal: nextOrdinal(siblings),
      assetId: args.assetId ?? null,
      bulkAssetId: args.assetId ? null : args.bulkAssetId ?? null,
      parentUnitAssetId: args.parentUnitAssetId,
      quantity: args.quantity,
      status: "CONFIRMED",
    },
    select: { id: true },
  });
  return { id: unit.id, created: true };
}

/**
 * Map a return condition to the canonical asset status to set on
 * checkin. Centralised so checkInItems, completeCheckAndStore, and
 * any future caller stay in sync.
 */
export function assetStatusFromReturnCondition(
  cond: "GOOD" | "DAMAGED" | "MISSING",
): "AVAILABLE" | "IN_MAINTENANCE" | "LOST" {
  if (cond === "DAMAGED") return "IN_MAINTENANCE";
  if (cond === "MISSING") return "LOST";
  return "AVAILABLE";
}

/**
 * Return one or many units on a line. THE single source of truth for
 * what "returning" means physically: flip the matching unit row(s) to
 * RETURNED, restore the asset(s), update location.
 *
 * Three modes:
 *   - `assetId` given → return exactly that asset's unit (scan flow).
 *   - `bulkAssetId` given → accumulate quantity onto the bulk unit row.
 *   - Neither → return still-out units on the line. When `quantity` is
 *     given (the warehouse UI when the user ticks N of M identical
 *     units) flip exactly that many, lowest ordinal first; without a
 *     quantity flip every still-out unit ("return whole line"). Falls
 *     back to flipping the order line directly if no units exist (kit
 *     children + legacy lines).
 *
 * Caller is responsible for the `requirePermission` check and the
 * surrounding $transaction. This function MUST run inside one. Caller
 * also handles syncLineItemRollup at the end (so multiple returns on
 * the same line in one outer call only re-roll once).
 *
 * Returns the count of unit rows that were actually flipped (useful
 * for scan-log notes; the caller can decide whether to write a log).
 */
export async function returnLineUnits(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    projectId: string;
    lineItemId: string;
    /** Specific asset being returned via a scan. */
    assetId?: string | null;
    /** Bulk asset for legacy bulk lines (line.bulkAssetId). */
    bulkAssetId?: string | null;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string | null;
    /** User performing the return — stamped on unit + asset scan log. */
    userId: string;
    /** Where the asset goes back to. */
    defaultLocationId: string | null;
  },
): Promise<{ unitsFlipped: number; assetsTouched: string[] }> {
  const assetStatus = assetStatusFromReturnCondition(args.returnCondition);
  const lineItem = await tx.projectLineItem.findFirstOrThrow({
    where: {
      id: args.lineItemId,
      projectId: args.projectId,
      organizationId: args.organizationId,
    },
  });

  // ── 1. Specific asset (scan) ────────────────────────────────────
  const targetAssetId = args.assetId || lineItem.assetId || null;
  if (targetAssetId) {
    const unit = await tx.projectLineItemUnit.findUnique({
      where: {
        lineItemId_assetId: {
          lineItemId: lineItem.id,
          assetId: targetAssetId,
        },
      },
      select: { id: true, status: true },
    });
    if (!unit) {
      // Kit child / legacy line — no unit; flip the line + asset directly.
      await tx.projectLineItem.update({
        where: { id: lineItem.id },
        data: {
          status: "RETURNED",
          returnedQuantity: lineItem.quantity,
          returnedAt: new Date(),
          returnedBy: { connect: { id: args.userId } },
          returnCondition: args.returnCondition,
          returnNotes: args.notes || null,
        },
      });
      await tx.asset.update({
        where: { id: targetAssetId },
        data: { status: assetStatus, locationId: args.defaultLocationId },
      });
      return { unitsFlipped: 0, assetsTouched: [targetAssetId] };
    }
    // Guarded transition.
    const flipped = await tx.projectLineItemUnit.updateMany({
      where: { id: unit.id, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || null,
      },
    });
    if (flipped.count > 0) {
      await tx.asset.update({
        where: { id: targetAssetId },
        data: { status: assetStatus, locationId: args.defaultLocationId },
      });
    }
    return { unitsFlipped: flipped.count, assetsTouched: [targetAssetId] };
  }

  // ── 2. Bulk line return ────────────────────────────────────────
  const targetBulkId = args.bulkAssetId || lineItem.bulkAssetId || null;
  if (targetBulkId) {
    const returnQty = args.quantity ?? 1;
    // A bulk accessory child may have multiple unit rows (one per parent
    // unit, each qty=1). Distribute the return across all still-CHECKED_OUT
    // unit rows in ordinal order to handle both single-aggregate and
    // per-parent-unit layouts correctly.
    const units = await tx.projectLineItemUnit.findMany({
      where: { lineItemId: lineItem.id, bulkAssetId: targetBulkId, status: "CHECKED_OUT" },
      orderBy: { ordinal: "asc" },
    });
    let remaining = returnQty;
    for (const unit of units) {
      if (remaining <= 0) break;
      const canReturn = Math.min(remaining, unit.quantity - unit.returnedQuantity);
      if (canReturn <= 0) continue;
      const newReturned = unit.returnedQuantity + canReturn;
      const fullyReturned = newReturned >= unit.quantity;
      await tx.projectLineItemUnit.update({
        where: { id: unit.id },
        data: {
          returnedQuantity: newReturned,
          status: fullyReturned ? "RETURNED" : "CHECKED_OUT",
          returnedAt: fullyReturned ? new Date() : unit.returnedAt,
          returnedById: fullyReturned ? args.userId : unit.returnedById,
          returnCondition: args.returnCondition,
          returnNotes: args.notes || unit.returnNotes,
        },
      });
      remaining -= canReturn;
    }
    return { unitsFlipped: units.length, assetsTouched: [] };
  }

  // ── 3. Partial or whole-line return ────────────────────────────
  // No specific asset and no line-level bulk: flip still-out units on
  // this line. A caller that passes `quantity` (the warehouse UI when
  // the user ticks N of M identical units) flips exactly that many,
  // lowest ordinal first; without a quantity every still-out unit is
  // flipped ("return whole line"). If there are no units the line is a
  // kit child / generic — flip the line itself.
  const outUnits = await tx.projectLineItemUnit.findMany({
    where: { lineItemId: lineItem.id, status: "CHECKED_OUT" },
    orderBy: { ordinal: "asc" },
  });
  if (outUnits.length === 0) {
    await tx.projectLineItem.update({
      where: { id: lineItem.id },
      data: {
        status: "RETURNED",
        returnedQuantity: lineItem.checkedOutQuantity || lineItem.quantity,
        returnedAt: new Date(),
        returnedBy: { connect: { id: args.userId } },
        returnCondition: args.returnCondition,
        returnNotes: args.notes || null,
      },
    });
    return { unitsFlipped: 0, assetsTouched: [] };
  }
  const unitsToFlip =
    args.quantity != null
      ? outUnits.slice(0, Math.max(0, Math.min(args.quantity, outUnits.length)))
      : outUnits;
  const assetsTouched: string[] = [];
  for (const u of unitsToFlip) {
    await tx.projectLineItemUnit.update({
      where: { id: u.id },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || null,
        ...(u.bulkAssetId ? { returnedQuantity: u.quantity } : {}),
      },
    });
    if (u.assetId) {
      await tx.asset.update({
        where: { id: u.assetId },
        data: { status: assetStatus, locationId: args.defaultLocationId },
      });
      assetsTouched.push(u.assetId);
    }
  }
  return { unitsFlipped: unitsToFlip.length, assetsTouched };
}

/**
 * Return a parent line's accessory children alongside the parent. Mirrors
 * checkoutAccessoryChildren on the return side: accessories are inseparable from
 * their parent, so any code path that returns the parent must cascade here.
 *
 * Scope: each accessory unit carries `parentUnitAssetId` — the handheld it was
 * packed under. When `returnedAssetId` is given (one parent unit scanned back),
 * only that handheld's accessory units flip to RETURNED; siblings stay out. A
 * whole-line return (no `returnedAssetId`) flips every still-out accessory unit.
 * Serialised accessory assets are released to inventory; bulk accessory units
 * mark their full quantity returned.
 *
 * Without this scoping, returning Light A would also return Light B's
 * still-deployed cable and mis-route a DAMAGED accessory to maintenance.
 *
 * Used by the warehouse return flow (checkInItems) and the check-and-store
 * return-check flow (completeCheckAndStore).
 */
export async function checkinAccessoryChildren(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    projectId: string;
    parentLineItemId: string;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    userId: string;
    defaultLocationId: string | null;
    /** The specific parent unit being returned. Null = whole-line return. */
    returnedAssetId?: string | null;
  },
) {
  const { organizationId, parentLineItemId, returnCondition, userId, defaultLocationId } = args;
  const returnedAssetId = args.returnedAssetId ?? null;
  const assetStatus = assetStatusFromReturnCondition(returnCondition);

  const children = await tx.projectLineItem.findMany({
    where: { parentLineItemId, organizationId, childKind: "ACCESSORY" },
    select: { id: true },
  });
  if (children.length === 0) return { assetsTouched: [] as string[] };
  const childIds = children.map((c) => c.id);

  // The accessory units to return: those tied to the returned parent unit
  // (parentUnitAssetId), or every still-out accessory unit on a whole-line return.
  const units = await tx.projectLineItemUnit.findMany({
    where: {
      lineItemId: { in: childIds },
      organizationId,
      status: "CHECKED_OUT",
      ...(returnedAssetId ? { parentUnitAssetId: returnedAssetId } : {}),
    },
    select: { id: true, assetId: true, bulkAssetId: true, quantity: true },
  });

  // Collect every serialised accessory asset whose status flips, so the caller
  // can mirror them to Convex (asset is dual-written) after the transaction.
  const assetsTouched: string[] = [];
  for (const u of units) {
    await tx.projectLineItemUnit.updateMany({
      where: { id: u.id, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnedById: userId,
        returnCondition,
        ...(u.bulkAssetId ? { returnedQuantity: u.quantity } : {}),
      },
    });
    if (u.assetId) {
      await tx.asset.update({
        where: { id: u.assetId },
        data: { status: assetStatus, locationId: defaultLocationId },
      });
      assetsTouched.push(u.assetId);
    }
  }
  for (const id of childIds) await syncLineItemRollup(tx, id);
  return { assetsTouched };
}

/** A parent asset's per-unit accessory profile: the specific serialised child
 *  assets it carries, and the bulk accessories it ships with (asset-level
 *  AssetBulkChild unioned with model-level ModelBulkAccessory; asset wins by
 *  bulkAssetId). Shared by expansion AND the per-unit return scoping. */
type AccessoryProfile = {
  serialised: Array<{ assetId: string; modelId: string | null; modelName: string | null }>;
  bulks: Array<{ bulkAssetId: string; quantity: number; modelId: string | null; modelName: string | null }>;
};

export async function resolveAssetAccessories(
  tx: Prisma.TransactionClient,
  organizationId: string,
  assetId: string,
  modelMap?: Map<string, { name: string }>,
): Promise<AccessoryProfile> {
  // org-scoped read (defense-in-depth — assetId can originate from a scan value).
  const asset = await tx.asset.findFirst({
    where: { id: assetId, organizationId },
    select: {
      modelId: true,
      childAssets: { select: { id: true, modelId: true } },
      childBulkItems: {
        select: { bulkAssetId: true, quantity: true, bulkAsset: { select: { modelId: true } } },
      },
    },
  });
  if (!asset) return { serialised: [], bulks: [] };

  const assetBulkIds = new Set(asset.childBulkItems.map((b) => b.bulkAssetId));
  const modelBulks = await tx.modelBulkAccessory.findMany({
    where: { modelId: asset.modelId, organizationId },
    select: { bulkAssetId: true, quantity: true, bulkAsset: { select: { modelId: true } } },
    orderBy: { sortOrder: "asc" },
  });

  // Resolve model names from Convex (pre-fetched map preferred; fallback to per-org fetch).
  const nameMap = modelMap ?? await getModelMap(organizationId);

  const bulks = [
    ...asset.childBulkItems.map((b) => ({ bulkAssetId: b.bulkAssetId, quantity: b.quantity, modelId: b.bulkAsset.modelId, modelName: nameMap.get(b.bulkAsset.modelId)?.name ?? null })),
    ...modelBulks
      .filter((m) => !assetBulkIds.has(m.bulkAssetId))
      .map((m) => ({ bulkAssetId: m.bulkAssetId, quantity: m.quantity, modelId: m.bulkAsset.modelId, modelName: nameMap.get(m.bulkAsset.modelId)?.name ?? null })),
  ];
  const serialised = asset.childAssets.map((c) => ({ assetId: c.id, modelId: c.modelId, modelName: nameMap.get(c.modelId)?.name ?? null }));
  return { serialised, bulks };
}

/** True for a unique-constraint violation, whether Prisma maps it (P2002) or
 *  surfaces the raw Postgres error (23505) — our accessory unique indexes are
 *  partial/raw and not declared in schema.prisma, so both shapes can appear. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2002" || code === "23505") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /unique constraint|duplicate key/i.test(msg);
}

/**
 * Run a `create` inside a SAVEPOINT and swallow a unique-constraint violation,
 * returning `null` when the row already existed (a concurrent scan won the race).
 *
 * Why the SAVEPOINT: a 23505 inside a Prisma interactive transaction aborts the
 * WHOLE transaction (Postgres `25P02`), so a plain try/catch can't recover —
 * every later statement on the same `tx` would fail. Wrapping the create in a
 * savepoint scopes the rollback to just this statement, leaving the transaction
 * healthy. The only unique constraints on `project_line_item` are the accessory
 * partial indexes, so a swallowed violation can only mean "this child exists".
 */
export async function createAccessoryChildIfAbsent(
  tx: Prisma.TransactionClient,
  data: Prisma.ProjectLineItemUncheckedCreateInput,
): Promise<string | null> {
  await tx.$executeRawUnsafe("SAVEPOINT accessory_child_create");
  try {
    const row = await tx.projectLineItem.create({ data, select: { id: true } });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT accessory_child_create");
    return row.id;
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT accessory_child_create");
    if (!isUniqueViolation(e)) throw e;
    return null;
  }
}

/**
 * Expand a specific serialised asset's permanent accessories onto a line as
 * accessory child lines (childKind: ACCESSORY).
 *
 * This is what makes accessories travel when the warehouse assigns a specific
 * unit to a model-level line at prep/checkout (not just when the office adds
 * the specific asset to the project). Returns the ids of any child lines created.
 *
 * Idempotent: serialised children dedup by their specific assetId; bulk children
 * are one row per bulkAssetId whose quantity is RECOMPUTED as the total demand
 * across every assigned parent unit (so a qty-N line where each parent ships 1
 * of a bulk accessory ends with a bulk child of quantity N, not 1). The partial
 * unique indexes (migration 20260605120000) backstop the read-before-create
 * against concurrent scans; we catch the violation and fall back to an update.
 *
 * Perf note: demand recompute resolves each distinct parent-unit asset once per
 * call (O(units) per expansion). Fine for typical rental line quantities.
 */
export async function expandAccessoriesForAsset(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId: string;
    /**
     * Which of THIS parent unit's accessories to pack, by accessory identity
     * (serialised accessory assetId, or bulk accessory bulkAssetId). Undefined =
     * include all (default). The warehouse prep picker passes the ticked set so
     * an operator can leave a battery/clip off a specific handheld — excluded
     * accessories get no unit for this parent unit, so they never prep/deploy.
     */
    includeAccessoryIds?: Set<string> | null;
  },
): Promise<string[]> {
  const { organizationId, lineItemId, assetId } = args;
  const includeAccessoryIds = args.includeAccessoryIds ?? null;
  const line = await tx.projectLineItem.findFirst({
    where: { id: lineItemId, organizationId },
    select: {
      projectId: true,
      categoryId: true,
      groupId: true,
      duration: true,
      pricingType: true,
      childKind: true,
    },
  });
  if (!line || line.childKind) return []; // missing, or itself a child — never nest

  // Serialize concurrent expansion of the SAME parent line. Without this, two
  // stations checking out different units of one multi-quantity line race: each
  // computes bulk demand before the other's unit is committed, so both write
  // demand=1 and the bulk accessory is undercounted. A row lock on the parent
  // line makes the second expansion wait, then see the committed sibling unit.
  // Single-resource lock (one row per line) → no deadlock across lines.
  await tx.$executeRaw`SELECT id FROM "project_line_item" WHERE id = ${lineItemId} FOR UPDATE`;

  const fullProfile = await resolveAssetAccessories(tx, organizationId, assetId);
  // Apply the picker's include set (if any): drop accessories the operator
  // unticked for THIS parent unit so no unit is materialised for them.
  const profile: AccessoryProfile = includeAccessoryIds
    ? {
        serialised: fullProfile.serialised.filter((s) => includeAccessoryIds.has(s.assetId)),
        bulks: fullProfile.bulks.filter((b) => includeAccessoryIds.has(b.bulkAssetId)),
      }
    : fullProfile;
  if (profile.serialised.length === 0 && profile.bulks.length === 0) return [];

  // Resolve every ACTIVE parent-unit asset (plus the one being expanded, in case
  // its unit row isn't created yet at this call site) once, so bulk demand can
  // be summed across units without re-querying per bulk accessory. RETURNED /
  // CANCELLED units no longer need their accessory, so they're excluded — else a
  // redeploy after a partial return would inflate demand above the active count.
  const parentUnits = await tx.projectLineItemUnit.findMany({
    where: { lineItemId, assetId: { not: null }, status: { notIn: ["RETURNED", "CANCELLED"] } },
    select: { assetId: true },
  });
  const parentAssetIds = new Set<string>([assetId, ...parentUnits.map((u) => u.assetId).filter((a): a is string => !!a)]);
  const profiles = new Map<string, AccessoryProfile>([[assetId, profile]]);
  for (const aid of parentAssetIds) {
    if (!profiles.has(aid)) profiles.set(aid, await resolveAssetAccessories(tx, organizationId, aid));
  }
  // Total demand per bulk accessory = sum of every parent unit's per-unit qty.
  const bulkDemand = new Map<string, number>();
  for (const p of profiles.values()) {
    for (const b of p.bulks) bulkDemand.set(b.bulkAssetId, (bulkDemand.get(b.bulkAssetId) ?? 0) + b.quantity);
  }

  const existing = await tx.projectLineItem.findMany({
    where: { parentLineItemId: lineItemId, childKind: "ACCESSORY", organizationId },
    select: { id: true, assetId: true, bulkAssetId: true },
  });
  const haveAsset = new Set(existing.map((e) => e.assetId).filter(Boolean));
  const existingByAsset = new Map(existing.filter((e) => e.assetId).map((e) => [e.assetId as string, e.id]));
  const existingBulk = new Map(existing.filter((e) => e.bulkAssetId).map((e) => [e.bulkAssetId as string, e.id]));

  const created: string[] = [];
  let sort = existing.length;

  const baseChild = {
    organizationId,
    projectId: line.projectId,
    type: "EQUIPMENT" as const,
    isKitChild: true,
    childKind: "ACCESSORY" as const,
    parentLineItemId: lineItemId,
    categoryId: line.categoryId,
    groupId: line.groupId,
    unitPrice: null,
    pricingType: line.pricingType,
    duration: line.duration,
  };

  // Serialised: one child line per accessory asset, deduped (unique index
  // backstop). Each carries ONE per-parent-unit unit tying it to this handheld.
  for (const child of profile.serialised) {
    let childLineId = existingByAsset.get(child.assetId) ?? null;
    if (!childLineId && !haveAsset.has(child.assetId)) {
      childLineId = await createAccessoryChildIfAbsent(tx, {
        ...baseChild,
        modelId: child.modelId,
        assetId: child.assetId,
        quantity: 1,
        description: child.modelName,
        sortOrder: sort++,
      });
      if (childLineId) created.push(childLineId);
    }
    // Resolve the id if the line already existed (or another scan created it).
    if (!childLineId) {
      const row = await tx.projectLineItem.findFirst({
        where: { parentLineItemId: lineItemId, assetId: child.assetId, childKind: "ACCESSORY", organizationId },
        select: { id: true },
      });
      childLineId = row?.id ?? null;
    }
    if (childLineId) {
      await ensureAccessoryUnit(tx, {
        organizationId,
        lineItemId: childLineId,
        parentUnitAssetId: assetId,
        assetId: child.assetId,
        quantity: 1,
      });
    }
  }

  // Bulk: one child line per bulkAssetId, line quantity = total demand across
  // parent units. Each parent unit that ships this accessory gets its OWN unit
  // row (parentUnitAssetId) so it preps / deploys / returns independently — the
  // per-handheld battery kit. The line quantity stays the booked total; the
  // sum of per-parent units catches up as each parent is prepped/deployed.
  for (const bulk of profile.bulks) {
    const demand = bulkDemand.get(bulk.bulkAssetId) ?? bulk.quantity;
    const description = bulk.modelName ? `${demand}x ${bulk.modelName}` : null;
    let childLineId = existingBulk.get(bulk.bulkAssetId) ?? null;
    if (childLineId) {
      await tx.projectLineItem.update({ where: { id: childLineId }, data: { quantity: demand, description } });
    } else {
      childLineId = await createAccessoryChildIfAbsent(tx, {
        ...baseChild,
        modelId: bulk.modelId,
        bulkAssetId: bulk.bulkAssetId,
        quantity: demand,
        description,
        sortOrder: sort++,
      });
      if (childLineId) {
        created.push(childLineId);
      } else {
        // Lost the create race — sync the quantity onto the row the winner created.
        const row = await tx.projectLineItem.findFirst({
          where: { parentLineItemId: lineItemId, bulkAssetId: bulk.bulkAssetId, childKind: "ACCESSORY", organizationId },
          select: { id: true },
        });
        childLineId = row?.id ?? null;
        if (childLineId) await tx.projectLineItem.update({ where: { id: childLineId }, data: { quantity: demand, description } });
      }
      if (childLineId) existingBulk.set(bulk.bulkAssetId, childLineId);
    }
    if (childLineId) {
      await ensureAccessoryUnit(tx, {
        organizationId,
        lineItemId: childLineId,
        parentUnitAssetId: assetId,
        bulkAssetId: bulk.bulkAssetId,
        quantity: bulk.quantity,
      });
    }
  }
  return created;
}

/**
 * Mark a unit prepped/packed (the pick-and-pack step before checkout).
 * Serialised and bulk lines get a PACKED unit row; a generic line with no
 * asset assigned just carries prepStatus on the order line. Rolls the line
 * up and returns it (with model/asset/bulkAsset included).
 */
export async function prepUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId?: string | null;
    bulkAssetId?: string | null;
    quantity?: number;
    prepContainer?: string | null;
    /** Accessories to pack with this unit (by serialised assetId / bulk
     *  bulkAssetId). Undefined = all. Unticked ones are left off this unit. */
    includeAccessoryIds?: Set<string> | null;
  },
) {
  if (args.assetId) {
    const { id } = await ensureSerialisedUnit(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      assetId: args.assetId,
    });
    await tx.projectLineItemUnit.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.prepContainer !== undefined
          ? { prepContainer: args.prepContainer }
          : {}),
      },
    });
    // Accessories of this specific asset join the line so they show on the
    // pull sheet and get packed/deployed with it. Each accessory gets a unit
    // tied to THIS parent unit (parentUnitAssetId), which we then mark PACKED —
    // so prepping handheld 2 packs handheld 2's battery, not just the first.
    await expandAccessoriesForAsset(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      assetId: args.assetId,
      includeAccessoryIds: args.includeAccessoryIds ?? null,
    });
    await tx.projectLineItemUnit.updateMany({
      where: {
        organizationId: args.organizationId,
        parentUnitAssetId: args.assetId,
        lineItem: { parentLineItemId: args.lineItemId, childKind: "ACCESSORY" },
        status: { not: "CHECKED_OUT" },
      },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.prepContainer !== undefined ? { prepContainer: args.prepContainer } : {}),
      },
    });
  } else if (args.bulkAssetId) {
    const { id } = await ensureBulkUnit(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      bulkAssetId: args.bulkAssetId,
      quantity: args.quantity ?? 1,
    });
    await tx.projectLineItemUnit.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
        ...(args.prepContainer !== undefined
          ? { prepContainer: args.prepContainer }
          : {}),
      },
    });
  } else {
    // Generic line, no serial scanned — mark prep state on the line itself.
    await tx.projectLineItem.update({
      where: { id: args.lineItemId },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.prepContainer !== undefined
          ? { prepContainer: args.prepContainer }
          : {}),
      },
    });
  }

  await syncLineItemRollup(tx, args.lineItemId);
  return tx.projectLineItem.findUniqueOrThrow({
    where: { id: args.lineItemId },
    include: { asset: true, bulkAsset: true },
  });
}
