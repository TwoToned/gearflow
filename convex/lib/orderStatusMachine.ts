/**
 * The supplier-order status machine (WS7 #946): DRAFT -> ORDERED -> PARTIAL -> RECEIVED, with CANCELLED reachable from
 * any active state; RECEIVED and CANCELLED are terminal (RECEIVED is a real-world stock-received event). ONE table,
 * read by the write (`supplierOrdersWrites.updateNative`), by the Undo of a status change (which may not step back out
 * of a terminal state), and by the order sheet's status select (so it offers only legal moves). Mirrors the
 * `VALID_TRANSITIONS` pattern in `subHiresWrites.ts`.
 */
const ORDER_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

/** Where an order in `current` may go (resubmitting the same status is always allowed, so it is included). */
export function orderStatusTargets(current: string): string[] {
  return [current, ...(ORDER_STATUS_TRANSITIONS[current] ?? [])];
}

/** Is `from -> to` a legal move (or no move)? */
export function isLegalOrderMove(from: string, to: string): boolean {
  return from === to || (ORDER_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses in which a sub-hire order is on hire (stock received, not yet returned). */
export const RECEIVED_STATUSES: readonly string[] = ["PARTIAL", "RECEIVED"];
