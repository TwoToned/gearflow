import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * BYTE-PARITY native port of the sub-hire money helpers (the money gate for the
 * last + heaviest Convex-native domain).
 *
 *  - recalcSubHireTotals — port of src/server/sub-hires.ts `recalculateSubHireTotals`.
 *  - upsertSupplierModelRate — port of src/server/sub-hires.ts `upsertSupplierModelRate`.
 *
 * The server math operates on the MAPPED sub-hire rows (src/lib/sub-hire-read.ts),
 * which apply defaults (quantity ?? 1, duration ?? 1, discount ?? 0, unitCharge ?? 0,
 * unitCost ?? 0, showOnQuote ?? true, cost/charge → null-when-absent, pricingMode ??
 * "ITEMIZED"). We apply the SAME defaults to the raw Convex docs before computing, so
 * the totals are byte-identical. `roundCurrency` == Math.round(x*100)/100 (both the
 * server helper and convex/lib/recalc round the same way).
 */

const round = (v: number): number => Math.round(v * 100) / 100;

type PricingType = "PER_DAY" | "PER_WEEK" | "FLAT" | "PER_HOUR" | "OPTIMIZED";

// ─── Mapped-row shapes (mirror src/lib/sub-hire-read.ts defaults) ──────────────

interface MappedItem {
  id: string;
  groupId: string | null;
  modelId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  unitCharge: number;
  pricingType: PricingType;
  duration: number;
  discount: number;
  showOnQuote: boolean;
  showOnDocs: boolean;
  sortOrder: number;
  targetCategoryId: string | null;
  targetGroupId: string | null;
  notes: string | null;
}

interface MappedGroup {
  id: string;
  title: string;
  sortOrder: number;
  quantity: number;
  cost: number | null;
  charge: number | null;
  discount: number;
  showOnQuote: boolean;
  showOnDocs: boolean;
  targetCategoryId: string | null;
  targetGroupId: string | null;
}

export function mapItem(d: Doc<"subHireItems">): MappedItem {
  return {
    id: d.id,
    groupId: d.groupId ?? null,
    modelId: d.modelId ?? null,
    description: d.description,
    quantity: d.quantity ?? 1,
    unitCost: d.unitCost ?? 0,
    unitCharge: d.unitCharge ?? 0,
    pricingType: (d.pricingType ?? "FLAT") as PricingType,
    duration: d.duration ?? 1,
    discount: d.discount ?? 0,
    showOnQuote: d.showOnQuote ?? true,
    showOnDocs: d.showOnDocs ?? false,
    sortOrder: d.sortOrder ?? 0,
    targetCategoryId: d.targetCategoryId ?? null,
    targetGroupId: d.targetGroupId ?? null,
    notes: d.notes ?? null,
  };
}

export function mapGroup(d: Doc<"subHireGroups">): MappedGroup {
  return {
    id: d.id,
    title: d.title,
    sortOrder: d.sortOrder ?? 0,
    quantity: d.quantity ?? 1,
    cost: d.cost ?? null,
    charge: d.charge ?? null,
    discount: d.discount ?? 0,
    showOnQuote: d.showOnQuote ?? true,
    showOnDocs: d.showOnDocs ?? false,
    targetCategoryId: d.targetCategoryId ?? null,
    targetGroupId: d.targetGroupId ?? null,
  };
}

/** Groups/items for a sub-hire, mapped + sorted sortOrder asc (mirrors the read helpers). */
export async function loadSubHireContents(
  ctx: MutationCtx,
  subHireId: string,
): Promise<{ groups: MappedGroup[]; items: MappedItem[] }> {
  const [rawGroups, rawItems] = await Promise.all([
    ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId)).collect(),
    ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId)).collect(),
  ]);
  const groups = rawGroups.map(mapGroup).sort((a, b) => a.sortOrder - b.sortOrder);
  const items = rawItems.map(mapItem).sort((a, b) => a.sortOrder - b.sortOrder);
  return { groups, items };
}

/**
 * Recompute + persist a sub-hire's totalCost / totalCharge (BYTE-PARITY port of
 * recalculateSubHireTotals). No-op if the sub-hire is gone. Reads the head + its
 * groups + items and patches the totals onto the fetched row.
 */
