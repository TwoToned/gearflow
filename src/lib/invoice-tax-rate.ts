/**
 * The tax rate a stored invoice row printed at, derived from THAT row's own
 * frozen `taxAmount` over its `subtotal` — never from the org's current
 * default, which changes later and would make the document contradict itself
 * (CLAUDE.md: a finance render takes its data from the row). The invoice row
 * carries no per-rate breakdown, so this is the one derivation.
 *
 * Percent, e.g. `10`. Rounded to a sensible precision: the tax amount is
 * itself rounded to the cent, so a raw quotient wobbles (9.9991); a result
 * within 0.1 of a half-point snaps to it, otherwise it keeps two decimals.
 */
export function invoiceRowTaxRate(row: { subtotal: number; taxAmount: number }): number {
  if (!(row.subtotal > 0) || !(row.taxAmount > 0)) return 0;
  const raw = (row.taxAmount / row.subtotal) * 100;
  const half = Math.round(raw * 2) / 2;
  if (Math.abs(raw - half) < 0.1) return half;
  return Math.round(raw * 100) / 100;
}
