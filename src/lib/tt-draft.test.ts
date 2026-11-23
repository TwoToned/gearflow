import { describe, expect, it } from "vitest";
import { deriveNextDueDate } from "../../convex/lib/testTagNextDue";
import { assertTopLevelReadings, parseProfileTests } from "../../convex/lib/testTagReadings";
import { formatDateLong } from "@/lib/formatters";
import {
  DEFAULT_FAILURE_ACTION,
  emptyTtDraft,
  makeOutlets,
  nextDueText,
  passAllVisual,
  prefillFromRecord,
  readingVerdict,
  revertPassAllVisual,
  ttBlocker,
  ttDraftDirty,
  ttPayload,
  ttResult,
  type TtDraft,
  type TtProfile,
} from "./tt-draft";

const CLASS_I: TtProfile = {
  id: "p1", name: "Class I appliance",
  visualChecks: [{ key: "cordCondition", label: "Cord", enabled: true }, { key: "plugCondition", label: "Plug", enabled: true }, { key: "earthPin", label: "Earth pin", enabled: false }],
  electricalTests: [
    { key: "earthContinuity", label: "Earth Continuity", threshold: 1, operator: "lt", unit: "Ω", enabled: true },
    { key: "insulationResistance", label: "Insulation Resistance", threshold: 1, operator: "gte", unit: "MΩ", enabled: true },
    { key: "leakageCurrent", label: "Leakage Current", threshold: 5, operator: "lte", unit: "mA", enabled: false },
    { key: "polarity", label: "Polarity", threshold: null, operator: null, unit: "", enabled: true },
  ],
  thresholds: {}, requiresSubTests: false, defaultSubTestCount: 1, subTestLabel: "Outlet",
};
const BOARD: TtProfile = {
  ...CLASS_I, id: "p2", visualChecks: [], requiresSubTests: true, defaultSubTestCount: 2, subTestLabel: "Outlet",
  electricalTests: [{ key: "earthContinuity", label: "Earth Continuity", threshold: 1, operator: "lt", unit: "Ω", enabled: true }],
  thresholds: { earthMax: 1 },
};

function filled(profile = CLASS_I): TtDraft {
  const d = emptyTtDraft("tt1", profile, null);
  return {
    ...d,
    visual: { cordCondition: true, plugCondition: true },
    readings: { earthContinuity: { value: "0.2", na: false }, insulationResistance: { value: "200", na: false } },
    manual: { polarity: "PASS" },
  };
}

describe("tt-draft Pass all (SF5)", () => {
  const THREE: TtProfile = { ...CLASS_I, visualChecks: [...(CLASS_I.visualChecks as object[]), { key: "casing", label: "Casing", enabled: true }] };

  it("ticks every visual check and records only what it changed", () => {
    const d = { ...emptyTtDraft("tt1", THREE, null), visual: { cordCondition: true, casing: false } };
    const { draft, changed } = passAllVisual(d, THREE);
    expect(draft.visual).toEqual({ cordCondition: true, plugCondition: true, casing: true });
    expect(changed).toEqual({ plugCondition: undefined, casing: false });
  });

  it("its Undo restores only the keys it ticked that still read ticked; later answers survive", () => {
    const d = { ...emptyTtDraft("tt1", THREE, null), visual: { casing: false } };
    const { draft, changed } = passAllVisual(d, THREE);
    // Later: Plug failed by hand, a reading typed, a note written.
    const later: TtDraft = {
      ...draft,
      visual: { ...draft.visual, plugCondition: false },
      readings: { earthContinuity: { value: "0.2", na: false } },
      visualNotes: "scuffed",
    };
    const undone = revertPassAllVisual(later, changed);
    expect(undone.visual).toEqual({ plugCondition: false, casing: false }); // cord un-inspected again
    expect(undone.readings).toEqual(later.readings);
    expect(undone.visualNotes).toBe("scuffed");
  });
});

