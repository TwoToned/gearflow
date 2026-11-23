import { describe, expect, it } from "vitest";
import {
  checkBlocker,
  checkFailCount,
  checksComplete,
  checksPayload,
  checkStatesDirty,
  initialCheckStates,
  measurementAutoResult,
  passAllStates,
  passAllTargets,
  revertPassAll,
  type CheckItemData,
  type CheckItemType,
  type CheckStates,
} from "./check-item-state";

function item(id: string, label: string, type: CheckItemType): CheckItemData {
  return {
    id: "a-" + id,
    sortOrder: 0,
    checkItem: {
      id,
      label,
      description: null,
      type,
      category: null,
      measurementUnit: null,
      measurementMin: null,
      measurementMax: null,
      dropdownOptions: null,
    },
  };
}

const items = [item("power", "Power on", "PASS_FAIL"), item("notes", "Notes", "NOTES"), item("yoke", "Yoke", "PASS_FAIL")];

describe("check-item-state", () => {
  it("starts blank and clean, and an empty list is never savable", () => {
    const s = initialCheckStates(items);
    expect(checkStatesDirty(s)).toBe(false);
    expect(checkBlocker([], {})).toBe("This model has no check items");
    expect(checkBlocker(items, s)).toBe("Answer Power on");
  });

  it("Pass all answers only the unanswered pass/fail items", () => {
    const s = initialCheckStates(items);
    s.yoke = { ...s.yoke, result: "FAIL" };
    const next = passAllStates(items, s);
    expect(next.power.result).toBe("PASS");
    expect(next.yoke.result).toBe("FAIL");
    expect(next.notes.result).toBeNull();
    expect(checkFailCount(next)).toBe(1);
  });

  it("Pass all's Undo reverts only what it set, only where it still holds (SF5)", () => {
    const three = [...items, item("lens", "Lens", "PASS_FAIL")];
    const s = initialCheckStates(three);
    s.yoke = { ...s.yoke, result: "FAIL", notes: "slips" };
    const ids = passAllTargets(three, s);
    expect(ids).toEqual(["power", "lens"]);
    const passed = passAllStates(three, s);
    // Later: Lens failed with a note and a photo; Power got a note but stays Pass.
    const later: CheckStates = {
      ...passed,
      lens: { ...passed.lens, result: "FAIL" as const, notes: "cracked", photos: ["/api/files/p1"] },
      power: { ...passed.power, notes: "warm" },
    };
    const undone = revertPassAll(later, ids);
    expect(undone.power).toEqual({ ...later.power, result: null }); // its note survives
    expect(undone.lens).toEqual(later.lens); // answered since: untouched
    expect(undone.yoke).toEqual(later.yoke); // never Pass all's
  });

  it("a FAIL needs a reason and a photo, named in plain words", () => {
    const s = passAllStates(items, initialCheckStates(items));
    s.yoke = { ...s.yoke, result: "FAIL" };
    expect(checkBlocker(items, s)).toBe("Yoke needs a reason and a photo");
    s.yoke = { ...s.yoke, notes: "Cracked" };
    expect(checkBlocker(items, s)).toBe("Yoke needs a photo");
    s.yoke = { ...s.yoke, notes: "", photos: ["p"] };
    expect(checkBlocker(items, s)).toBe("Yoke needs a reason");
    s.yoke = { ...s.yoke, notes: "Cracked", photos: ["p"] };
    expect(checksComplete(items, s)).toBe(true);
    expect(checkBlocker(items, s, true)).toBe("Wait for the photo to finish uploading");
  });

  it("submits one row per item, an unanswered notes item as NOTES_ONLY", () => {
    const s = passAllStates(items, initialCheckStates(items));
    expect(checksPayload(items, s).map((c) => [c.checkItemId, c.result])).toEqual([
      ["power", "PASS"],
      ["notes", "NOTES_ONLY"],
      ["yoke", "PASS"],
    ]);
    expect(checkStatesDirty(s)).toBe(true);
  });

  it("a measurement is judged against its limits once it is a number", () => {
    expect(measurementAutoResult("", 1, 2)).toBeNull();
    expect(measurementAutoResult("0.5", 1, 2)).toBe("FAIL");
    expect(measurementAutoResult("3", 1, 2)).toBe("FAIL");
    expect(measurementAutoResult("1.5", 1, 2)).toBe("PASS");
    expect(measurementAutoResult("9", null, null)).toBe("PASS");
  });
});
