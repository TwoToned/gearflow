import { describe, test, expect } from "vitest";
import { formatMiraAnswer } from "./format-answer";

describe("formatMiraAnswer", () => {
  test("summarizes a project bundle", () => {
    const answer = formatMiraAnswer("projectDetail.bundle", {
      project: { name: "Big Gig", projectNumber: "P-042", status: "CONFIRMED" },
    });
    expect(answer).toBe("Big Gig (P-042) is currently CONFIRMED.");
  });

  test("handles a null project (not found / wrong org)", () => {
    expect(formatMiraAnswer("projectDetail.bundle", null)).toMatch(/couldn't find/i);
  });

  test("counts assets, singular vs plural", () => {
    expect(formatMiraAnswer("assets.list", [{ id: "a1" }])).toBe("Your org has 1 asset on file.");
    expect(formatMiraAnswer("assets.list", [{ id: "a1" }, { id: "a2" }])).toBe("Your org has 2 assets on file.");
    expect(formatMiraAnswer("assets.list", [])).toBe("Your org has 0 assets on file.");
  });

  test("falls back to a generic sentence for an unrecognised operation", () => {
    expect(formatMiraAnswer("some.other.op", { anything: true })).toBe("Here's what I found.");
  });
});
