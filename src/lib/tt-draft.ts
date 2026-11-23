/**
 * The Scan page's Test & tag draft (Phase 16, spec §9i.2; replaces the quick-test
 * wizard's reducer). Pure: one test as the tester is answering it, what still stops the
 * save in plain words (D51), the result it adds up to, and what `recordTest` sends.
 *
 * Three rules the server also enforces (`convex/testTagRecordsWrites.createNative`):
 *  - **D51 — blank is not N/A.** Every enabled test needs an answer: a reading (or a
 *    pass/fail word) or an explicit N/A. A blank blocks the save.
 *  - **D52 — next due is derived**, never typed: `deriveNextDueDate` (the one shared
 *    function) is only DISPLAYED here; there is no `nextDueDate` in the draft.
 *  - **Each reading carries its OWN verdict** (F5): the threshold decides it, through
 *    the one shared `evaluateReading`.
 * D53: a fail defaults to `Removed from service`.
 */
import { evaluateReading, TEST_FIELDS } from "../../convex/lib/testTagReadings";
import { deriveNextDueDate } from "../../convex/lib/testTagNextDue";
import { formatDateLong } from "@/lib/formatters";

export type Verdict = "PASS" | "FAIL" | "NOT_APPLICABLE";
type Operator = "lt" | "lte" | "gt" | "gte";
export type TestMethod = "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH";
export type FailureAction = "NONE" | "REPAIRED" | "REMOVED_FROM_SERVICE" | "DISPOSED" | "REFERRED_TO_ELECTRICIAN";

/** D53: what a fail does unless the tester picks otherwise. */
export const DEFAULT_FAILURE_ACTION: FailureAction = "REMOVED_FROM_SERVICE";

export const FAILURE_ACTION_LABELS: Record<FailureAction, string> = {
  REMOVED_FROM_SERVICE: "Removed from service",
  REFERRED_TO_ELECTRICIAN: "Referred to electrician",
  DISPOSED: "Disposed / retired",
  REPAIRED: "Repaired on the spot",
  NONE: "No action",
};

export const METHOD_LABELS: Record<TestMethod, string> = {
  INSULATION_RESISTANCE: "Insulation resistance",
  LEAKAGE_CURRENT: "Leakage current",
  BOTH: "Both",
};

/** One reading: the typed value, or an explicit N/A; `verdict` only where no threshold decides it. */
export interface Reading {
  value: string;
  na: boolean;
  verdict?: "PASS" | "FAIL";
}
const BLANK: Reading = { value: "", na: false };

export interface OutletDraft {
  label: string;
  readings: Partial<Record<SubKey, Reading>>;
  polarity: Verdict | null;
  notes: string;
}

export interface TtDraft {
  /** The register item the answers belong to; another item's draft reads as empty. */
  forTtId: string | null;
  /** Per visual check: true = OK, false = failed, absent = not inspected yet. */
  visual: Record<string, boolean>;
  visualNotes: string;
  method: TestMethod;
  readings: Record<string, Reading>;
  /** The pass/fail/N/A-only tests (polarity, RCD push-button). */
  manual: Record<string, Verdict>;
  insulationVoltage: string;
  outlets: OutletDraft[];
  failureAction: FailureAction;
  failureNotes: string;
}

// ─── The profile, read defensively (`testProfiles` blobs are `v.any()`) ────────

export interface TtProfile {
  id: string;
  name: string;
  visualChecks: unknown;
  electricalTests: unknown;
  thresholds: unknown;
  requiresSubTests: boolean;
  defaultSubTestCount: number | null;
  subTestLabel: string | null;
}

export interface VisualItem {
  key: string;
  label: string;
}

export interface TestRow {
  key: string;
  label: string;
  unit: string;
  threshold: number | null;
  operator: Operator | null;
  /** Has a reading (else it is a pass / fail / N/A word only). */
  numeric: boolean;
}

type Bag = Record<string, unknown>;
const asOperator = (o: unknown): Operator | null => (o === "lt" || o === "lte" || o === "gt" || o === "gte" ? o : null);
const rows = (raw: unknown): Bag[] => (Array.isArray(raw) ? raw.filter((r): r is Bag => !!r && typeof r === "object") : []);

export function visualItems(profile: TtProfile | null): VisualItem[] {
  return rows(profile?.visualChecks)
    .filter((c) => c.enabled !== false && typeof c.key === "string")
    .map((c) => ({ key: c.key as string, label: typeof c.label === "string" ? c.label : (c.key as string) }));
}

const NUMERIC_KEYS = new Set(TEST_FIELDS.filter((f) => f.reading).map((f) => f.key));
const KNOWN_KEYS = new Set(TEST_FIELDS.map((f) => f.key));

