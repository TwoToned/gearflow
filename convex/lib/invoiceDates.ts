import { computeValidUntil } from "./quoteDates";

/**
 * Invoice payment-terms default (#989) — byte-for-byte mirror of the constants in
 * `src/lib/invoice-terms.ts` (the Convex bundler can't resolve `@/`), same pattern
 * as `quoteDates.ts`/`quote-validity.ts`. Pinned by the cross-import equality
 * check in `convex/quoteDates.test.ts` (extended to cover this pair too).
 *
 * No separate date-math is needed here: a due date is "the end of the calendar
 * day N days after the invoice date, in the org's timezone" — exactly what
 * `computeValidUntil` already computes for quote validity (R-3.1: one function,
 * two callers, not two copies of the same day-boundary math).
 */

/** Days after the invoice date a payment is due, when the org hasn't set one. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;

/** Bounds on `OrgDocumentSettings.paymentTermsDays` and the issue dialog's due-date
 *  override. */
export const PAYMENT_TERMS_BOUNDS = { min: 0, max: 365 } as const;

/** Resolve the org's configured payment terms, clamped to the supported bounds. */
export function resolvePaymentTermsDays(configured: number | null | undefined): number {
  if (configured == null || !Number.isInteger(configured)) return DEFAULT_PAYMENT_TERMS_DAYS;
  if (configured < PAYMENT_TERMS_BOUNDS.min || configured > PAYMENT_TERMS_BOUNDS.max) {
    return DEFAULT_PAYMENT_TERMS_DAYS;
  }
  return configured;
}

/** Due date for an invoice: the end of the calendar day `paymentTermsDays` after
 *  `invoiceDateMs`, in the org's timezone. */
export function computeDueDate(invoiceDateMs: number, paymentTermsDays: number, timezone?: string): number {
  return computeValidUntil(invoiceDateMs, paymentTermsDays, timezone);
}
