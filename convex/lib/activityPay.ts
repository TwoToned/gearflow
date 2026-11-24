import { JOB_COST_FIELDS, MEMBER_RATE_FIELDS, ROLE_RATE_FIELDS, SERVICE_CREW_COST_FIELDS } from "./crewPayFields";

/**
 * The activity log keeps money in its field diffs (`details.changes`, e.g.
 * `crewWrites.updateNative`'s `defaultDayRate` from → to): the audit needs it,
 * so it is still WRITTEN. It is redacted at READ time by the same two lines
 * every other money read uses (lib/crewPayFields.ts, lib/crewPayRule.ts):
 *   - individual pay (a person's or role's rate, a service's own `costTotal`)
 *     for a caller below the pay line (`canSeeCrewPay` / `callerSeesCrewPay`);
 *   - job cost (`JOB_COST_FIELDS`) for a caller without job cost
 *     (`canSeeJobCost` / `callerSeesJobCost`, owner ruling 2026-11-24).
 * A change row for a hidden field is dropped; the rest of the entry stays.
 */
const PAY_FIELDS: readonly string[] = [...MEMBER_RATE_FIELDS, ...ROLE_RATE_FIELDS, ...SERVICE_CREW_COST_FIELDS];

type WithDetails = { details?: unknown };
export type ActivityRedactor = <R extends WithDetails>(row: R) => R;

function dropChanges<R extends WithDetails>(row: R, hidden: ReadonlySet<string>): R {
  const d = row.details as { changes?: unknown } | null | undefined;
  if (!d || typeof d !== "object" || !Array.isArray(d.changes)) return row;
  const changes = (d.changes as { field?: unknown }[]).filter((c) => !(typeof c?.field === "string" && hidden.has(c.field)));
  if (changes.length === d.changes.length) return row;
  return { ...row, details: { ...d, changes } };
}

/** The activity-row redactor for a caller, from its two answers. Identity when it sees both. */
export function activityMoneyRedactor(seen: { pay: boolean; jobCost: boolean }): ActivityRedactor {
  const hidden = new Set([...(seen.pay ? [] : PAY_FIELDS), ...(seen.jobCost ? [] : JOB_COST_FIELDS)]);
  if (hidden.size === 0) return (row) => row;
  return (row) => dropChanges(row, hidden);
}
