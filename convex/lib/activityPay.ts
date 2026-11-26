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
  return (row) => dropChanges(row, hidden);
}

/**
 * Crew DOCUMENT audit rows (`entityType: "crewDocument"`, written by `crewDocumentsWrites.updateNative`) carry the
 * document's label, kind and expiry in `details.fieldEdit` (the exact Undo needs them) and the owning member in
 * `details.crewMemberId`. That is identity material (owner ruling B2, `docs/pii-inventory.md`), but the activity reads
 * need only project read. A caller who fails `canSeeCrewDocuments` for the row's member gets the row with `details`
 * dropped entirely (entity type, action, summary and time stay; the summary names no label or expiry). A row with no
 * readable owner fails closed. The Undo is unaffected: it reads the stored row server-side.
 */
export const CREW_DOCUMENT_ENTITY = "crewDocument";

/** The owner of a crew-document audit row; `undefined` when the row isn't one, `null` when it names no owner. */
export function crewDocumentRowMember(row: { entityType?: string; details?: unknown }): string | null | undefined {
  if (row.entityType !== CREW_DOCUMENT_ENTITY) return undefined;
  const id = (row.details as { crewMemberId?: unknown } | null | undefined)?.crewMemberId;
  return typeof id === "string" ? id : null;
}

/** `visibleMembers`: the crew members whose documents this caller may see. */
export function crewDocumentRedactor(visibleMembers: ReadonlySet<string>): ActivityRedactor {
  return (row) => {
    const owner = crewDocumentRowMember(row as { entityType?: string; details?: unknown });
    if (owner === undefined || (owner !== null && visibleMembers.has(owner))) return row;
    const { details: _dropped, ...rest } = row;
    return rest as typeof row;
  };
}
