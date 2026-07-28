/**
 * Discount entry mode ($ vs %) — the single source of truth for the literal
 * union, the two conversions between an entered discount and the flat dollar
 * amount every money path stores, and the display string documents render.
 *
 * ## Why a mode is persisted at all (#1012)
 *
 * `discount` is, and stays, a flat dollar amount everywhere: recalc, invoicing,
 * `lineTotal` derivation and the Xero push all read that one number. What was
 * missing was the *shape of the entry* — a line discounted "15%" and a line
 * discounted "$150" are indistinguishable once resolved, so a quote PDF could
 * only ever print `-$150.00` even when the operator (and the client they
 * negotiated with) think in percent. `discountMode` records which one the
 * operator typed.
 *
 * ## Why the percentage is DERIVED, not stored
 *
 * Only the mode is persisted — never the raw `15`. The percentage shown on a
 * document is always recomputed from the stored dollar amount against the
 * row's own gross (`discountPercentOf`). That is deliberate: the dollar amount
 * is frozen at save time (see `resolveDiscountAmount`), so if the unit price
 * later changes, a stored `15` would print "15%" next to a line whose numbers
 * say 7.5% — a client-facing document contradicting itself. Deriving keeps the
 * printed percentage and the printed totals in agreement by construction, and
 * it means there is no second copy of the same fact to keep in sync (R-3.1).
 *
 * Rows written before #1012 have no mode; absent is treated as `"$"`
 * everywhere, which is byte-identical to the old behaviour (no backfill).
 */

export const DISCOUNT_MODES = ["$", "%"] as const;

export type DiscountMode = (typeof DISCOUNT_MODES)[number];

/** Narrowing guard for the `v.any()` / unknown boundaries (patchNative's `set`). */
export function isDiscountMode(value: unknown): value is DiscountMode {
  return value === "$" || value === "%";
}

/** A stored/untrusted mode coerced to one of the two literals, defaulting to
 *  `"$"` — the reading every consumer applies to a pre-#1012 row (absent mode)
 *  and to anything unrecognised. */
export function toDiscountMode(value: unknown): DiscountMode {
  return isDiscountMode(value) ? value : "$";
}

/**
 * Resolves a raw discount input to the flat dollar amount the schema/mutation
 * expects — discount is always persisted as a flat $ amount (never a
 * percentage), so every caller needs this same conversion before submit.
 * `%` mode multiplies against `grossAmount` (the pre-discount line/bundle
 * total); `$` mode passes the value through unchanged. Returns `undefined`
 * for blank/zero/invalid input — "nothing to discount".
 */
export function resolveDiscountAmount(
  mode: DiscountMode,
  rawValue: number | string | null | undefined,
  grossAmount: number,
): number | undefined {
  // Blank/unset is distinct from an explicit 0 — a blank field means "no
  // discount" (or, for callers with an omit-to-preserve mutation like
  // updateGroupPriceNative, "don't touch the existing discount"), while a
  // deliberately typed 0 clears/zeroes a previously-set discount. Checking
  // the raw value BEFORE Number() coercion is what keeps that distinction —
  // `Number(0)` is falsy too, so a truthiness check alone would collapse them.
  if (rawValue === "" || rawValue == null) return undefined;
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  return mode === "%" ? Math.round(grossAmount * raw) / 100 : raw;
}

/**
 * The inverse of `resolveDiscountAmount`'s `%` branch: what percentage of
 * `grossAmount` the stored flat `discount` represents, rounded to 2dp.
 *
 * Returns `null` when there is nothing meaningful to express as a percentage —
 * no discount, or a zero/negative/non-finite gross (a $0 line discounted by a
 * dollar amount has no percentage; callers fall back to the `$` rendering).
 */
export function discountPercentOf(
  discount: number | null | undefined,
  grossAmount: number | null | undefined,
): number | null {
  if (discount == null || !Number.isFinite(discount) || discount <= 0) return null;
  if (grossAmount == null || !Number.isFinite(grossAmount) || grossAmount <= 0) return null;
  return Math.round((discount / grossAmount) * 10000) / 100;
}

/**
 * The pre-discount total a `%` discount is measured against, for a single line
 * item. Mirrors `computeLineTotal`/`calcLineTotalNative`'s gross term
 * (`unitPrice × quantity × duration`) — the same base the forms hand to
 * `resolveDiscountAmount`. A synthetic Project Group row carries its bundle
 * price as `unitPrice` with `duration: 1`, so the same formula covers it.
 */
export function lineGrossAmount(item: {
  unitPrice?: number | null;
  quantity?: number | null;
  duration?: number | null;
}): number {
  const unitPrice = Number(item.unitPrice ?? 0);
  const quantity = Number(item.quantity ?? 0);
  const duration = Number(item.duration ?? 1);
  if (!Number.isFinite(unitPrice) || !Number.isFinite(quantity) || !Number.isFinite(duration)) return 0;
  return unitPrice * quantity * (duration || 1);
}

/**
 * The discount as the operator entered it, for re-display in an edit form:
 * the percentage when the row was entered in `%` mode (derived — see the file
 * header), otherwise the flat dollar amount. Returns `""` for "no discount",
 * which is what the form inputs expect for a blank field.
 */
export function discountEntryValue(
  discount: number | null | undefined,
  mode: DiscountMode | null | undefined,
  grossAmount: number,
): string {
  if (discount == null || !(discount > 0)) return "";
  if (mode === "%") {
    const pct = discountPercentOf(discount, grossAmount);
    if (pct != null) return String(pct);
  }
  return String(discount);
}
