/**
 * Convex-native port of `src/lib/activity-log.ts#buildChanges` — a pure field-diff
 * for audit `details.changes`. Compares `before`/`after` on the named fields (JSON
 * equality) and returns the changed ones. Kept dependency-free so browser-direct
 * mutations can compute their own audit diff in-transaction.
 */
export function buildChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Array<{ field: string; from: unknown; to: unknown }> {
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of fields) {
    const fromVal = before[field] ?? null;
    const toVal = after[field] ?? null;
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      changes.push({ field, from: fromVal, to: toVal });
    }
  }
  return changes;
}
