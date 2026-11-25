// @vitest-environment node
import { describe, expect, test } from "vitest";
import { DEFAULT_DUE_SOON_DAYS, clampDueSoonDays, deriveTestTagState, parseTestTagSegment, testTagInSegment } from "./testTagListState";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("deriveTestTagState", () => {
  test("derives from the dates, never from the stored cron word", () => {
    // Stored says CURRENT but the due date has passed: it is Overdue.
    expect(deriveTestTagState({ status: "CURRENT", nextDueDate: NOW - DAY, lastTestDate: NOW - 400 * DAY }, NOW, 14)).toBe("OVERDUE");
    // Stored says OVERDUE (cron lag) but the next test was just done: it is Passed.
    expect(deriveTestTagState({ status: "OVERDUE", nextDueDate: NOW + 300 * DAY, lastTestDate: NOW }, NOW, 14)).toBe("PASSED");
  });

  test("Due is the window; the horizon is the caller's", () => {
    const item = { nextDueDate: NOW + 20 * DAY, lastTestDate: NOW - 100 * DAY };
    expect(deriveTestTagState(item, NOW, 14)).toBe("PASSED");
    expect(deriveTestTagState(item, NOW, 30)).toBe("DUE");
  });

  test("never tested is Due; failed and retired win over the dates", () => {
    expect(deriveTestTagState({}, NOW, 14)).toBe("DUE");
    expect(deriveTestTagState({ status: "FAILED", nextDueDate: NOW - DAY }, NOW, 14)).toBe("FAILED");
    expect(deriveTestTagState({ status: "RETIRED", nextDueDate: NOW - DAY }, NOW, 14)).toBe("RETIRED");
    expect(deriveTestTagState({ isActive: false }, NOW, 14)).toBe("RETIRED");
  });
});

describe("segments and horizon", () => {
  test("All is everything not retired; Retired stays reachable; unknown words fall back", () => {
    expect(testTagInSegment("OVERDUE", "all")).toBe(true);
    expect(testTagInSegment("RETIRED", "all")).toBe(false);
    expect(testTagInSegment("RETIRED", "retired")).toBe(true);
    expect(testTagInSegment("DUE", "due")).toBe(true);
    expect(testTagInSegment("OVERDUE", "due")).toBe(false);
    expect(parseTestTagSegment("nope")).toBe("due");
  });

  test("the due-soon horizon is clamped, junk is the default", () => {
    expect(clampDueSoonDays(undefined)).toBe(DEFAULT_DUE_SOON_DAYS);
    expect(clampDueSoonDays(Number.NaN)).toBe(DEFAULT_DUE_SOON_DAYS);
    expect(clampDueSoonDays(0)).toBe(1);
    expect(clampDueSoonDays(9999)).toBe(90);
  });
});
