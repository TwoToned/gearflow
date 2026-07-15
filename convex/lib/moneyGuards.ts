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
  duration?: number | null;
  lineTotal?: number | null;
}): void {
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