/** The profile's ENABLED electrical tests the record can store. */
export function testRows(profile: TtProfile | null): TestRow[] {
  return rows(profile?.electricalTests)
    .filter((t) => t.enabled === true && typeof t.key === "string" && KNOWN_KEYS.has(t.key as string))
    .map((t) => ({
      key: t.key as string,
      label: typeof t.label === "string" ? t.label : (t.key as string),
      unit: typeof t.unit === "string" ? t.unit : "",
      threshold: typeof t.threshold === "number" ? t.threshold : null,
      operator: asOperator(t.operator),
      numeric: NUMERIC_KEYS.has(t.key as string),
    }));
}

// ─── Outlets (sub-test profiles) ──────────────────────────────────────────────

const SUB_KEYS = ["earthContinuity", "insulationResistance", "leakageCurrent"] as const;
export type SubKey = (typeof SUB_KEYS)[number];
/** The `testProfiles.thresholds` key + operator each outlet reading is judged by (the server's SUB_FIELDS). */
const SUB_LIMITS: Record<SubKey, { limit: string; operator: Operator }> = {
  earthContinuity: { limit: "earthMax", operator: "lt" },
  insulationResistance: { limit: "insulationMin", operator: "gte" },
  leakageCurrent: { limit: "leakageMax", operator: "lte" },
};

export interface OutletColumns {
  readings: TestRow[];
  polarity: boolean;
}

/** Which outlet columns apply: the enabled tests that an outlet records. */
export function outletColumns(profile: TtProfile | null): OutletColumns | null {
  if (!profile?.requiresSubTests) return null;
  const enabled = testRows(profile);
  const thresholds = (profile.thresholds && typeof profile.thresholds === "object" ? profile.thresholds : {}) as Bag;
  const readings = enabled
    .filter((t): t is TestRow & { key: SubKey } => (SUB_KEYS as readonly string[]).includes(t.key))
    .map((t) => {
      const lim = thresholds[SUB_LIMITS[t.key].limit];
      return { ...t, threshold: typeof lim === "number" ? lim : null, operator: SUB_LIMITS[t.key].operator };
    });
  return { readings, polarity: enabled.some((t) => t.key === "polarity") };
}

function outletLabel(base: string, i: number): string {
  return base === "Phase" ? (["L1-L2", "L2-L3", "L1-L3"][i] ?? `Phase ${i + 1}`) : `${base} ${i + 1}`;
}

/** `count` blank outlets, labelled from the profile (`Outlet 1`…, phases `L1-L2`…). */
export function makeOutlets(count: number, base: string | null): OutletDraft[] {
  const n = Math.max(1, Math.min(50, Math.round(count)));
  return Array.from({ length: n }, (_, i) => ({ label: outletLabel(base ?? "Outlet", i), readings: {}, polarity: null, notes: "" }));
}

// ─── The draft ────────────────────────────────────────────────────────────────

export function emptyTtDraft(ttId: string | null, profile: TtProfile | null, outletCount: number | null): TtDraft {
  const outlets = profile?.requiresSubTests ? makeOutlets(outletCount ?? profile.defaultSubTestCount ?? 1, profile.subTestLabel) : [];
  return {
    forTtId: ttId, visual: {}, visualNotes: "", method: "INSULATION_RESISTANCE", readings: {}, manual: {},
    insulationVoltage: "", outlets, failureAction: DEFAULT_FAILURE_ACTION, failureNotes: "",
  };
}

/** What Pass all changed: each visual key it ticked, with the value it had before (absent = not inspected). */
export type VisualPassAll = Record<string, boolean | undefined>;

/** Tick every visual check, and record what that changed so its Undo can reverse only that. */
export function passAllVisual(d: TtDraft, profile: TtProfile | null): { draft: TtDraft; changed: VisualPassAll } {
  const visual = { ...d.visual };
  const changed: VisualPassAll = {};
  for (const { key } of visualItems(profile)) {
    if (visual[key] === true) continue;
    changed[key] = visual[key];
    visual[key] = true;
  }
  return { draft: { ...d, visual }, changed };
}

/**
 * Pass all's exact reverse (review SF5): each key it ticked goes back to what it was,
 * but only while it still reads ticked. A tick, fail or note given since survives.
 */
export function revertPassAllVisual(d: TtDraft, changed: VisualPassAll): TtDraft {
  const visual = { ...d.visual };
  for (const [key, before] of Object.entries(changed)) {
    if (visual[key] !== true) continue;
    if (before === undefined) delete visual[key];
    else visual[key] = before;
  }
  return { ...d, visual };
}

