import { INVOICING_HEADLINE_LABEL, type InvoicingState } from "@/lib/project-invoicing-state";
import { quoteStatusLabel } from "@/lib/quote-status-label";
import { daysUntilValidUntil } from "@/lib/quote-validity";

/**
 * The words in the Finance tab's four position tiles (UX Phase 10, spec §8b):
 * Quote · Invoiced · Paid · Margin ex GST. Pure: every figure is DERIVED from
 * what the strips already read (the live quote, `deriveInvoicingState`, the
 * project total) — nothing here is stored, and nothing is a second copy of a
 * rule. The Margin tile exists only when the server sent a margin (`null` or
 * `undefined` = absent, never `$0`).
 */

export interface PositionTile {
  key: "quote" | "invoiced" | "paid" | "margin";
  label: string;
  headline: string;
  detail: string | null;
  /** Problems read in error red (an overdue invoice). */
  tone?: "error";
}

interface LiveQuote {
  version: number;
  status: string;
  validUntil: number | null;
}

function plural(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many;
}

function quoteTile(live: LiveQuote | null, now: number): PositionTile {
  if (!live) return { key: "quote", label: "Quote", headline: "No quote yet", detail: "Sending creates the first version" };
  const headline = `v${live.version} · ${quoteStatusLabel(live.status)}`;
  if (live.status === "SENT" && live.validUntil != null) {
    const left = daysUntilValidUntil(live.validUntil, now);
    return { key: "quote", label: "Quote", headline, detail: left != null && left >= 0 ?`valid ${left} ${plural(left, "day")} more` : null };
  }
  if (live.status === "DRAFT") return { key: "quote", label: "Quote", headline, detail: "not sent" };
  return { key: "quote", label: "Quote", headline, detail: null };
}

function invoicedTile(inv: InvoicingState, total: number | null, money: (n: number) => string): PositionTile {
  const detail =
    inv.notYetInvoiced != null && inv.notYetInvoiced > 0.005
      ? `${money(inv.invoicedTotal)} of ${total != null ? money(total) : "—"} · ${money(inv.notYetInvoiced)} not yet raised`
      : `${money(inv.invoicedTotal)} invoiced`;
  return { key: "invoiced", label: "Invoiced", headline: INVOICING_HEADLINE_LABEL[inv.headline], detail };
}

function paidTile(inv: InvoicingState, money: (n: number) => string): PositionTile {
  const base = { key: "paid" as const, label: "Paid", headline: `${money(inv.paidTotal)} of ${money(inv.invoicedTotal)}` };
  if (inv.issuedInvoices.length === 0) return { ...base, headline: money(0), detail: "nothing issued yet" };
  if (inv.overdueInvoices.length > 0) {
    const n = inv.overdueInvoices.length;
    return { ...base, detail: `${n} ${plural(n, "invoice")} overdue · ${money(inv.outstanding)} outstanding`, tone: "error" };
  }
  return { ...base, detail: inv.outstanding > 0.005 ? `${money(inv.outstanding)} outstanding` : "nothing owing" };
}

export function financePositionTiles(input: {
  liveQuote: LiveQuote | null;
  invoicing: InvoicingState;
  total: number | null;
  margin: number | null | undefined;
  /** Revenue ex GST (total less tax): the base the margin percentage is of. */
  revenueExGst: number | null;
  now: number;
  money: (n: number) => string;
}): PositionTile[] {
  const { liveQuote, invoicing, total, margin, revenueExGst, now, money } = input;
  const tiles = [quoteTile(liveQuote, now), invoicedTile(invoicing, total, money), paidTile(invoicing, money)];
  if (margin != null && revenueExGst != null && revenueExGst > 0) {
    const pct = Math.round((margin / revenueExGst) * 100);
    tiles.push({ key: "margin", label: "Margin ex GST", headline: money(margin), detail: `${pct}% of ${money(revenueExGst)}` });
  }
  return tiles;
}
