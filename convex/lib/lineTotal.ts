/**
 * Pure money helpers shared by the native line-item write mutations.
 *
 * Byte-parity ports of:
 *  - `roundCurrency`  (src/lib/formatters.ts:27)
 *  - `computeLineTotal` (src/hooks/use-native-line-item-writes.ts:25)
 *
 * The server action, the client optimistic overlay, and now the in-mutation bulk
 * recompute all derive `lineTotal` the same way, so a browser-direct bulk edit lands
 * exactly the value every other consumer would have produced.
 */

/** roundCurrency port (src/lib/formatters.ts:27) — half-up on cents. */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * lineTotal = max(0, round(unitPrice·qty·duration) − discount); `null` when there is no
 * unit price. Byte-parity port of use-native-line-item-writes.ts `computeLineTotal`.
 */
export function computeLineTotal(
  unitPrice: number | undefined,
  quantity: number,
  duration: number,
  discount: number | undefined,
): number | null {
  if (unitPrice == null) return null;
  const gross = roundCurrency(unitPrice * quantity * duration);
  return Math.max(0, roundCurrency(gross - (discount ?? 0)));
}
