/**
 * The server side of a test & tag record's readings (Phase 16, D51 + overseer Q11).
 * Pure functions `testTagRecordsWrites.createNative` runs before it writes anything:
 *
 *  1. **Consistency** — every reading carries its OWN verdict: a numeric reading needs
 *     `PASS`/`FAIL`, a `PASS`/`FAIL` needs its reading, `NOT_APPLICABLE` carries none.
 *  2. **D51, blank ≠ N/A** — every test the profile ENABLES must be answered: a verdict
 *     (with its reading) or an explicit `NOT_APPLICABLE`. Absent = blank = rejected, so
 *     an untested appliance can no longer pass by leaving a box empty.
 *  3. **Thresholds** — where the profile states a threshold, the verdict must be the
 *     one the reading earns against it ({@link evaluateReading}); the client's dot is a
 *     preview, never the authority.
 *  4. **Overall result** — derived here from the verdicts, never taken from the client
 *     (the live bug F9: `createNative` used to store whatever `result` it was sent).
 *
 * `evaluateReading` and `TEST_FIELDS` live here and the Scan page's T&T draft
 * (`src/lib/tt-draft.ts`) imports them, so the browser's preview and the server's check
 * are one function (R-3.1).
 * ConvexError only.
 */
import { ConvexError } from "convex/values";

export type Verdict = "PASS" | "FAIL" | "NOT_APPLICABLE";
type Operator = "lt" | "lte" | "gt" | "gte";

const COMPARE: Record<Operator, (value: number, threshold: number) => boolean> = {
  lt: (value, threshold) => value < threshold,
  lte: (value, threshold) => value <= threshold,
  gt: (value, threshold) => value > threshold,
  gte: (value, threshold) => value >= threshold,
};

/** Evaluate one reading against its threshold. No reading / no threshold → N/A. */
export function evaluateReading(
  value: number | null | undefined,
  threshold: number | null | undefined,
  operator: Operator | null | undefined,
): Verdict {
  const compare = operator ? COMPARE[operator] : undefined;
  if (value == null || threshold == null || !compare) return "NOT_APPLICABLE";
  return compare(value, threshold) ? "PASS" : "FAIL";
}

/** A profile electrical test, as stored in the `testProfiles.electricalTests` blob. */
export interface ProfileTest {
  key: string;
  label: string;
  enabled: boolean;
  threshold: number | null;
  operator: Operator | null;
}

/** One top-level electrical test: the profile key, its record columns, and its words. */
interface TestField {
  key: string;
  label: string;
  result: string;
  reading?: string;
}

/** Every profile test key `createNative` knows, mapped to its record columns. */
export const TEST_FIELDS: readonly TestField[] = [
  { key: "earthContinuity", label: "earth continuity", result: "earthContinuityResult", reading: "earthContinuityReading" },
  { key: "insulationResistance", label: "insulation resistance", result: "insulationResult", reading: "insulationReading" },
  { key: "leakageCurrent", label: "leakage current", result: "leakageCurrentResult", reading: "leakageCurrentReading" },
  { key: "polarity", label: "polarity", result: "polarityResult" },
  { key: "rcdTripTime", label: "RCD trip time", result: "rcdTripTimeResult", reading: "rcdTripTimeReading" },
  { key: "rcdTripCurrent", label: "RCD trip current", result: "rcdTripCurrentResult", reading: "rcdTripCurrentReading" },
  { key: "rcdPushButton", label: "RCD push-button", result: "rcdPushButtonResult" },
  { key: "microwaveLeakage", label: "microwave leakage", result: "microwaveLeakageResult", reading: "microwaveLeakageReading" },
];

/** Sub-test (outlet) components, with the `testProfiles.thresholds` key + operator the
 *  outlet UI evaluates them against. */
const SUB_FIELDS = [
  { key: "earthContinuity", label: "earth continuity", result: "earthContinuityResult", reading: "earthContinuityReading", threshold: "earthMax", operator: "lt" },
  { key: "insulationResistance", label: "insulation resistance", result: "insulationResult", reading: "insulationReading", threshold: "insulationMin", operator: "gte" },
  { key: "leakageCurrent", label: "leakage current", result: "leakageCurrentResult", reading: "leakageCurrentReading", threshold: "leakageMax", operator: "lte" },
  { key: "polarity", label: "polarity", result: "polarityResult", reading: undefined, threshold: undefined, operator: undefined },
] as const;

type Bag = Record<string, unknown>;

function asOperator(raw: unknown): Operator | null {
  return raw === "lt" || raw === "lte" || raw === "gt" || raw === "gte" ? raw : null;
}

/**
 * A legacy object-shaped blob (`{ earthContinuity: true }` or `{ earthContinuity:
 * { enabled, threshold, operator } }`, keyed by test) as the array shape. Normalised
 * rather than ignored: ignoring it would silently switch D51 off for that profile.
 */
function legacyObjectTests(raw: Bag): Bag[] {
  return Object.entries(raw).map(([key, val]) =>
    // An entry without an explicit `enabled: false` counts as enabled (fail closed).
    val && typeof val === "object" ? { ...(val as Bag), key, enabled: (val as Bag).enabled !== false } : { key, enabled: val === true },
  );
}

