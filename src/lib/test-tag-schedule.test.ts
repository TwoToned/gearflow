import { describe, expect, it } from "vitest";
import { planTestSchedule, testScheduleTitle, testScheduleToast } from "@/lib/test-tag-schedule";

const A = { id: "i1", testTagId: "TT-1", assetId: "a1" };
const B = { id: "i2", testTagId: "TT-2", assetId: null };
const C = { id: "i3", testTagId: "TT-3", assetId: "a1" };

describe("planTestSchedule", () => {
  it("books the linked assets once each and NAMES an item with no linked asset", () => {
    expect(planTestSchedule([A, B, C])).toEqual({ assetIds: ["a1"], skipped: [{ name: "TT-2", why: "no linked asset" }] });
  });
  it("names a retired item as skipped with its reason, even when it has a linked asset", () => {
    expect(planTestSchedule([{ ...A, retired: true }, C])).toEqual({ assetIds: ["a1"], skipped: [{ name: "TT-1", why: "retired" }] });
    expect(planTestSchedule([{ ...A, retired: true }]).assetIds).toEqual([]);
  });
  it("has nothing to book when no item is linked", () => {
    expect(planTestSchedule([B]).assetIds).toEqual([]);
  });
});

describe("words", () => {
  it("titles the job by its tag, or by count", () => {
    expect(testScheduleTitle([A])).toBe("Test & tag: TT-1");
    expect(testScheduleTitle([A, B])).toBe("Test & tag: 2 items");
  });
  it("names what was skipped in the toast", () => {
    expect(testScheduleToast(1, [{ name: "TT-2", why: "no linked asset" }])).toBe("Scheduled testing for 1 asset · skipped TT-2: no linked asset");
    expect(testScheduleToast(2, [])).toBe("Scheduled testing for 2 assets");
  });
});
