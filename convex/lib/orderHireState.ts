/**
 * A supplier order's DERIVED hire state (UX Phase 13, D71). Pure: no ctx, no clock
 * (callers pass `today` as a day number). Nothing here is stored: the stored `status`
 * vocabulary (Draft / Ordered / Partial / Received / Cancelled) is untouched; only
 * `returnedDate` and `returnDueDate` are new.
 *
 * SUBHIRE: Cancelled / Draft as stored; `returnedDate` set = **Returned**; RECEIVED or
 * PARTIAL with no `returnedDate` = **On hire**; ORDERED = Ordered. Other order types keep
 * their stored words and never have a hire state.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export type OrderHireWord = "Draft" | "Ordered" | "On hire" | "Returned" | "Received" | "Partly received" | "Cancelled";
export type OrderHireIntent = "neutral" | "info" | "live" | "ok" | "warn";

export interface HireOrder {
  type?: string | null;
  status?: string | null;
  returnDueDate?: number | null;
  returnedDate?: number | null;
}

const dayOf = (ms: number) => Math.floor(ms / DAY_MS);

const STORED: Record<string, [OrderHireWord, OrderHireIntent]> = {
  DRAFT: ["Draft", "neutral"],
  ORDERED: ["Ordered", "info"],
  PARTIAL: ["Partly received", "warn"],
  RECEIVED: ["Received", "ok"],
  CANCELLED: ["Cancelled", "neutral"],
};

export function isOnHire(o: HireOrder): boolean {
  return o.type === "SUBHIRE" && o.returnedDate == null && (o.status === "RECEIVED" || o.status === "PARTIAL");
}

export function orderHireState(o: HireOrder): { word: OrderHireWord; intent: OrderHireIntent } {
  const status = o.status ?? "DRAFT";
  const [word, intent] = STORED[status] ?? STORED.DRAFT;
  if (o.type !== "SUBHIRE" || status === "CANCELLED" || status === "DRAFT") return { word, intent };
  if (o.returnedDate != null) return { word: "Returned", intent: "ok" };
  if (isOnHire(o)) return { word: "On hire", intent: "live" };
  return { word, intent };
}

/** Days past the due date for an order still on hire (0 when not late, not on hire, or no due date). */
export function returnLateDays(o: HireOrder, today: number): number {
  if (!isOnHire(o) || o.returnDueDate == null) return 0;
  return Math.max(0, today - dayOf(o.returnDueDate));
}
