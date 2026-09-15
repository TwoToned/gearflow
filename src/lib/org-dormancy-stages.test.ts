/**
 * Unit tests for the B4 (#1096) "never activated" ladder's pure logic.
 *
 * The properties that matter: stage advancement never regresses or repeats,
 * a missed tick catches up to exactly one (the most-advanced due) stage
 * rather than replaying every skipped one, and the eligibility predicate
 * fails the instant any qualifying activity exists.
 */
import { describe, it, expect } from "vitest";

import {
  STAGE_DAY1,
  STAGE_DAY3,
  STAGE_DAY7,
  STAGE_DAY23_WARNING,
  STAGE_DAY29_FINAL_WARNING,
  STAGE_DAY30_ARCHIVED,
  isStillNeverActivated,
  nextDormancyStage,
} from "./org-dormancy-stages";

describe("nextDormancyStage", () => {
  it("returns null before the earliest threshold is reached", () => {
    expect(nextDormancyStage(0, 0)).toBeNull();
  });

  it("advances one stage at a time on a tick-per-day cadence", () => {
    expect(nextDormancyStage(0, 1)).toBe(STAGE_DAY1);
    expect(nextDormancyStage(STAGE_DAY1, 3)).toBe(STAGE_DAY3);
    expect(nextDormancyStage(STAGE_DAY3, 7)).toBe(STAGE_DAY7);
    expect(nextDormancyStage(STAGE_DAY7, 23)).toBe(STAGE_DAY23_WARNING);
    expect(nextDormancyStage(STAGE_DAY23_WARNING, 29)).toBe(STAGE_DAY29_FINAL_WARNING);
    expect(nextDormancyStage(STAGE_DAY29_FINAL_WARNING, 30)).toBe(STAGE_DAY30_ARCHIVED);
  });

  it("never re-sends a stage the org already has", () => {
    expect(nextDormancyStage(STAGE_DAY1, 1)).toBeNull();
    expect(nextDormancyStage(STAGE_DAY7, 7)).toBeNull();
    expect(nextDormancyStage(STAGE_DAY30_ARCHIVED, 999)).toBeNull();
  });

  it("catches up to the single most-advanced due stage after a missed tick, not every skipped one", () => {
    // A cron outage from day 0 to day 30: one email, straight to archive.
    expect(nextDormancyStage(0, 30)).toBe(STAGE_DAY30_ARCHIVED);
    // Missed days 3 and 7 — lands on the day 7 stage, not day 3.
    expect(nextDormancyStage(STAGE_DAY1, 10)).toBe(STAGE_DAY7);
  });

  it("is monotonic — the returned stage is always greater than currentStage when non-null", () => {
    for (let current = 0; current <= STAGE_DAY30_ARCHIVED; current++) {
      for (let days = 0; days <= 40; days++) {
        const next = nextDormancyStage(current, days);
        if (next !== null) expect(next).toBeGreaterThan(current);
      }
    }
  });
});

describe("isStillNeverActivated", () => {
  const empty = { lastActivityAt: null, hasAnyMilestone: false };

  it("is true for a solo org with zero activity and zero milestones", () => {
    expect(isStillNeverActivated(1, empty)).toBe(true);
  });

  it("is false once a second member has joined", () => {
    expect(isStillNeverActivated(2, empty)).toBe(false);
  });

  it("is false once any milestone has been hit", () => {
    expect(isStillNeverActivated(1, { ...empty, hasAnyMilestone: true })).toBe(false);
  });

  it("is false once any activity has been logged", () => {
    expect(isStillNeverActivated(1, { ...empty, lastActivityAt: Date.now() })).toBe(false);
  });
});
