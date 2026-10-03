import { describe, test, expect } from "vitest";
import {
  WORK_ITEM_STATUSES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_KINDS,
  WORK_STAGES,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS,
  WORK_ITEM_KIND_LABELS,
  WORK_STAGE_LABELS,
  defaultStageForProjectStatus,
} from "./workVocabulary";

describe("workVocabulary", () => {
  test("every status/priority/kind/stage has a display label and vice versa", () => {
    expect(Object.keys(WORK_ITEM_STATUS_LABELS).sort()).toEqual([...WORK_ITEM_STATUSES].sort());
    expect(Object.keys(WORK_ITEM_PRIORITY_LABELS).sort()).toEqual([...WORK_ITEM_PRIORITIES].sort());
    expect(Object.keys(WORK_ITEM_KIND_LABELS).sort()).toEqual([...WORK_ITEM_KINDS].sort());
    expect(Object.keys(WORK_STAGE_LABELS).sort()).toEqual([...WORK_STAGES].sort());
  });

  test("status gains CANCELLED", () => {
    expect(WORK_ITEM_STATUSES).toContain("CANCELLED");
  });

  describe("defaultStageForProjectStatus", () => {
    test("maps each pre-money-phase status per design §10.1's table", () => {
      expect(defaultStageForProjectStatus("ENQUIRY")).toBe("quote");
      expect(defaultStageForProjectStatus("QUOTING")).toBe("quote");
      expect(defaultStageForProjectStatus("QUOTED")).toBe("quote");
      expect(defaultStageForProjectStatus("CONFIRMED")).toBe("prep");
      expect(defaultStageForProjectStatus("PREPPING")).toBe("prep");
      expect(defaultStageForProjectStatus("CHECKED_OUT")).toBe("load_in");
      expect(defaultStageForProjectStatus("ON_SITE")).toBe("show");
      expect(defaultStageForProjectStatus("RETURNED")).toBe("return");
      expect(defaultStageForProjectStatus("COMPLETED")).toBe("close");
      expect(defaultStageForProjectStatus("INVOICED")).toBe("close");
    });

    test("AWAITING_PAYMENT stays in 'quote' — the job isn't ours to prep until it's paid (#1236)", () => {
      expect(defaultStageForProjectStatus("AWAITING_PAYMENT")).toBe("quote");
    });

    test("CANCELLED and any unknown status return undefined — keep the existing stage", () => {
      expect(defaultStageForProjectStatus("CANCELLED")).toBeUndefined();
      expect(defaultStageForProjectStatus("SOMETHING_NEW")).toBeUndefined();
    });
  });
});
