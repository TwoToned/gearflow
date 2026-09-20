import { describe, it, expect } from "vitest";
import { describeWorkDestination } from "./work-destination";

describe("describeWorkDestination", () => {
  it("names your own list and the due preset on a personal item", () => {
    expect(
      describeWorkDestination({ hasProject: false, ownerKind: "user", isMe: true, ownerName: "Ada", dueLabel: "Today" }),
    ).toEqual({ text: "Lands in your work list · today", blocked: false });
  });

  it("names someone else by name when it is not you", () => {
    const d = describeWorkDestination({
      hasProject: false, ownerKind: "user", isMe: false, ownerName: "Ben R.", dueLabel: "Tomorrow",
    });
    expect(d.text).toBe("Lands in Ben R.’s work list · tomorrow");
    expect(d.blocked).toBe(false);
  });

  it("names the job's list, not a person, for unowned project work", () => {
    const d = describeWorkDestination({
      hasProject: true, ownerKind: "nobody", isMe: false, ownerName: "", stageLabel: "Prep",
    });
    expect(d.text).toBe("Lands in this job's work list · Prep");
    expect(d.blocked).toBe(false);
  });

  it("says 'no stage' rather than going blank when a project item has none", () => {
    const d = describeWorkDestination({
      hasProject: true, ownerKind: "user", isMe: true, ownerName: "Ada", stageLabel: null,
    });
    expect(d.text).toBe("Lands in your work list · no stage");
  });

  // The one combination the product must not be able to produce: no reader
  // would ever return this row.
  it("blocks the nowhere case and says why", () => {
    const d = describeWorkDestination({ hasProject: false, ownerKind: "nobody", isMe: false, ownerName: "" });
    expect(d.blocked).toBe(true);
    expect(d.text).toMatch(/land nowhere/);
  });

  it("is not blocked by an unowned item that has a job to sit on", () => {
    expect(
      describeWorkDestination({ hasProject: true, ownerKind: "nobody", isMe: false, ownerName: "", stageLabel: "Prep" })
        .blocked,
    ).toBe(false);
  });

  it("names the stage AND the date when a job's work carries both", () => {
    const d = describeWorkDestination({
      hasProject: true, ownerKind: "user", isMe: true, ownerName: "Ada", stageLabel: "Prep", dueLabel: "12 Oct",
    });
    expect(d.text).toBe("Lands in your work list \u00b7 Prep \u00b7 due 12 oct");
  });

  // The date chip defaults to "No date" on a job, so saying it would be on
  // every line the composer ever draws there.
  it("leaves an undated job item saying only its stage", () => {
    const d = describeWorkDestination({
      hasProject: true, ownerKind: "nobody", isMe: false, ownerName: "", stageLabel: "Prep", dueLabel: "No date",
    });
    expect(d.text).toBe("Lands in this job's work list \u00b7 Prep");
  });

  it("treats a crew owner as an owner", () => {
    const d = describeWorkDestination({
      hasProject: false, ownerKind: "crew", isMe: false, ownerName: "Cara Crew", dueLabel: "No date",
    });
    expect(d).toEqual({ text: "Lands in Cara Crew’s work list · no date", blocked: false });
  });
});
