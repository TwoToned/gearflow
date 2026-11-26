/**
 * A maintenance record's `cost` is its LABOUR, which is JOB cost (UX Phase 14, D76): `canSeeJobCost`
 * (`lib/crewPayVisibility.ts`: `invoice:read` and not a `noFinancials` key) is the ONE rule, never the gear-cost
 * rule (`isAgentNoFinancials` alone). For a caller who cannot see it the key is ABSENT from the row, never zeroed,
 * so nothing can be back-solved. Every read that returns a maintenance row goes through this one helper.
 */
export function withoutCost<T extends { cost?: unknown }>(row: T, hidden: boolean): T {
  if (!hidden) return row;
  const { cost: _labour, ...rest } = row;
  void _labour;
  return rest as T;
}
