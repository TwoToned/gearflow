/**
 * B4 (#1096) — pure predicate/stage logic for the "never activated" email
 * ladder, split out of `src/server/org-dormancy.ts` (a `"use server"` file)
 * because every export from a server-action module must be async; these are
 * plain functions so they can be unit-tested directly with no Prisma/Convex/
 * email mocking at all. See `org-dormancy.ts` for the full design rationale.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export const STAGE_DAY1 = 1;
export const STAGE_DAY3 = 2;
export const STAGE_DAY7 = 3;
export const STAGE_DAY23_WARNING = 4;
export const STAGE_DAY29_FINAL_WARNING = 5;
export const STAGE_DAY30_ARCHIVED = 6;

// Highest threshold first: a tick missed to a deploy/outage catches up to
// the single most-advanced applicable stage in one email, not five at once.
const STAGE_THRESHOLDS: ReadonlyArray<{ stage: number; minDays: number }> = [
  { stage: STAGE_DAY30_ARCHIVED, minDays: 30 },
  { stage: STAGE_DAY29_FINAL_WARNING, minDays: 29 },
  { stage: STAGE_DAY23_WARNING, minDays: 23 },
  { stage: STAGE_DAY7, minDays: 7 },
  { stage: STAGE_DAY3, minDays: 3 },
  { stage: STAGE_DAY1, minDays: 1 },
];

/** The next ladder stage to advance to, or null if none is due yet. */
export function nextDormancyStage(currentStage: number, daysSinceCreation: number): number | null {
  for (const { stage, minDays } of STAGE_THRESHOLDS) {
    if (stage > currentStage && daysSinceCreation >= minDays) return stage;
  }
  return null;
}

/** The same "never activated" predicate as site-admin.ts's
 *  `isNeverActivated`, minus the 30-day-age leg (the sweep checks age via
 *  `nextDormancyStage` instead, since it needs the age for EVERY stage
 *  threshold, not just the terminal one). */
export function isStillNeverActivated(
  memberCount: number,
  stats: { lastActivityAt: number | null; hasAnyMilestone: boolean },
): boolean {
  return memberCount === 1 && !stats.hasAnyMilestone && stats.lastActivityAt === null;
}
