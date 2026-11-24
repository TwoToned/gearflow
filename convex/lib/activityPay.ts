import { JOB_COST_FIELDS, MEMBER_RATE_FIELDS, ROLE_RATE_FIELDS, SERVICE_CREW_COST_FIELDS } from "./crewPayFields";

/**
 * The activity log keeps crew pay in its field diffs (`details.changes`, e.g.
 * `crewWrites.updateNative`'s `defaultDayRate` from → to): the audit needs it,
 * so it is still WRITTEN. It is redacted at READ time for a caller below the
 * pay line (the ONE rule, `canSeeCrewPay` / `callerSeesCrewPay`), by the same
 * field lists every other pay read uses (lib/crewPayFields.ts). A change row
 * for one of those fields is dropped; the rest of the entry stays (UX Phase 15).
 */
const PAY_FIELDS: ReadonlySet<string> = new Set([
  ...MEMBER_RATE_FIELDS,
  ...ROLE_RATE_FIELDS,
  ...SERVICE_CREW_COST_FIELDS,
  ...JOB_COST_FIELDS,
]);

type WithDetails = { details?: unknown };

export function redactActivityPay<R extends WithDetails>(row: R): R {
  const d = row.details as { changes?: unknown } | null | undefined;
  if (!d || typeof d !== "object" || !Array.isArray(d.changes)) return row;
  const changes = (d.changes as { field?: unknown }[]).filter((c) => !(typeof c?.field === "string" && PAY_FIELDS.has(c.field)));
  if (changes.length === d.changes.length) return row;
  return { ...row, details: { ...d, changes } };
}