describe("tt-draft", () => {
  it("D51: a blank enabled reading blocks the save; an explicit N/A unblocks it", () => {
    const d = filled();
    const blank = { ...d, readings: { earthContinuity: d.readings.earthContinuity } };
    expect(ttBlocker(blank, CLASS_I)).toBe("Enter insulation resistance, or mark it N/A");
    expect(ttResult(blank, CLASS_I)).toBeNull();
    const na = { ...blank, readings: { ...blank.readings, insulationResistance: { value: "", na: true } } };
    expect(ttBlocker(na, CLASS_I)).toBeNull();
    expect(ttResult(na, CLASS_I)).toBe("PASS");
  });

  it("an unset polarity blocks, and the visual must be finished first", () => {
    const d = filled();
    expect(ttBlocker({ ...d, manual: {} }, CLASS_I)).toBe("Set polarity: pass, fail or N/A");
    expect(ttBlocker({ ...d, visual: { cordCondition: true } }, CLASS_I)).toBe("Finish the visual inspection (1 left)");
    expect(ttBlocker(emptyTtDraft("tt1", CLASS_I, null), CLASS_I)).toBe("Finish the visual inspection (2 left)");
  });

  it("each reading's own verdict comes from its threshold (F5)", () => {
    expect(readingVerdict({ value: "1.5", na: false }, { threshold: 1, operator: "lt" })).toBe("FAIL");
    expect(readingVerdict({ value: "0.5", na: false }, { threshold: 1, operator: "lt" })).toBe("PASS");
    expect(readingVerdict({ value: "", na: true }, { threshold: 1, operator: "lt" })).toBe("NOT_APPLICABLE");
    expect(readingVerdict({ value: "abc", na: false }, { threshold: 1, operator: "lt" })).toBeNull();
    // No threshold: the tester's own word decides.
    expect(readingVerdict({ value: "3", na: false }, { threshold: null, operator: null })).toBeNull();
    expect(readingVerdict({ value: "3", na: false, verdict: "FAIL" }, { threshold: null, operator: null })).toBe("FAIL");
    const p = ttPayload({ ...filled(), readings: { earthContinuity: { value: "1.5", na: false }, insulationResistance: { value: "200", na: false } } }, CLASS_I);
    expect(p).toMatchObject({ earthContinuityResult: "FAIL", earthContinuityReading: 1.5, insulationResult: "PASS", insulationReading: 200, polarityResult: "PASS" });
  });

  it("the payload passes the server's own reading rules (one evaluateReading, D51)", () => {
    const p = ttPayload({ ...filled(), readings: { earthContinuity: { value: "0.2", na: false }, insulationResistance: { value: "", na: true } } }, CLASS_I);
    expect(() => assertTopLevelReadings(p, parseProfileTests(CLASS_I.electricalTests))).not.toThrow();
    expect(p).toMatchObject({ insulationResult: "NOT_APPLICABLE" });
    expect(p).not.toHaveProperty("insulationReading");
    expect(p).not.toHaveProperty("nextDueDate");
    expect(p).not.toHaveProperty("result");
  });

  it("a fail defaults to Removed from service (D53); a pass sends no failure action", () => {
    const d = filled();
    expect(d.failureAction).toBe(DEFAULT_FAILURE_ACTION);
    const failed = { ...d, visual: { ...d.visual, plugCondition: false } };
    expect(ttResult(failed, CLASS_I)).toBe("FAIL");
    expect(ttPayload(failed, CLASS_I)).toMatchObject({ visualInspectionResult: "FAIL", visualPlugCondition: false, failureAction: "REMOVED_FROM_SERVICE" });
    expect(ttPayload(d, CLASS_I)).toMatchObject({ failureAction: "NONE" });
  });

  it("nextDueDate is not a draft key; the displayed date is deriveNextDueDate's", () => {
    expect(Object.keys(emptyTtDraft("tt1", CLASS_I, null))).not.toContain("nextDueDate");
    const at = Date.UTC(2024, 0, 31, 9);
    expect(nextDueText(at, 1, "PASS")).toBe(`Next due ${formatDateLong(new Date(deriveNextDueDate(at, 1)))} · every 1 month`);
    expect(nextDueText(at, null, "FAIL")).toContain("Next due after repair");
  });

  it("outlets: each needs its readings; the count is what is tested; a failing outlet fails the test", () => {
    const d = { ...emptyTtDraft("tt1", BOARD, null), readings: { earthContinuity: { value: "0.2", na: false } } };
    expect(d.outlets.map((o) => o.label)).toEqual(["Outlet 1", "Outlet 2"]);
    expect(ttBlocker(d, BOARD)).toBe("Outlet 1: enter earth continuity, or mark it N/A");
    const ok = { ...d, outlets: d.outlets.map((o, i) => ({ ...o, readings: { earthContinuity: { value: i ? "2.5" : "0.1", na: false } } })) };
    expect(ttResult(ok, BOARD)).toBe("FAIL");
    const p = ttPayload(ok, BOARD);
    expect(p).toMatchObject({ outletCount: 2 });
    expect((p.subTests as Array<{ result: string }>).map((s) => s.result)).toEqual(["PASS", "FAIL"]);
    expect(makeOutlets(3, "Phase").map((o) => o.label)).toEqual(["L1-L2", "L2-L3", "L1-L3"]);
    expect(makeOutlets(99, null)).toHaveLength(50);
  });

  it("quick pass prefills the last record's answers for review and still runs the blockers (F4)", () => {
    const empty = emptyTtDraft("tt1", CLASS_I, null);
    const pre = prefillFromRecord(empty, {
      visualCordCondition: true, visualPlugCondition: true, testMethod: "BOTH",
      earthContinuityResult: "PASS", earthContinuityReading: 0.3, insulationResult: "NOT_APPLICABLE", polarityResult: "PASS",
    }, CLASS_I);
    expect(pre.method).toBe("BOTH");
    expect(pre.readings.earthContinuity).toMatchObject({ value: "0.3" });
    expect(pre.readings.insulationResistance).toMatchObject({ na: true });
    expect(ttBlocker(pre, CLASS_I)).toBeNull();
    // A last record with a blank stays blocked.
    expect(ttBlocker(prefillFromRecord(empty, { visualCordCondition: true, visualPlugCondition: true }, CLASS_I), CLASS_I)).toBe("Enter earth continuity, or mark it N/A");
  });

  it("dirty once anything is answered", () => {
    const d = emptyTtDraft("tt1", CLASS_I, null);
    expect(ttDraftDirty(d)).toBe(false);
    expect(ttDraftDirty({ ...d, visual: { cordCondition: true } })).toBe(true);
  });
});
