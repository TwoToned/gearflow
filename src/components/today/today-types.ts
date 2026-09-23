import type { TodayBucket } from "@/lib/today-buckets";

/** One row on Today's work list — a personal task or a mention, normalised so
 *  the bucket sections, keyboard nav and peek panel can all be generic over
 *  "the thing in front of the user" (work-layer phase 0.5, #1242). */
export interface TodayItem {
  /** Stable across renders — `task:<id>` or `mention:<id>`. */
  key: string;
  kind: "task" | "mention";
  bucket: TodayBucket | "triage";
  title: string;
  /** "Project · due" style secondary line. */
  contextLine: string;
  /** Absent for a personal task (Phase 1, #1243 quick-add with no project) — nothing to "open". */
  href?: string;
  overdue: boolean;
  /** Tasks only — undefined for a mention (nothing to "do" on a mention row itself). */
  done?: boolean;
  /** Mentions only — undefined (already "read") once opened. */
  readAt?: number | null;
  /** Tasks only — set when the follow-up engine owns the row (design §8.7):
   *  why it exists, which rung, whether it's urgent. */
  followUp?: FollowUpMeta | null;
  raw: unknown;
}

export interface FollowUpMeta {
  why: string;
  urgent: boolean;
  rung: number;
}
