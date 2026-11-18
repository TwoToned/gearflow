import type { SubHireHeadInput, SubHireItemInput } from "@/hooks/use-sub-hire-writes";

/**
 * The shortfall sheet's write, through EXISTING sub-hire mutations only
 * (`create` a draft order if the supplier has none on this job, `addItem`, and
 * optionally trim the stock line by the units now covered externally). Returns
 * ONE `undo` closure that reverses exactly what this call did; the sheet's toast
 * hands that same closure to its Undo button (never a second derivation).
 */
export interface ShortfallWrites {
  create: (input: SubHireHeadInput) => Promise<{ id: string }>;
  addItem: (subHireId: string, input: SubHireItemInput) => Promise<{ id: string }>;
  removeItem: (itemId: string) => Promise<void>;
  remove: (subHireId: string) => Promise<void>;
}

export interface ShortfallApplyArgs {
  writes: ShortfallWrites;
  head: SubHireHeadInput;
  /** An existing DRAFT order for the chosen supplier on this job to append to. */
  draftOrderId?: string;
  item: SubHireItemInput;
  /** Trim the stock line: `to` units stay on it (the rest moved to the order). */
  reduce?: { from: number; to: number; setQuantity: (qty: number) => Promise<unknown> };
}

export interface ShortfallApplied {
  orderId: string;
  itemId: string;
  createdOrder: boolean;
  undo: () => Promise<void>;
}

export async function applyShortfall(a: ShortfallApplyArgs): Promise<ShortfallApplied> {
  const createdOrder = !a.draftOrderId;
  const orderId = a.draftOrderId ?? (await a.writes.create(a.head)).id;
  let itemId: string;
  try {
    itemId = (await a.writes.addItem(orderId, a.item)).id;
  } catch (e) {
    if (createdOrder) await a.writes.remove(orderId).catch(() => {});
    throw e;
  }
  const undo = async () => {
    if (a.reduce) await a.reduce.setQuantity(a.reduce.from);
    await a.writes.removeItem(itemId);
    if (createdOrder) await a.writes.remove(orderId);
  };
  if (a.reduce) {
    try {
      await a.reduce.setQuantity(a.reduce.to);
    } catch (e) {
      // Leave nothing half-done: the line still carries the units, so the order must not too.
      await a.writes.removeItem(itemId).catch(() => {});
      if (createdOrder) await a.writes.remove(orderId).catch(() => {});
      throw e;
    }
  }
  return { orderId, itemId, createdOrder, undo };
}
