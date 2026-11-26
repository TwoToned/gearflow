import { describe, expect, it } from "vitest";
import { testReadingWords, testTagChecks, testTagStateWord } from "@/lib/test-tag-record-facts";

const NOW = Date.UTC(2026, 10, 26);
const DAY = 86_400_000;
const tested = { status: "CURRENT", isActive: true, lastTestDate: NOW - 30 * DAY, lastResult: "PASS", testProfileId: "p1" };

describe("testTagStateWord", () => {
  it("is the list's own state with how far overdue / how soon due", () => {
    expect(testTagStateWord({ ...tested, nextDueDate: NOW + 60 * DAY }, NOW)).toMatchObject({ state: "PASSED", label: "Passed", intent: "success" });
    expect(testTagStateWord({ ...tested, nextDueDate: NOW - 18 * DAY }, NOW)).toMatchObject({ state: "OVERDUE", label: "18d overdue", intent: "error" });
    expect(testTagStateWord({ ...tested, nextDueDate: NOW + 5 * DAY }, NOW)).toMatchObject({ state: "DUE", label: "Due in 5d" });
    expect(testTagStateWord({ status: "NOT_YET_TESTED", isActive: true }, NOW)).toMatchObject({ state: "DUE", label: "Not yet tested" });
    expect(testTagStateWord({ ...tested, status: "FAILED" }, NOW)).toMatchObject({ state: "FAILED", label: "Failed" });
    expect(testTagStateWord({ ...tested, status: "RETIRED", isActive: false }, NOW)).toMatchObject({ state: "RETIRED", outline: true });
  });

  it("the org's own due-soon horizon moves the Due line", () => {
    const i = { ...tested, nextDueDate: NOW + 20 * DAY };
    expect(testTagStateWord(i, NOW, 14).state).toBe("PASSED");
    expect(testTagStateWord(i, NOW, 30).state).toBe("DUE");
  });
});

describe("testTagChecks", () => {
  it("a current, passed, profiled item is all clear (3 of 3)", () => {
    const c = testTagChecks({ ...tested, nextDueDate: NOW + 60 * DAY }, NOW);
    expect(c).toMatchObject({ total: 3, clear: 3, closed: false });
  });

  it("an overdue item with no profile names each failing check with its fix; never-tested is not checked, never a pass", () => {
    const c = testTagChecks({ ...tested, testProfileId: null, nextDueDate: NOW - 5 * DAY }, NOW);
    expect(c.clear).toBe(1);
    expect(c.items.find((i) => i.key === "current")).toMatchObject({ tone: "bad", fix: "test" });
    expect(c.items.find((i) => i.key === "profile")).toMatchObject({ tone: "warn", fix: "edit" });
    const n = testTagChecks({ status: "NOT_YET_TESTED", isActive: true, testProfileId: "p" }, NOW);
    expect(n.items.find((i) => i.key === "result")).toMatchObject({ tone: "unknown" });
    expect(n.clear).toBe(1);
  });

  it("a failed last test fails the result check; a retired item runs no checks", () => {
    expect(testTagChecks({ ...tested, lastResult: "FAIL", nextDueDate: NOW + DAY * 60 }, NOW).items.find((i) => i.key === "result")).toMatchObject({ tone: "bad" });
    expect(testTagChecks({ ...tested, status: "RETIRED", isActive: false }, NOW)).toMatchObject({ closed: true, total: 0 });
  });
});

describe("testReadingWords", () => {
  it("names only the readings that were recorded, with their units (0 is a reading)", () => {
    expect(testReadingWords({ earthContinuityReading: 0.12, insulationReading: 0, leakageCurrentReading: undefined, rcdTripTimeReading: 25 })).toEqual(["Earth 0.12 Ω", "Insulation 0 MΩ", "RCD trip 25 ms"]);
    expect(testReadingWords({})).toEqual([]);
  });
});
