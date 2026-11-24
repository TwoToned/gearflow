import { differenceInCalendarDays } from "date-fns";

/**
 * Small, pure row facts for Home's widgets (UX Phase 11, §6c.2), so the words
 * are tested once rather than re-derived in each widget.
 */

export type DueTone = "late" | "today" | "plain";

/** A task's due word: `2d overdue` / `Today` / the date (via `formatDate`). Undated = null. */
export function taskDueText(
  dueMs: number | null | undefined,
  now: number,
  formatDate: (d: Date) => string,
): { text: string; tone: DueTone } | null {
  if (dueMs == null) return null;
  const days = differenceInCalendarDays(dueMs, now);
  if (days < 0) return { text: `${-days}d overdue`, tone: "late" };
  if (days === 0) return { text: "Today", tone: "today" };
  return { text: formatDate(new Date(dueMs)), tone: "plain" };
}

/** A live job's back-in word: `3d overdue` / `back today` / `back in 2d`. Undated = null. */
export function floorBackText(endMs: number | null | undefined, now: number): { text: string; late: boolean } | null {
  if (endMs == null) return null;
  const days = differenceInCalendarDays(endMs, now);
  if (days < 0) return { text: `${-days}d overdue`, late: true };
  if (days === 0) return { text: "back today", late: false };
  return { text: `back in ${days}d`, late: false };
}
