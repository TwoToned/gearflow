// @vitest-environment node
// D51 / Q11 — the server's reading checks and derived result (convex/lib/testTagReadings.ts).
import { describe, expect, test } from "vitest";
import {
  assertTopLevelReadings,
  checkSubTest,
  deriveOverallResult,
  deriveVisualResult,
  evaluateReading,
  parseProfileTests,
} from "./testTagReadings";
import { readingVerdict } from "../../src/lib/tt-draft";

const tests = parseProfileTests([
  { key: "earthContinuity", label: "Earth", threshold: 1, operator: "lt", enabled: true },
  { key: "polarity", label: "Polarity", threshold: null, operator: null, enabled: true },
  { key: "leakageCurrent", label: "Leakage", threshold: 5, operator: "lte", enabled: false },
]);

describe("evaluateReading", () => {
  test("the browser's preview (the Scan page's T&T draft) gives the server's verdict", () => {
    for (const [value, threshold, op] of [[0.5, 1, "lt"], [1, 1, "lt"], [5, 5, "lte"], [2, 2, "gt"]] as const) {
      expect(readingVerdict({ value: String(value), na: false }, { threshold, operator: op })).toBe(evaluateReading(value, threshold, op));
    }
  });
  test("no reading or no threshold is N/A", () => {
    expect(evaluateReading(null, 1, "lt")).toBe("NOT_APPLICABLE");
    expect(evaluateReading(0.5, null, "lt")).toBe("NOT_APPLICABLE");
    expect(evaluateReading(0.5, 1, null)).toBe("NOT_APPLICABLE");
  });
  test("operators", () => {
    expect(evaluateReading(0.5, 1, "lt")).toBe("PASS");
    expect(evaluateReading(1, 1, "lt")).toBe("FAIL");
    expect(evaluateReading(5, 5, "lte")).toBe("PASS");
    expect(evaluateReading(2, 2, "gte")).toBe("PASS");
    expect(evaluateReading(2, 2, "gt")).toBe("FAIL");
  });
});

describe("parseProfileTests", () => {
  test("ignores a legacy object blob and malformed rows", () => {
    expect(parseProfileTests({})).toEqual([]);
    expect(parseProfileTests([null, 3, { label: "no key" }])).toEqual([]);
  });
});

describe("assertTopLevelReadings", () => {
  const ok = { earthContinuityResult: "PASS", earthContinuityReading: 0.3, polarityResult: "PASS" };
  test("answered readings pass", () => {
    expect(() => assertTopLevelReadings(ok, tests)).not.toThrow();
  });
  test("a blank enabled reading is rejected; an explicit N/A is accepted", () => {
    expect(() => assertTopLevelReadings({ polarityResult: "PASS" }, tests)).toThrow(/Enter earth continuity, or mark it N\/A/);
    expect(() => assertTopLevelReadings({ polarityResult: "PASS", earthContinuityResult: "NOT_APPLICABLE" }, tests)).not.toThrow();
    expect(() => assertTopLevelReadings({ earthContinuityResult: "NOT_APPLICABLE" }, tests)).toThrow(/Enter polarity, or mark it N\/A/);
  });
  test("a disabled test may be left blank", () => {
    expect(() => assertTopLevelReadings(ok, tests)).not.toThrow();
  });
  test("a verdict that contradicts the threshold is rejected", () => {
    expect(() => assertTopLevelReadings({ ...ok, earthContinuityReading: 1.2 }, tests)).toThrow(/is a fail against/);
    expect(() => assertTopLevelReadings({ ...ok, earthContinuityResult: "FAIL" }, tests)).toThrow(/is a pass against/);
  });
  test("pair consistency applies with no profile at all", () => {
    expect(() => assertTopLevelReadings({ rcdTripTimeReading: 20 }, [])).toThrow(/no pass or fail/);
    expect(() => assertTopLevelReadings({ microwaveLeakageResult: "FAIL" }, [])).toThrow(/Enter the microwave leakage reading/);
  });
});

describe("checkSubTest", () => {
  const keys = new Set(["earthContinuity"]);
  test("derives FAIL from a failing component, and checks the outlet threshold", () => {
    expect(checkSubTest({ label: "Outlet 1", earthContinuityResult: "PASS", earthContinuityReading: 0.2 }, keys, { earthMax: 1 })).toBe("PASS");
    expect(checkSubTest({ label: "Outlet 1", earthContinuityResult: "FAIL", earthContinuityReading: 2 }, keys, { earthMax: 1 })).toBe("FAIL");
    expect(() => checkSubTest({ label: "Outlet 1", earthContinuityResult: "PASS", earthContinuityReading: 2 }, keys, { earthMax: 1 })).toThrow(/Outlet 1: The earth continuity reading is a fail/);
  });
  test("an enabled blank on an outlet is rejected", () => {
    expect(() => checkSubTest({ label: "Outlet 3" }, keys, {})).toThrow(/Outlet 3: Enter earth continuity, or mark it N\/A/);
  });
  test("a client FAIL is kept (the safe direction)", () => {
    expect(checkSubTest({ label: "O", result: "FAIL", earthContinuityResult: "NOT_APPLICABLE" }, keys, {})).toBe("FAIL");
  });
});

describe("derived results", () => {
  test("a false tick fails the visual inspection", () => {
    expect(deriveVisualResult({ visualInspectionResult: "PASS", visualPlugCondition: false })).toBe("FAIL");
    expect(deriveVisualResult({ visualPlugCondition: true })).toBe("PASS");
  });
  test("overall: visual, any reading verdict, functional, or an outlet fails it", () => {
    expect(deriveOverallResult({}, "PASS", [])).toBe("PASS");
    expect(deriveOverallResult({}, "FAIL", [])).toBe("FAIL");
    expect(deriveOverallResult({ rcdPushButtonResult: "FAIL" }, "PASS", [])).toBe("FAIL");
    expect(deriveOverallResult({ functionalTestResult: "FAIL" }, "PASS", [])).toBe("FAIL");
    expect(deriveOverallResult({}, "PASS", ["PASS", "FAIL"])).toBe("FAIL");
  });
});