/**
 * Parse the `electricalTests` blob defensively (it is `v.any()` in the schema). Absent
 * → no tests; an array or a legacy keyed object → its tests; anything else is a
 * corrupt profile and is rejected (never read as "no tests required").
 */
export function parseProfileTests(raw: unknown): ProfileTest[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object") throw new ConvexError("This test profile's electrical tests can't be read: fix the profile first");
  const rows: unknown[] = Array.isArray(raw) ? raw : legacyObjectTests(raw as Bag);
  return rows
    .filter((t): t is Bag => !!t && typeof t === "object" && typeof (t as Bag).key === "string")
    .map((t) => ({
      key: t.key as string,
      label: typeof t.label === "string" ? t.label : (t.key as string),
      enabled: t.enabled === true,
      threshold: typeof t.threshold === "number" ? t.threshold : null,
      operator: asOperator(t.operator),
    }));
}

function verdictOf(bag: Bag, field: string): Verdict | undefined {
  const v = bag[field];
  return v === "PASS" || v === "FAIL" || v === "NOT_APPLICABLE" ? v : undefined;
}

function readingOf(bag: Bag, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const v = bag[field];
  return typeof v === "number" ? v : undefined;
}

/** Rule 1 for one reading/verdict pair. `where` prefixes the message (e.g. "Outlet 2: "). */
function assertPair(bag: Bag, f: { label: string; result: string; reading?: string }, where: string): void {
  const verdict = verdictOf(bag, f.result);
  const reading = readingOf(bag, f.reading);
  if (!f.reading) return; // manual pass/fail test: any verdict (or none) is consistent
  if (reading !== undefined && (verdict === undefined || verdict === "NOT_APPLICABLE")) {
    throw new ConvexError(`${where}The ${f.label} reading has no pass or fail`);
  }
  if (reading === undefined && (verdict === "PASS" || verdict === "FAIL")) {
    throw new ConvexError(`${where}Enter the ${f.label} reading, or mark it N/A`);
  }
}

/** Rule 3: a stated threshold decides the verdict. */
function assertThreshold(verdict: Verdict | undefined, computed: Verdict, label: string, where: string): void {
  if (computed === "NOT_APPLICABLE" || verdict === computed) return;
  throw new ConvexError(`${where}The ${label} reading is a ${computed === "PASS" ? "pass" : "fail"} against the profile's limit`);
}

/**
 * Rules 1–3 for the record's top-level electrical tests. `profileTests` empty (no
 * profile, or a legacy object blob) still enforces rule 1.
 */
export function assertTopLevelReadings(args: Bag, profileTests: ProfileTest[]): void {
  const byKey = new Map(profileTests.map((t) => [t.key, t]));
  for (const f of TEST_FIELDS) {
    assertPair(args, f, "");
    const test = byKey.get(f.key);
    if (!test?.enabled) continue;
    const verdict = verdictOf(args, f.result);
    if (verdict === undefined) throw new ConvexError(`Enter ${f.label}, or mark it N/A`);
    assertThreshold(verdict, evaluateReading(readingOf(args, f.reading), test.threshold, test.operator), f.label, "");
  }
}

/** Rules 1–3 for one sub-test (outlet); returns its DERIVED result. */
export function checkSubTest(
  sub: Bag & { label: string; result?: Verdict },
  enabledKeys: ReadonlySet<string>,
  thresholds: Bag,
): "PASS" | "FAIL" {
  const where = `${sub.label}: `;
  let failed = sub.result === "FAIL";
  for (const f of SUB_FIELDS) {
    assertPair(sub, f, where);
    const verdict = verdictOf(sub, f.result);
    if (enabledKeys.has(f.key) && verdict === undefined) throw new ConvexError(`${where}Enter ${f.label}, or mark it N/A`);
    if (f.threshold) {
      const limit = typeof thresholds[f.threshold] === "number" ? (thresholds[f.threshold] as number) : null;
      // `limit` is already null when unset; a threshold of 0 is a real limit.
      assertThreshold(verdict, evaluateReading(readingOf(sub, f.reading), limit, f.operator), f.label, where);
    }
    if (verdict === "FAIL") failed = true;
  }
  return failed ? "FAIL" : "PASS";
}

const VISUAL_TICKS = [
  "visualCordCondition", "visualPlugCondition", "visualHousingCondition", "visualSwitchCondition",
  "visualVentsUnobstructed", "visualCordGrip", "visualEarthPin", "visualMarkingsLegible", "visualNoModifications",
] as const;

/** The visual verdict: a failed tick fails it, whatever the client claimed. */
export function deriveVisualResult(args: Bag): "PASS" | "FAIL" {
  if (verdictOf(args, "visualInspectionResult") === "FAIL") return "FAIL";
  return VISUAL_TICKS.some((k) => args[k] === false) ? "FAIL" : "PASS";
}

/** Rule 4: the record's overall result, from the verdicts alone. */
export function deriveOverallResult(args: Bag, visual: "PASS" | "FAIL", subResults: ("PASS" | "FAIL")[]): "PASS" | "FAIL" {
  if (visual === "FAIL") return "FAIL";
  if (TEST_FIELDS.some((f) => verdictOf(args, f.result) === "FAIL")) return "FAIL";
  if (verdictOf(args, "functionalTestResult") === "FAIL") return "FAIL";
  return subResults.includes("FAIL") ? "FAIL" : "PASS";
}
