import type { MutationCtx } from "../_generated/server";
import { resolveOrgDefaultTaxRate } from "./orgSettings";

/**
 * WS7 #946 — `recalcOrderTotals`, the missing writer for `SupplierOrder.subtotal/
 * taxAmount/total`. FEATUREDOCS/22 documented a `recalculateOrderTotals()` helper
 * that never actually existed (order "Spend" was structurally $0 — see
 * `suppliers/[id]/page.tsx`'s Summary card). Mirrors `convex/lib/subHireTotals.ts`'s
 * `recalcSubHireTotals` shape: sum item lineTotals → subtotal, apply the org's
 * default tax rate (NOT a hard-coded 10% — correcting the stale doc claim), round to
 * cents. Called from every `supplierOrderItems` write (add/update/remove/reorder
 * never changes money, so it doesn't call this).
 */

const round = (v: number): number => Math.round(v * 100) / 100;

export async function recalcOrderTotals(
  ctx: MutationCtx,
  orderId: string,
  orgId: string,
  now: number,
): Promise<void> {
  // by_cuid is a GLOBAL index — org-check the head so a foreign cuid can't read/patch
  // another tenant's order (defence-in-depth; callers also org-validate the head).
  const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", orderId)).first();
  if (!order || order.organizationId !== orgId) return;

  const items = await ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", orderId)).collect();
  const subtotal = round(items.reduce((sum, it) => sum + Number(it.lineTotal ?? 0), 0));

  const taxRatePct = (await resolveOrgDefaultTaxRate(ctx, orgId)) ?? 10;
  const taxAmount = round(subtotal * (taxRatePct / 100));
  const total = round(subtotal + taxAmount);

  await ctx.db.patch(order._id, { subtotal, taxAmount, total, updatedAt: now });
}
