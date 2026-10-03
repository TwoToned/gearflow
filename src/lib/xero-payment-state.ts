import type { XeroInvoiceState } from "@/lib/xero-client";

/**
 * Map Xero's invoice states back onto the Flow invoices that were pushed
 * (follow-up automation phase 2, FEATUREDOCS/82). Pure — unit-tested. A Flow
 * invoice Xero didn't return (deleted there, or a stale id) is skipped rather
 * than guessed at; missing amounts read as 0.
 */
export function toXeroInvoiceStateUpdates(
  pending: { id: string; xeroInvoiceId: string }[],
  states: XeroInvoiceState[],
): { invoiceId: string; xeroStatus: string; amountPaid: number; amountCredited: number; amountDue: number }[] {
  const byXeroId = new Map(states.map((s) => [s.InvoiceID.toLowerCase(), s]));
  const out = [];
  for (const p of pending) {
    const s = byXeroId.get(p.xeroInvoiceId.toLowerCase());
    if (!s) continue;
    out.push({
      invoiceId: p.id,
      xeroStatus: s.Status,
      amountPaid: s.AmountPaid ?? 0,
      amountCredited: s.AmountCredited ?? 0,
      amountDue: s.AmountDue ?? 0,
    });
  }
  return out;
}
