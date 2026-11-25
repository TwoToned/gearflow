import { describe, expect, it } from "vitest";
import { projectTotalsFromEntry } from "./project-snapshot-diff";

describe("projectTotalsFromEntry", () => {
  it("reads subtotal and total off the project entry; the margin is DERIVED from its buckets, ex GST", () => {
    expect(
      projectTotalsFromEntry({
        entityType: "project", entityId: "p1",
        data: { subtotal: 100, total: 110, margin: 999, discountAmount: 0, serviceCostTotal: 30, labourCostTotal: 20, subHireCostTotal: 10, saleCostTotal: 0 },
      }),
    ).toEqual({ subtotal: 100, total: 110, margin: 40 });
  });

  it("a PRE-FIX snapshot (stored margin = total - costs, GST included) shows the corrected ex-GST figure, so the viewer shows no false drop", () => {
    // $10,000 taxable + $1,000 GST, $5,000 costs. Stored (old) margin 6,000; true margin 5,000.
    const preFix = { subtotal: 10000, total: 11000, discountAmount: 0, taxAmount: 1000, serviceCostTotal: 5000, labourCostTotal: 0, subHireCostTotal: 0, saleCostTotal: 0, margin: 6000 };
    const postFix = { ...preFix, margin: 5000 };
    expect(projectTotalsFromEntry({ entityType: "project", entityId: "p", data: preFix })?.margin).toBe(5000);
    expect(projectTotalsFromEntry({ entityType: "project", entityId: "p", data: postFix })?.margin).toBe(5000); // same job, same margin: no delta
  });

  it("a snapshot without the cost buckets shows its margin as ABSENT (no guess, no delta)", () => {
    expect(projectTotalsFromEntry({ entityType: "project", entityId: "p1", data: { subtotal: 100, total: 110, margin: 40 } })?.margin).toBeNull();
  });

  it("a margin the read left out (a caller without job cost) is null — never a $0 the viewer would print", () => {
    expect(projectTotalsFromEntry({ entityType: "project", entityId: "p1", data: { subtotal: 100, total: 110 } })?.margin).toBeNull();
  });

  it("not a project entry: null", () => {
    expect(projectTotalsFromEntry({ entityType: "service", entityId: "s1", data: {} })).toBeNull();
    expect(projectTotalsFromEntry(undefined)).toBeNull();
  });
});
