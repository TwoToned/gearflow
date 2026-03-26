/**
 * Shared pass/fail calculation for test & tag records.
 * Used by both client (instant UI feedback) and server (authoritative result).
 */

import type { ProfileThresholds, ElectricalTest } from "@/lib/test-profiles/seed-data";

export type TestReading = {
  key: string;
  value: number | null;
  result?: "PASS" | "FAIL" | "NOT_APPLICABLE";
};

export type SubTestInput = {
  label: string;
  earthContinuityReading: number | null;
  insulationReading: number | null;
  leakageCurrentReading: number | null;
  polarityResult: "PASS" | "FAIL" | "NOT_APPLICABLE";
};

export type VisualCheckInput = {
  key: string;
  passed: boolean;
};

/**
 * Evaluate a single electrical reading against its threshold.
 */
export function evaluateReading(
  value: number | null,
  threshold: number | null,
  operator: "lt" | "lte" | "gt" | "gte" | null,
): "PASS" | "FAIL" | "NOT_APPLICABLE" {
  if (value === null || value === undefined || threshold === null || operator === null) {
    return "NOT_APPLICABLE";
  }
  switch (operator) {
    case "lt": return value < threshold ? "PASS" : "FAIL";
    case "lte": return value <= threshold ? "PASS" : "FAIL";
    case "gt": return value > threshold ? "PASS" : "FAIL";
    case "gte": return value >= threshold ? "PASS" : "FAIL";
    default: return "NOT_APPLICABLE";
  }
}

/**
 * Calculate the visual inspection result from a list of checks.
 * All enabled checks must pass for an overall PASS.
 */
export function calculateVisualResult(
  checks: VisualCheckInput[],
  enabledKeys: string[],
): "PASS" | "FAIL" {
  const enabledChecks = checks.filter(c => enabledKeys.includes(c.key));
  if (enabledChecks.length === 0) return "PASS";
  return enabledChecks.every(c => c.passed) ? "PASS" : "FAIL";
}

/**
 * Calculate the electrical test result from readings and profile thresholds.
 */
export function calculateElectricalResult(
  readings: TestReading[],
  tests: ElectricalTest[],
): "PASS" | "FAIL" {
  const enabledTests = tests.filter(t => t.enabled);
  if (enabledTests.length === 0) return "PASS";

  for (const test of enabledTests) {
    // Polarity and RCD push-button are manual pass/fail (no numeric reading)
    if (test.key === "polarity" || test.key === "rcdPushButton") {
      const reading = readings.find(r => r.key === test.key);
      if (reading?.result === "FAIL") return "FAIL";
      continue;
    }

    const reading = readings.find(r => r.key === test.key);
    if (!reading || reading.value === null) continue; // Skip if no reading provided

    const result = evaluateReading(reading.value, test.threshold, test.operator);
    if (result === "FAIL") return "FAIL";
  }

  return "PASS";
}

/**
 * Calculate a single sub-test result against profile thresholds.
 */
export function calculateSubTestResult(
  subTest: SubTestInput,
  thresholds: ProfileThresholds,
  enabledTests: ElectricalTest[],
): "PASS" | "FAIL" {
  const readings: TestReading[] = [];
  const enabledKeys = enabledTests.filter(t => t.enabled).map(t => t.key);

  if (enabledKeys.includes("earthContinuity") && subTest.earthContinuityReading !== null) {
    const result = evaluateReading(subTest.earthContinuityReading, thresholds.earthMax ?? null, "lt");
    if (result === "FAIL") return "FAIL";
    readings.push({ key: "earthContinuity", value: subTest.earthContinuityReading, result });
  }

  if (enabledKeys.includes("insulationResistance") && subTest.insulationReading !== null) {
    const result = evaluateReading(subTest.insulationReading, thresholds.insulationMin ?? null, "gte");
    if (result === "FAIL") return "FAIL";
    readings.push({ key: "insulationResistance", value: subTest.insulationReading, result });
  }

  if (enabledKeys.includes("leakageCurrent") && subTest.leakageCurrentReading !== null) {
    const result = evaluateReading(subTest.leakageCurrentReading, thresholds.leakageMax ?? null, "lte");
    if (result === "FAIL") return "FAIL";
    readings.push({ key: "leakageCurrent", value: subTest.leakageCurrentReading, result });
  }

  if (enabledKeys.includes("polarity") && subTest.polarityResult === "FAIL") {
    return "FAIL";
  }

  return "PASS";
}

/**
 * Calculate the overall test result from visual, electrical, and sub-test results.
 */
export function calculateOverallResult(
  visualResult: "PASS" | "FAIL",
  electricalResult: "PASS" | "FAIL",
  subTestResults: ("PASS" | "FAIL")[],
): "PASS" | "FAIL" {
  if (visualResult === "FAIL") return "FAIL";
  if (electricalResult === "FAIL") return "FAIL";
  if (subTestResults.some(r => r === "FAIL")) return "FAIL";
  return "PASS";
}
