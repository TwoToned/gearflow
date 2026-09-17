import { startOfDayInTimezone, endOfDayInTimezone } from "@/lib/quote-validity";

/**
 * The Overdue / Today / Later split for Today (work-layer phase 0.5, #1242).
 *
 * Every boundary resolves in the ORG's timezone via the same
 * `startOfDayInTimezone`/`endOfDayInTimezone` primitives quote-validity math
 * already uses (`convex/lib/quoteDates.ts`'s byte-for-byte client mirror) —
 * never the browser's zone. `/my-tasks` and the dashboard's tasks-due block
 * bucket by BROWSER-local `setHours(0,0,0,0)`, which puts a PM's "today" a
 * day out the moment their browser isn't in the org's timezone (work-layer.md
 * §16's guardrail). Today does not repeat that.
 */
export type TodayBucket = "overdue" | "today" | "later";

export function bucketForDueDate(
  dueDate: number | null | undefined,
  nowMs: number,
  timezone: string | undefined,
): TodayBucket {
  if (dueDate == null) return "later";
  const startOfToday = startOfDayInTimezone(nowMs, timezone);
  if (dueDate < startOfToday) return "overdue";
  const endOfToday = endOfDayInTimezone(nowMs, timezone);
  if (dueDate <= endOfToday) return "today";
  return "later";
}