/** A draft holds answers once anything was ticked, typed or picked. */
export function ttDraftDirty(d: TtDraft): boolean {
  const outletAnswered = d.outlets.some((o) => o.polarity !== null || o.notes !== "" || Object.keys(o.readings).length > 0);
  return Object.keys(d.visual).length > 0 || Object.keys(d.readings).length > 0 || Object.keys(d.manual).length > 0 || outletAnswered || d.visualNotes !== "";
}

/** A reading's verdict: N/A, the threshold's, the tester's word where no threshold applies, or null (blank). */
export function readingVerdict(r: Reading | undefined, row: Pick<TestRow, "threshold" | "operator">): Verdict | null {
  if (!r) return null;
  if (r.na) return "NOT_APPLICABLE";
  const num = parseFloat(r.value);
  if (r.value.trim() === "" || isNaN(num)) return null;
  const computed = evaluateReading(num, row.threshold, row.operator);
  return computed === "NOT_APPLICABLE" ? (r.verdict ?? null) : computed;
}

function rowVerdict(d: TtDraft, row: TestRow): Verdict | null {
  return row.numeric ? readingVerdict(d.readings[row.key], row) : (d.manual[row.key] ?? null);
}

function rowBlocker(d: TtDraft, row: TestRow): string | null {
  if (rowVerdict(d, row)) return null;
  const label = row.label.toLowerCase();
  if (!row.numeric) return `Set ${label}: pass, fail or N/A`;
  return (d.readings[row.key]?.value ?? "").trim() ? `Mark ${label} pass or fail` : `Enter ${label}, or mark it N/A`;
}

function outletBlocker(o: OutletDraft, cols: OutletColumns): string | null {
  for (const row of cols.readings) {
    if (!readingVerdict(o.readings[row.key as SubKey], row)) return `${o.label}: enter ${row.label.toLowerCase()}, or mark it N/A`;
  }
  return cols.polarity && !o.polarity ? `${o.label}: set polarity` : null;
}

/** The first thing stopping the save, in plain words; `null` when it can be saved. */
export function ttBlocker(d: TtDraft, profile: TtProfile | null): string | null {
  const left = visualItems(profile).filter((v) => d.visual[v.key] === undefined).length;
  if (left > 0) return `Finish the visual inspection (${left} left)`;
  for (const row of testRows(profile)) {
    const why = rowBlocker(d, row);
    if (why) return why;
  }
  const cols = outletColumns(profile);
  if (!cols) return null;
  if (d.outlets.length === 0) return "Add at least one outlet";
  for (const o of d.outlets) {
    const why = outletBlocker(o, cols);
    if (why) return why;
  }
  return null;
}

function outletFailed(o: OutletDraft, cols: OutletColumns): boolean {
  return o.polarity === "FAIL" || cols.readings.some((row) => readingVerdict(o.readings[row.key as SubKey], row) === "FAIL");
}

/** `Pass` / `Fail`, or `null` while it is not finished. The server derives the same. */
export function ttResult(d: TtDraft, profile: TtProfile | null): "PASS" | "FAIL" | null {
  if (ttBlocker(d, profile)) return null;
  if (Object.values(d.visual).some((ok) => ok === false)) return "FAIL";
  if (testRows(profile).some((row) => rowVerdict(d, row) === "FAIL")) return "FAIL";
  const cols = outletColumns(profile);
  return cols && d.outlets.some((o) => outletFailed(o, cols)) ? "FAIL" : "PASS";
}

/** What failed, in words, one per line (plus the failure notes) — a maintenance job's prefill. */
export function ttFailureReason(d: TtDraft, profile: TtProfile | null): string {
  const visual = visualItems(profile).filter((v) => d.visual[v.key] === false).map((v) => `Visual: ${v.label}`);
  const tests = testRows(profile).filter((row) => rowVerdict(d, row) === "FAIL").map((row) => `${row.label}: fail`);
  const cols = outletColumns(profile);
  const outlets = cols ? d.outlets.filter((o) => outletFailed(o, cols)).map((o) => `${o.label}: fail`) : [];
  return [...visual, ...tests, ...outlets, d.failureNotes.trim()].filter(Boolean).join("\n");
}

/** `Next due 21 Feb 2027 · every 3 months` — displayed only; the server derives the stored date (D52). */
export function nextDueText(testDate: number, intervalMonths: number | null, result: "PASS" | "FAIL" | null): string {
  const months = intervalMonths && intervalMonths > 0 ? intervalMonths : 3;
  const due = formatDateLong(new Date(deriveNextDueDate(testDate, months)));
  return result === "FAIL" ? `Next due after repair · ${due}` : `Next due ${due} · every ${months} month${months === 1 ? "" : "s"}`;
}

