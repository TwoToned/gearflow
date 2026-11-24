import { describe, expect, it } from "vitest";
import { projectTotalsFromEntry } from "./project-snapshot-diff";

describe("projectTotalsFromEntry", () => {
  it("reads subtotal, total and margin off the project entry", () => {
    expect(projectTotalsFromEntry({ entityType: "project", entityId: "p1", data: { subtotal: 100, total: 110, margin: 40 } })).toEqual({
      subtotal: 100,
      total: 110,
      margin: 40,
    });
  });

  it("a margin the read left out (below the crew-pay line) is null — never a $0 the viewer would print", () => {
    expect(projectTotalsFromEntry({ entityType: "project", entityId: "p1", data: { subtotal: 100, total: 110 } })?.margin).toBeNull();
  });

  it("not a project entry: null", () => {
    expect(projectTotalsFromEntry({ entityType: "service", entityId: "s1", data: {} })).toBeNull();
    expect(projectTotalsFromEntry(undefined)).toBeNull();
  });
});
