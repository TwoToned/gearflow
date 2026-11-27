import { INVOICE_PILL_LABEL, invoicePillState, type InvoicePillState } from "../../convex/lib/invoiceOverdue";
import type { ColorIntent } from "@/lib/status-colors";
import type { StatusValue } from "@/lib/primitives/types";

/**
 * An invoice's ONE status word as a `StatusValue` (dot + word, D91). The state
 * and its precedence (D56: Overdue outranks Part paid) come from
 * `invoicePillState`; this only attaches the intent. Problems are `error`, "needs
 * you" is `warning`, done is `success`, in flight is `info`.
 */
const PILL_INTENT: Record<InvoicePillState, ColorIntent> = {
  VOID: "neutral",
  CREDIT: "neutral",
  DRAFT: "neutral",
  PAID: "success",
  OVERDUE: "error",
  PART_PAID: "warning",
  ISSUED: "info",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The row's date line: `issued 6 Nov · due 20 Nov`, `3 days overdue` once past
 * due and unsettled (D56), `paid 8 Nov` once settled. Empty for a draft. Dates
 * are formatted by the caller (`fmt`) so this stays pure and locale-free.
 */
export function invoiceDatesLine(
  inv: Parameters<typeof invoicePillState>[0] & { issuedAt?: number | null },
  now: number,
  lastPaidAt: number | null,
  fmt: (ms: number) => string,
): string {
  const state = invoicePillState(inv, now);
  if (state === "DRAFT") return "";
  if (state === "PAID" && lastPaidAt != null) return `paid ${fmt(lastPaidAt)}`;
  if (state === "OVERDUE" && inv.dueDate != null) {
    const days = Math.max(1, Math.floor((now - (inv.dueDate + DAY_MS)) / DAY_MS) + 1);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  const parts = [inv.issuedAt != null ? `issued ${fmt(inv.issuedAt)}` : null, inv.dueDate != null ? `due ${fmt(inv.dueDate)}` : null];
  return parts.filter(Boolean).join(" · ");
}

/** The status word for an already-derived pill state (the Finance hub gets the state from the server). */
export function invoicePillValue(state: InvoicePillState): StatusValue {
  return { label: INVOICE_PILL_LABEL[state], intent: PILL_INTENT[state], outline: state === "VOID" };
}

export function invoiceStatusWord(
  inv: Parameters<typeof invoicePillState>[0],
  now: number,
): StatusValue {
  return invoicePillValue(invoicePillState(inv, now));
}
