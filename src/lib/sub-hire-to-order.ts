/**
 * WS7 #946 — pure prefill mapping for "Create purchase order from this sub-hire"
 * (the `SubHireManageView` action in `src/components/projects/sub-hire-order-dialog.tsx`).
 * Kept as standalone pure functions (no Convex/React) so the mapping is unit-testable
 * without a Convex harness — the create flow itself (order create → item adds →
 * link) is exercised via convex/*Writes.test.ts + a smoke test on the component.
 */

export interface SubHireForPrefill {
  orderNumber: string;
  supplierId: string;
  hireStart: string | Date | null;
  hireEnd: string | Date | null;
  projectId: string | null;
}

export interface SubHireItemForPrefill {
  description: string;
  quantity: number;
  unitCost: number;
}

export interface OrderHeaderPrefill {
  supplierId: string;
  orderNumber: string;
  type: "SUBHIRE";
  orderDate: string | Date | null;
  expectedDate: string | Date | null;
  projectId: string | null;
}

export interface OrderItemPrefill {
  description: string;
  quantity: number;
  unitPrice: number;
}

/** `PO-{subHire.orderNumber}` — the create dialog's default, editable order number. */
export function defaultOrderNumberFor(subHireOrderNumber: string): string {
  return `PO-${subHireOrderNumber}`;
}

/**
 * Header prefill: supplier carries over, type is fixed SUBHIRE (this order exists
 * because of a sub-hire), hireStart → orderDate, hireEnd → expectedDate, project
 * carries over (so the PO shows on the same project's supplier spend).
 */
export function buildOrderHeaderPrefill(subHire: SubHireForPrefill, orderNumber?: string): OrderHeaderPrefill {
  return {
    supplierId: subHire.supplierId,
    orderNumber: orderNumber ?? defaultOrderNumberFor(subHire.orderNumber),
    type: "SUBHIRE",
    orderDate: subHire.hireStart,
    expectedDate: subHire.hireEnd,
    projectId: subHire.projectId,
  };
}

/**
 * Item prefill: description/qty carry over as-is; `unitCost` (what WE pay the
 * supplier) maps to the order's `unitPrice` (what the PO records as owed) — the
 * order has no separate cost/charge split the way a sub-hire item does.
 */
export function mapSubHireItemsToOrderItems(items: SubHireItemForPrefill[]): OrderItemPrefill[] {
  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitCost,
  }));
}
