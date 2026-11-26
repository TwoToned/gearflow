/**
 * The CHANGED fields of an edit sheet, as an edit write's `set` / `clear` (UX Phase 14). A sheet sends only what the person
 * changed against the values it OPENED with: sending every field would silently revert another user's edit made after the
 * sheet opened (the same rule as the job edit sheet's `buildProjectUpdate(parsed, { before })`). `undefined` is blank:
 * a changed blank CLEARS its field; an unchanged field is absent from both lists.
 */
export type EditEntry = readonly [field: string, now: unknown, was: unknown];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function changedEdit(entries: readonly EditEntry[]): { set: Record<string, unknown>; clear: string[] } {
  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const [field, now, was] of entries) {
    if (same(now, was)) continue;
    if (now === undefined) clear.push(field);
    else set[field] = now;
  }
  return { set, clear };
}

/** A text box as the write takes it: trimmed, and blank is `undefined`. */
export const blankToUndefined = (s: string): string | undefined => s.trim() || undefined;
