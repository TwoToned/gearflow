import { ConvexError } from "convex/values";

/**
 * Money-domain input guards for the PUBLIC browser-callable line-item / project write
 * mutations. Convex `v.number()` is an IEEE-754 float64 and accepts `NaN`, `Infinity`,
 * and negatives — none of which the server-side Zod schemas (src/lib/validations/*) ever
 * let through. A browser-direct caller bypasses that Zod, so without these guards a
 * `quantity: NaN` / `lineTotal: Infinity` is written verbatim and then summed by
 * `convex/lib/recalc.ts` (`num(v) = Number(v)`) straight into `project.total`/`margin`,
 * silently poisoning the project's money to `NaN`/`Infinity`. Bounds mirror
 * `src/lib/validations/line-item.ts` exactly, so the legit service-token path (already
 * Zod-validated) is unaffected — these only reject inputs Zod would have rejected too.
 */

/** Reject a non-finite number (NaN/Infinity) — the recalc poisoners. `null`/`undefined` skip. */
export function assertFinite(value: number | null | undefined, field: string): void {
  if (value == null) return;
  if (!Number.isFinite(value)) {
    throw new ConvexError({ code: "INVALID_NUMBER", message: `${field} must be a finite number.` });
  }
}

/**
 * #1012 — reject a `discountMode` that isn't one of the two literals. Mutations
 * whose arg validator is `enums.DiscountMode` get this for free; this exists for
 * the untyped surfaces (`patchNative`'s `set: v.any()`, and `patchManyNative`'s
 * `mode: v.string()` legacy shape), where a browser-direct caller could otherwise
 * write an arbitrary string into the column and break the PDF's mode switch.
 */
export function assertDiscountMode(mode: unknown): void {
  if (mode == null) return;
  if (mode !== "$" && mode !== "%") {
    throw new ConvexError({ code: "INVALID_DISCOUNT_MODE", message: 'Discount mode must be "$" or "%".' });
  }
}

/**
 * Validate the numeric line-item fields to the same bounds `lineItemSchema` /
 * `customLineItemSchema` enforce, EXCEPT the two derived values that can legitimately
 * exceed their input caps and so are only checked finite + non-negative:
 *  - `lineTotal` (unitPrice × qty × duration − discount) — magnitude bounded by its
 *    components; can legitimately be large.
 *  - `quantity` UPPER bound is NOT enforced here: the addLineItem MERGE path patches
 *    `existing.quantity + parsed.quantity`, a sum of two Zod-capped values that can
 *    exceed 99999. Enforcing the cap would regress that legit service-token merge. We
 *    still require a finite positive integer (the anti-poisoning invariant); the 99999
 *    input cap stays enforced by Zod on the create path.
 */
export function assertLineMoneyFields(f: {
  quantity?: number | null;
  unitPrice?: number | null;
  discount?: number | null;
  discountMode?: unknown;
  duration?: number | null;
  lineTotal?: number | null;
}): void {
  assertDiscountMode(f.discountMode);
  if (f.quantity != null) {
    // No upper cap — the merge path sums two Zod-capped quantities (see doc above).
    if (!Number.isFinite(f.quantity) || !Number.isInteger(f.quantity) || f.quantity < 1) {
      throw new ConvexError({ code: "INVALID_QUANTITY", message: "Quantity must be a positive whole number." });
    }
  }
  if (f.unitPrice != null) {
    if (!Number.isFinite(f.unitPrice) || f.unitPrice < 0 || f.unitPrice > 999999.99) {
      throw new ConvexError({ code: "INVALID_PRICE", message: "Unit price must be between 0 and 999999.99." });
    }
  }
  if (f.discount != null) {
    if (!Number.isFinite(f.discount) || f.discount < 0 || f.discount > 999999.99) {
      throw new ConvexError({ code: "INVALID_DISCOUNT", message: "Discount must be between 0 and 999999.99." });
    }
  }
  if (f.duration != null) {
    if (!Number.isFinite(f.duration) || !Number.isInteger(f.duration) || f.duration < 1 || f.duration > 3650) {
      throw new ConvexError({ code: "INVALID_DURATION", message: "Duration must be a whole number between 1 and 3650." });
    }
  }
  if (f.lineTotal != null) {
    if (!Number.isFinite(f.lineTotal) || f.lineTotal < 0) {
      throw new ConvexError({ code: "INVALID_LINE_TOTAL", message: "Line total must be a non-negative finite number." });
    }
  }
}

/**
 * Validate the project-level money-adjacent fields to the same bounds
 * `src/lib/validations/project.ts` `projectSchema` enforces (taxRate/discountPercent:
 * 0-100). These are recalc INPUTS (unlike PROJECT_MONEY_ANCHORS in
 * convex/projectWrites.ts, which are recalc OUTPUTS and stripped entirely), so
 * they stay settable but must be bounded — a browser-direct caller bypasses
 * the Zod schema, and an unbounded `taxRate: -1e9` or `discountPercent: NaN`
 * would poison `recalcProjectTotals`'s output the same way an unbounded
 * line-item field would.
 *
 * WS1 (#940): `depositPercent` moved to the CLIENT payment profile (no longer
 * a project field at all); `depositPaid`/`invoicedTotal` moved from "recalc
 * input, hand-typed" to "recalc OUTPUT, derived from invoices" — both are now
 * PROJECT_MONEY_ANCHORS (projectWrites.ts), stripped like equipmentRevenue
 * rather than bound-checked here.
 */
export function assertProjectMoneyFields(f: {
  taxRate?: number | null;
  discountPercent?: number | null;
  billingWeeksOverride?: number | null;
  billingDaysOverride?: number | null;
}): void {
  if (f.taxRate != null) {
    if (!Number.isFinite(f.taxRate) || f.taxRate < 0 || f.taxRate > 100) {
      throw new ConvexError({ code: "INVALID_TAX_RATE", message: "Tax rate must be between 0 and 100." });
    }
  }
  if (f.discountPercent != null) {
    if (!Number.isFinite(f.discountPercent) || f.discountPercent < 0 || f.discountPercent > 100) {
      throw new ConvexError({ code: "INVALID_DISCOUNT_PERCENT", message: "Discount percent must be between 0 and 100." });
    }
  }
  if (f.billingWeeksOverride != null) {
    // Not itself money, but feeds recalcProjectTotals' allocation pass (weekly vs
    // daily rate-scale choice) and the financial-header billing summary — unbounded/
    // NaN here would poison both. ~10 years of weeks as a generous upper bound.
    if (!Number.isFinite(f.billingWeeksOverride) || !Number.isInteger(f.billingWeeksOverride) || f.billingWeeksOverride < 0 || f.billingWeeksOverride > 522) {
      throw new ConvexError({ code: "INVALID_BILLING_WEEKS_OVERRIDE", message: "Billing weeks override must be a whole number between 0 and 522." });
    }
  }
  if (f.billingDaysOverride != null) {
    // Same rationale as billingWeeksOverride. Remainder days are always < 7.
    if (!Number.isFinite(f.billingDaysOverride) || !Number.isInteger(f.billingDaysOverride) || f.billingDaysOverride < 0 || f.billingDaysOverride > 6) {
      throw new ConvexError({ code: "INVALID_BILLING_DAYS_OVERRIDE", message: "Billing days override must be a whole number between 0 and 6." });
    }
  }
}
