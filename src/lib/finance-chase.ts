import { formatCurrency, formatDate } from "@/lib/formatters";
import { daysUntilValidUntil } from "@/lib/quote-validity";

/**
 * The text a Chase puts on the clipboard (D54, #1225 Q2). Chase is COPY-ONLY: Flow never emails a
 * client (decision 7, #934), so these are pure strings the operator pastes into their own mail or
 * message. Money lines are present only when the caller was given the figure: a hub row from a
 * role below the job-cost line carries none, and so the text carries none.
 */

const pluralDays = (n: number) => (n === 1 ? "" : "s");

function chaseValidUntilLine(validUntil: number, daysLeft: number | null): string {
  if (daysLeft != null && daysLeft < 0) {
    const overdue = Math.abs(daysLeft);
    return `Expired: ${formatDate(new Date(validUntil))} (${overdue} day${pluralDays(overdue)} ago)`;
  }
  const suffix = daysLeft != null ? ` (${daysLeft} day${pluralDays(daysLeft)} left)` : "";
  return `Valid until: ${formatDate(new Date(validUntil))}${suffix}`;
}

/** Same grammar as `SendQuoteDialog`'s `copySummary`, plus the sent date and days remaining. */
export function chaseSummary(
  projectNumber: string,
  quote: { version: number; sentAt?: number | null; publishedAt?: number | null; validUntil?: number | null },
  pricing: { subtotal: number | null; taxAmount: number | null; total: number | null },
  now: number,
): string {
  const sentAt = quote.sentAt ?? quote.publishedAt ?? null;
  const daysLeft = quote.validUntil != null ? daysUntilValidUntil(quote.validUntil, now) : null;
  const lines = [
    `Quote \u2014 ${projectNumber} v${quote.version}`,
    pricing.subtotal != null ? `Subtotal: ${formatCurrency(pricing.subtotal)}` : null,
    pricing.taxAmount != null ? `GST: ${formatCurrency(pricing.taxAmount)}` : null,
    pricing.total != null ? `Total: ${formatCurrency(pricing.total)}` : null,
    sentAt != null ? `Sent: ${formatDate(new Date(sentAt))}` : null,
    quote.validUntil != null ? chaseValidUntilLine(quote.validUntil, daysLeft) : null,
  ].filter(Boolean);
  return lines.join("\n");
}

/** An unpaid invoice's follow-up: number, job, what is still owed (money only when given), and the due line. */
export function invoiceChaseText(
  inv: { invoiceNumber: string | null; projectNumber: string; issuedAt: number | null; dueDate: number | null; overdueDays: number | null },
  owed: { total: number | null; outstanding: number | null },
): string {
  const dueLine =
    inv.overdueDays != null
      ? `Overdue: ${inv.overdueDays} day${pluralDays(inv.overdueDays)}${inv.dueDate != null ? ` (was due ${formatDate(new Date(inv.dueDate))})` : ""}`
      : inv.dueDate != null
        ? `Due: ${formatDate(new Date(inv.dueDate))}`
        : null;
  return [
    `Invoice \u2014 ${inv.invoiceNumber ?? "(draft)"} (${inv.projectNumber})`,
    owed.total != null ? `Total: ${formatCurrency(owed.total)}` : null,
    owed.outstanding != null && owed.outstanding > 0 ? `Still owed: ${formatCurrency(owed.outstanding)}` : null,
    inv.issuedAt != null ? `Issued: ${formatDate(new Date(inv.issuedAt))}` : null,
    dueLine,
  ]
    .filter(Boolean)
    .join("\n");
}
