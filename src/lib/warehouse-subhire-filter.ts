/**
 * Sub-hire equipment is sourced externally (from a supplier), not from internal
 * stock — it never goes through internal-asset-only paths: it's not a "real" kit
 * child to hide from the equipment list, and it never needs the internal
 * serialized-asset picker (there's no internal asset to pick). This distinguishes
 * a line item's own sub-hire from the sub-hire *group parent* wrapper, which is
 * filtered separately.
 *
 * Extracted as its own predicate after a bug (CodeQL js/comparison-between-
 * incompatible-types, `!x.subHireId != null`) collapsed to always-true from an
 * operator-precedence mistake, silently hiding sub-hire kit children and
 * mis-routing sub-hire serialized items in the warehouse page.
 */
export function isInternalStockLine(subHireId: string | null | undefined): boolean {
  return !subHireId;
}
