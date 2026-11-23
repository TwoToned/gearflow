/**
 * The ONE definition of "a unit is packed": a non-cancelled unit that sits in a
 * case (`containerId`). Plain module (no Convex imports) so the server's plan
 * writes, the Make-live preview, the versions facts, readiness and the Packing
 * tab's own glyph / counts all read the same rule; two copies would let
 * `plannedCount` and `Packing n/m` disagree (POLICY.md R-3.1).
 */
export interface PackableUnit {
  status?: string | null;
  containerId?: string | null;
}

export function isPackedUnit(u: PackableUnit): boolean {
  return u.status !== "CANCELLED" && !!u.containerId;
}
