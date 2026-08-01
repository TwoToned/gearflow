/**
 * Per-org fairness cap for a bounded platform-wide cron scan (R-9.8, #1077 A7).
 *
 * `collectCapped` (lib/pagination.ts) bounds a scan's TOTAL row count so it can
 * never read unbounded — but that alone doesn't guarantee FAIRNESS across
 * tenants: if one org supplies most of the rows within that budget, every
 * other org's rows can be starved out of every single run, forever (the same
 * prefix gets read every tick). This is a pure post-filter over an
 * already-bounded read: cap how many rows any one organizationId contributes,
 * so a high-volume tenant can never fully consume a shared scan budget.
 *
 * Capped rows aren't lost — they're picked up on a later run, same
 * "truncated, retried next tick" semantics `collectCapped` already has for the
 * overall cap.
 */
export interface FairnessCapResult<T> {
  rows: T[];
  cappedOrgIds: Set<string>;
}

export function applyPerOrgFairnessCap<T extends { organizationId: string }>(
  rows: T[],
  maxPerOrg: number,
): FairnessCapResult<T> {
  const perOrgCount = new Map<string, number>();
  const cappedOrgIds = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const count = perOrgCount.get(row.organizationId) ?? 0;
    if (count >= maxPerOrg) {
      cappedOrgIds.add(row.organizationId);
      continue;
    }
    perOrgCount.set(row.organizationId, count + 1);
    kept.push(row);
  }
  return { rows: kept, cappedOrgIds };
}
