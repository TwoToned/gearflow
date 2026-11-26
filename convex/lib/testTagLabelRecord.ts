/**
 * Which test a printed Test & tag label shows (UX Phase 14, 14a-3b): the ONE rule for both the single `Print label` on the
 * record page and `Print tags`. A label is a compliance document, so it must never print the wrong test: the record is
 * the one whose `testDate` equals the item's own stored `lastTestDate` (the date its next due was computed from). No match
 * means `null`, and the caller fails CLOSED (the item is not printed) rather than guessing the newest-looking row.
 */
export function pickLabelRecord<T>(records: readonly T[], lastTestDate: number | null | undefined, testDateOf: (r: T) => number): T | null {
  if (lastTestDate == null) return null;
  return records.find((r) => testDateOf(r) === lastTestDate) ?? null;
}
