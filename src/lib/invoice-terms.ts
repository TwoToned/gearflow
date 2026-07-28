/**
 * Invoice payment-terms default (#989, closing the "every invoice issued today
 * has no due date" bug from #985). Mirrors `quote-validity.ts`'s pattern: one
 * business constant, defined once, imported both client-side (this file) and
 * server-side (`convex/lib/invoiceDates.ts` re-exports the same value — no
 * date-math duplication, since `computeDueDate` there just calls
 * `computeValidUntil` from `quoteDates.ts`, which already does "end of the
 * calendar day N days later" in the org's timezone).
 */

/** Days after the invoice date a payment is due, when the org hasn't set one. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;

/** Bounds on `OrgDocumentSettings.paymentTermsDays` and the issue dialog's due-date
 *  override. Mirrored server-side via `assertNumRange` (R-8.6.2). */
export const PAYMENT_TERMS_BOUNDS = { min: 0, max: 365 } as const;

/** Resolve the org's configured payment terms, clamped to the supported bounds.
 *  A stored value outside them (hand-edited settings blob) falls back to the
 *  default rather than minting an absurd due date. */
export function resolvePaymentTermsDays(configured: number | null | undefined): number {
  if (configured == null || !Number.isInteger(configured)) return DEFAULT_PAYMENT_TERMS_DAYS;
  if (configured < PAYMENT_TERMS_BOUNDS.min || configured > PAYMENT_TERMS_BOUNDS.max) {
    return DEFAULT_PAYMENT_TERMS_DAYS;
  }
  return configured;
}
