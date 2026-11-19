/**
 * Stock demand of a line (off-inventory units, FEATUREDOCS/11).
 *
 * `projectLineItems.offInventoryQuantity` counts the units of a line that are
 * sourced outside the fleet ("prep as custom item"): they stay on the line —
 * same price, same document row — but no serial backs them, so they must never
 * count as demand on the model's stock. EVERY site that sums a line's quantity
 * as stock demand goes through here; billing/display keep using `quantity`.
 *
 * Plain module (no ctx) so Convex and `src/` share one definition.
 */
export function stockBackedQty(line: {
  quantity?: number | null;
  offInventoryQuantity?: number | null;
}): number {
  return Math.max(0, (line.quantity ?? 0) - (line.offInventoryQuantity ?? 0));
}
