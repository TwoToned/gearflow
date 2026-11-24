// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/org-context", () => ({ getCurrentRole: vi.fn(async () => "member") }));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => null) }));

import { crewCostSortAllowed, withoutProjectCrewCost } from "./crew-pay-caller";

describe("withoutProjectCrewCost", () => {
  const row = { id: "p1", total: 5000, serviceCostTotal: 650, labourCostTotal: 300, margin: 4050, subHireCostTotal: 10 };

  it("below the pay line the crew-cost totals and margin are ABSENT (not zero); everything else stays", () => {
    const out = withoutProjectCrewCost(row, false) as Record<string, unknown>;
    expect(out).toEqual({ id: "p1", total: 5000, subHireCostTotal: 10 });
    for (const f of ["serviceCostTotal", "labourCostTotal", "margin"]) expect(out, f).not.toHaveProperty(f);
    expect(row.margin).toBe(4050); // the input is not mutated
  });

  it("with crew pay the row is returned as is", () => {
    expect(withoutProjectCrewCost(row, true)).toBe(row);
  });
});

describe("crewCostSortAllowed", () => {
  it("a crew-cost field is not a sort key below the pay line; any other field is", () => {
    for (const f of ["serviceCostTotal", "labourCostTotal", "margin"]) {
      expect(crewCostSortAllowed(f, false), f).toBe(false);
      expect(crewCostSortAllowed(f, true), f).toBe(true);
    }
    expect(crewCostSortAllowed("createdAt", false)).toBe(true);
    expect(crewCostSortAllowed("total", false)).toBe(true);
  });
});