export async function recalcSubHireTotals(
  ctx: MutationCtx,
  subHireId: string,
  orgId: string,
  now: number,
): Promise<void> {
  // by_cuid is a GLOBAL index — org-check the head so a foreign cuid can't read/patch
  // another tenant's sub-hire (defence-in-depth; callers also org-validate the head).
  const subHire = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", subHireId)).first();
  if (!subHire || subHire.organizationId !== orgId) return;

  const { groups, items } = await loadSubHireContents(ctx, subHireId);

  const pricingMode = subHire.pricingMode ?? "ITEMIZED";
  const orderTotalCost = subHire.orderTotalCost ?? null;
  const orderTotalCharge = subHire.orderTotalCharge ?? null;

  let totalCost = 0;
  let totalCharge = 0;

  if (pricingMode === "ORDER_TOTAL") {
    // In ORDER_TOTAL mode, cost comes from the flat order amount.
    totalCost = Number(orderTotalCost ?? 0);
    // Charge: use group charges where set, then item charges for the rest.
    if (orderTotalCharge != null) {
      totalCharge = Number(orderTotalCharge);
    } else {
      const groupChargeHandled = new Set<string>();
      for (const group of groups) {
        if (group.charge != null) {
          totalCharge += Number(group.charge) * group.quantity * (1 - Number(group.discount ?? 0) / 100);
          groupChargeHandled.add(group.id);
        }
      }
      for (const item of items) {
        if (item.groupId && groupChargeHandled.has(item.groupId)) continue;
        const charge = Number(item.unitCharge);
        const disc = Number(item.discount);
        totalCharge += charge * item.quantity * item.duration * (1 - disc / 100);
      }
    }
  } else {
    // ITEMIZED mode — respect group-level cost/charge overrides.
    const groupCostHandled = new Set<string>();
    const groupChargeHandled = new Set<string>();

    for (const group of groups) {
      if (group.cost != null) {
        totalCost += Number(group.cost) * group.quantity;
        groupCostHandled.add(group.id);
      }
      if (group.charge != null) {
        totalCharge += Number(group.charge) * group.quantity * (1 - Number(group.discount ?? 0) / 100);
        groupChargeHandled.add(group.id);
      }
    }

    for (const item of items) {
      const qty = item.quantity;
      const dur = item.duration;

      // Cost: skip items in groups with flat cost.
      if (!(item.groupId && groupCostHandled.has(item.groupId))) {
        totalCost += Number(item.unitCost) * qty * dur;
      }

      // Charge: skip items in groups with flat charge.
      if (!(item.groupId && groupChargeHandled.has(item.groupId))) {
        const disc = Number(item.discount);
        totalCharge += Number(item.unitCharge) * qty * dur * (1 - disc / 100);
      }
    }
  }

  await ctx.db.patch(subHire._id, {
    totalCost: round(totalCost),
    totalCharge: round(totalCharge),
    updatedAt: now,
  });
}

/**
 * Supplier-rate memory RMW (BYTE-PARITY port of `upsertSupplierModelRate`). Found →
 * patch {lastUnitCost, pricingType, lastUsedAt, updatedAt}; else insert a fresh row.
 */
export async function upsertSupplierModelRate(
  ctx: MutationCtx,
  args: {
    orgId: string;
    supplierId: string;
    modelId: string;
    unitCost: number;
    pricingType: PricingType;
    now: number;
  },
): Promise<void> {
  const { orgId, supplierId, modelId, unitCost, pricingType, now } = args;
  const existing = await ctx.db
    .query("supplierModelRates")
    .withIndex("by_organizationId_supplierId_modelId", (q) =>
      q.eq("organizationId", orgId).eq("supplierId", supplierId).eq("modelId", modelId),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      lastUnitCost: unitCost,
      pricingType,
      lastUsedAt: now,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("supplierModelRates", {
      id: createId(),
      organizationId: orgId,
      supplierId,
      modelId,
      lastUnitCost: unitCost,
      pricingType,
      lastUsedAt: now,
      updatedAt: now,
    });
  }
}
