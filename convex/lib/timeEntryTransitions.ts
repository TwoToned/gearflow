/**
 * The timesheet status transitions (UX Phase 15, D47): which statuses each
 * verb moves an entry FROM, and the status it moves it TO. One definition
 * (R-3.1): `crewTimeEntriesWrites` gates every write on it, and the timesheet
 * row menu / bulk bar (`src/lib/row-actions/time-entry.ts`) offer a verb only
 * for the entries it would actually change. Plain module: no Convex imports.
 */
export type TimeEntryTransition = "submit" | "approve" | "query";

export const TIME_ENTRY_TRANSITION_FROM: Readonly<Record<TimeEntryTransition, readonly string[]>> = {
  submit: ["DRAFT", "DISPUTED"],
  approve: ["SUBMITTED", "DISPUTED"],
  query: ["SUBMITTED", "APPROVED"],
};

export const TIME_ENTRY_TRANSITION_TO: Readonly<Record<TimeEntryTransition, string>> = {
  submit: "SUBMITTED",
  approve: "APPROVED",
  query: "DISPUTED",
};

/** Exported entries are locked: no verb, no edit (as live). */
export const TIME_ENTRY_LOCKED_STATUS = "EXPORTED";

/** True when `transition` would change an entry currently at `status` (absent = DRAFT). */
export function canTransition(status: string | null | undefined, transition: TimeEntryTransition): boolean {
  return TIME_ENTRY_TRANSITION_FROM[transition].includes(status ?? "DRAFT");
}
