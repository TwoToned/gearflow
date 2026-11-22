import { describe, it, expect } from "vitest";
import { ALL_PROJECT_STATUSES, nextStage, progressFor, projectStatusLabel, stageIndexForStatus } from "./job-lifecycle";

describe("job lifecycle", () => {
  it("places every pipeline status on exactly one of the eight stages", () => {
    for (const s of ALL_PROJECT_STATUSES) {
      const i = stageIndexForStatus(s);
      if (s === "CANCELLED") expect(i).toBe(-1);
      else expect(i).toBeGreaterThanOrEqual(0);
    }
    expect(progressFor("ENQUIRY")?.steps).toHaveLength(8);
  });

  it("Advance moves into the next stage's entry status", () => {
    expect(nextStage("ENQUIRY")).toEqual({ label: "Quote", status: "QUOTING" });
    expect(nextStage("QUOTED")).toEqual({ label: "Awaiting payment", status: "AWAITING_PAYMENT" });
    expect(nextStage("AWAITING_PAYMENT")).toEqual({ label: "Confirmed", status: "CONFIRMED" });
    expect(nextStage("PREPPING")).toEqual({ label: "On site", status: "CHECKED_OUT" });
    expect(nextStage("ON_SITE")).toEqual({ label: "Return", status: "RETURNED" });
  });

  it("has no next stage at the end of the pipeline or off it", () => {
    expect(nextStage("COMPLETED")).toBeNull();
    expect(nextStage("INVOICED")).toBeNull();
    expect(nextStage("CANCELLED")).toBeNull();
    expect(nextStage("NOT_A_STATUS")).toBeNull();
  });

  it("shows a sub-label only on a two-status stage", () => {
    expect(progressFor("QUOTED")).toMatchObject({ currentIndex: 1, subLabel: "quoted" });
    expect(progressFor("QUOTING")?.subLabel).toBe("quoting");
    expect(progressFor("CHECKED_OUT")?.subLabel).toBe("out");
    expect(progressFor("CONFIRMED")?.subLabel).toBeUndefined();
    expect(progressFor("CANCELLED")).toBeNull();
  });

  it("spells Awaiting payment from the shared map (the page-local map missed it)", () => {
    expect(projectStatusLabel("AWAITING_PAYMENT")).toBe("Awaiting payment");
    expect(projectStatusLabel("CHECKED_OUT")).toBe("Out");
  });
});