// ─── What the save sends ──────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const VISUAL_COLUMNS = new Set([
  "cordCondition", "plugCondition", "housingCondition", "switchCondition", "ventsUnobstructed",
  "cordGrip", "earthPin", "markingsLegible", "noModifications",
]);

function topLevelFields(d: TtDraft, profile: TtProfile | null): Bag {
  const out: Bag = {};
  for (const row of testRows(profile)) {
    const f = TEST_FIELDS.find((x) => x.key === row.key)!;
    const verdict = rowVerdict(d, row);
    if (!verdict) continue;
    out[f.result] = verdict;
    if (f.reading && verdict !== "NOT_APPLICABLE") out[f.reading] = parseFloat(d.readings[row.key]!.value);
  }
  const volts = parseFloat(d.insulationVoltage);
  if (!isNaN(volts)) out.insulationTestVoltage = volts;
  return out;
}

const SUB_FIELDS: Record<SubKey, { result: string; reading: string }> = {
  earthContinuity: { result: "earthContinuityResult", reading: "earthContinuityReading" },
  insulationResistance: { result: "insulationResult", reading: "insulationReading" },
  leakageCurrent: { result: "leakageCurrentResult", reading: "leakageCurrentReading" },
};

function outletPayload(o: OutletDraft, i: number, cols: OutletColumns): Bag {
  const out: Bag = { label: o.label, sortOrder: i, result: outletFailed(o, cols) ? "FAIL" : "PASS" };
  for (const row of cols.readings) {
    const key = row.key as SubKey;
    const verdict = readingVerdict(o.readings[key], row);
    if (!verdict) continue;
    out[SUB_FIELDS[key].result] = verdict;
    if (verdict !== "NOT_APPLICABLE") out[SUB_FIELDS[key].reading] = parseFloat(o.readings[key]!.value);
  }
  if (cols.polarity && o.polarity) out.polarityResult = o.polarity;
  if (o.notes.trim()) out.notes = o.notes.trim();
  return out;
}

/** The `recordTest` fields for this draft (the caller adds ids, the tester and the date). */
export function ttPayload(d: TtDraft, profile: TtProfile | null): Bag {
  const visualFail = Object.values(d.visual).some((ok) => ok === false);
  const visual: Bag = {};
  for (const [key, ok] of Object.entries(d.visual)) if (VISUAL_COLUMNS.has(key)) visual[`visual${cap(key)}`] = ok;
  const cols = outletColumns(profile);
  const subTests = cols ? d.outlets.map((o, i) => outletPayload(o, i, cols)) : [];
  const failed = ttResult(d, profile) === "FAIL";
  return {
    visualInspectionResult: visualFail ? "FAIL" : "PASS",
    ...visual,
    ...(d.visualNotes.trim() ? { visualNotes: d.visualNotes.trim() } : {}),
    testMethod: d.method,
    ...topLevelFields(d, profile),
    ...(subTests.length > 0 ? { subTests, outletCount: subTests.length } : {}),
    failureAction: failed ? d.failureAction : "NONE",
    ...(failed && d.failureNotes.trim() ? { failureNotes: d.failureNotes.trim() } : {}),
  };
}

// ─── Quick pass: repeat the last test, for review (fixes F4) ─────────────────

/** The draft prefilled from the item's last record. It still runs every blocker. */
export function prefillFromRecord(d: TtDraft, record: Bag, profile: TtProfile | null): TtDraft {
  const visual: Record<string, boolean> = {};
  for (const v of visualItems(profile)) {
    const stored = record[`visual${cap(v.key)}`];
    if (typeof stored === "boolean") visual[v.key] = stored;
  }
  const readings: Record<string, Reading> = {};
  const manual: Record<string, Verdict> = {};
  for (const row of testRows(profile)) {
    const f = TEST_FIELDS.find((x) => x.key === row.key)!;
    const verdict = record[f.result] as Verdict | undefined;
    if (!row.numeric) {
      if (verdict) manual[row.key] = verdict;
      continue;
    }
    const reading = storedReading(verdict, f.reading ? record[f.reading] : undefined);
    if (reading) readings[row.key] = reading;
  }
  const method = record.testMethod as TestMethod | undefined;
  return { ...d, visual, readings, manual, method: method ?? d.method };
}

/** A stored numeric reading back as the draft's `{ value, na }`; null when it was blank. */
function storedReading(verdict: Verdict | undefined, value: unknown): Reading | null {
  if (verdict === "NOT_APPLICABLE") return { ...BLANK, na: true };
  if (typeof value !== "number") return null;
  return { value: String(value), na: false, ...(verdict === "PASS" || verdict === "FAIL" ? { verdict } : {}) };
}
