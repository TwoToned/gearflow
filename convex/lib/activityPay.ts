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

type WithDetails = { details?: unknown; entityType?: string };
export type ActivityRedactor = <R extends WithDetails>(row: R) => R;

/**
 * On a MAINTENANCE row, job cost is the record's labour (`cost`) and a part's `unitPrice` (UX Phase 14, D76). They are
 * named by entity, never globally: `unitPrice` is a visible SELL price on a job line, so a name-only list would hide
 * the wrong thing. The record's field-edit snapshot (`fieldEdit`), a part write (`partOp`) and Complete / Reopen
 * (`lifecycle`) all carry before/after by field name, so each is filtered the same way.
 */
/**
 * The money keys inside EACH audit-detail snapshot shape a maintenance write leaves, in ONE registry. A new snapshot
 * shape on a maintenance write must be listed here: `convex/maintenanceAuditShapes.test.ts` scans the writers'
 * `details: { <shape>` keys and fails on any shape that is neither listed nor a known no-money one.
 */
export const MAINTENANCE_MONEY_SHAPES: Readonly<Record<string, readonly string[]>> = {
  fieldEdit: ["cost"], // the edit sheet and the bulk verbs (`recordFieldEdit`): the record's labour
  partOp: ["unitPrice"], // a part write: the part's price
  lifecycle: ["cost"], // Complete / Reopen: the record's labour
};

function dropMaintenanceCost(d: Record<string, unknown>): Record<string, unknown> {
  let next = d;
  for (const [shape, keys] of Object.entries(MAINTENANCE_MONEY_SHAPES)) {
    const snap = d[shape] as { before?: unknown; after?: unknown } | undefined;
    if (!snap || typeof snap !== "object") continue;
    const hidden = new Set(keys);
    const before = withoutKeys(snap.before, hidden);
    const after = withoutKeys(snap.after, hidden);
    if (before !== snap.before || after !== snap.after) next = { ...next, [shape]: { ...snap, before, after } };
  }
  return next;
}

/** `without(obj)` minus the hidden keys; the same object when none were there. */
function withoutKeys(obj: unknown, hidden: ReadonlySet<string>): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const kept = Object.entries(obj as Record<string, unknown>).filter(([k]) => !hidden.has(k));
  return kept.length === Object.keys(obj).length ? obj : Object.fromEntries(kept);
}

/**
 * The exact-Undo snapshot (`details.fieldEdit`, `lib/fieldEditUndo.ts`) carries each changed field's
 * before/after BY FIELD NAME, so the very same hidden lists drop it: a field a caller may not see is
 * absent from the snapshot they read, and the Undo (which reads the stored row server-side) is unaffected.
 */
function dropFieldEdit(d: { fieldEdit?: unknown }, hidden: ReadonlySet<string>): { fieldEdit?: unknown } {
  const fe = d.fieldEdit as { before?: unknown; after?: unknown } | undefined;
  if (!fe || typeof fe !== "object") return d;
  const before = withoutKeys(fe.before, hidden);
  const after = withoutKeys(fe.after, hidden);
  return before === fe.before && after === fe.after ? d : { ...d, fieldEdit: { ...fe, before, after } };
}

function dropChanges<R extends WithDetails>(row: R, hidden: ReadonlySet<string>): R {
  const d = row.details as { changes?: unknown; fieldEdit?: unknown } | null | undefined;
  if (!d || typeof d !== "object") return row;
  let next: typeof d = dropFieldEdit(d, hidden);
  if (Array.isArray(d.changes)) {
    const changes = (d.changes as { field?: unknown }[]).filter((c) => !(typeof c?.field === "string" && hidden.has(c.field)));
    if (changes.length !== d.changes.length) next = { ...next, changes };
  }
  return next === d ? row : { ...row, details: next };
}

/** The activity-row redactor for a caller, from its two answers. Identity when it sees both. */
export function activityMoneyRedactor(seen: { pay: boolean; jobCost: boolean }): ActivityRedactor {
  const hidden = new Set([...(seen.pay ? [] : PAY_FIELDS), ...(seen.jobCost ? [] : JOB_COST_FIELDS)]);
  if (hidden.size === 0) return (row) => row;
  return (row) => {
    const redacted = dropChanges(row, hidden);
    if (seen.jobCost || row.entityType !== "maintenance") return redacted;
    const d = redacted.details as Record<string, unknown> | null | undefined;
    if (!d || typeof d !== "object") return redacted;
    const next = dropMaintenanceCost(d);
    return next === d ? redacted : { ...redacted, details: next };
  };
}
