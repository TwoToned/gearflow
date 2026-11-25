/**
 * The ONE definition of a Test and tag item's list state (UX Phase 14, 14a-3, plan 6.5).
 *
 * The stored `status` DUE_SOON / OVERDUE is written by a cron and can lag, so the list never reads it.
 * State comes from the dates and the two stored facts the cron does not own:
 *
 *   RETIRED    `status === RETIRED` or `isActive === false`
 *   FAILED     stored `FAILED` (cleared by the next passing test, which rewrites the status)
 *   OVERDUE    `nextDueDate` is in the past
 *   DUE        `nextDueDate` falls within the due-soon window, or the item has never been tested
 *   PASSED     everything else (tested, and not due yet)
 *
 * `nextDueDate` itself stays what `deriveNextDueDate` makes it (last test + interval, D52): this module
 * only reads it. Nothing here is stored. Pure: the browser reads it too.
 */

export type TestTagListState = "RETIRED" | "FAILED" | "OVERDUE" | "DUE" | "PASSED";

/** The org's due-soon horizon when it has not set one (matches the T&T dashboard and the service worklist). */
export const DEFAULT_DUE_SOON_DAYS = 14;
const MAX_DUE_SOON_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Clamp a caller-supplied horizon into [1, 90] days; absent or junk is the default. */
export function clampDueSoonDays(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_DUE_SOON_DAYS;
  return Math.min(MAX_DUE_SOON_DAYS, Math.max(1, Math.floor(raw)));
}

export interface TestTagStateInput {
  status?: string | null;
  isActive?: boolean | null;
  nextDueDate?: number | null;
  lastTestDate?: number | null;
}

/** Pure: the item's list state at `now` for a due-soon horizon of `dueSoonDays`. */
export function deriveTestTagState(item: TestTagStateInput, now: number, dueSoonDays: number): TestTagListState {
  if (item.isActive === false || item.status === "RETIRED") return "RETIRED";
  if (item.status === "FAILED") return "FAILED";
  if (item.nextDueDate != null) {
    if (item.nextDueDate < now) return "OVERDUE";
    if (item.nextDueDate <= now + dueSoonDays * DAY_MS) return "DUE";
  }
  return item.lastTestDate == null ? "DUE" : "PASSED";
}

export const TEST_TAG_SEGMENT_KEYS = ["due", "overdue", "passed", "failed", "all", "retired"] as const;
export type TestTagSegmentKey = (typeof TEST_TAG_SEGMENT_KEYS)[number];

export function parseTestTagSegment(raw: string | undefined): TestTagSegmentKey {
  return TEST_TAG_SEGMENT_KEYS.find((k) => k === raw) ?? "due";
}

/** Pure: does an item in this state belong in the strip word? `all` is every item that is not retired. */
export function testTagInSegment(state: TestTagListState, seg: TestTagSegmentKey): boolean {
  if (seg === "all") return state !== "RETIRED";
  if (seg === "retired") return state === "RETIRED";
  if (seg === "due") return state === "DUE";
  return state === seg.toUpperCase();
}
