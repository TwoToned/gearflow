import { describe, test, expect } from "vitest";
import { formatOrgSnapshot } from "./org-snapshot";

const BASE = {
  totalAssets: 120,
  checkedOutAssets: 30,
  activeProjects: 8,
  activeCrew: 5,
  pendingCrewOffers: 0,
  maintenanceDue: 0,
  modelsDueForService: 0,
  overdueReturns: 0,
  countersReady: true,
};

describe("formatOrgSnapshot", () => {
  test("returns empty string when counters aren't seeded yet — never a wrong-zeros snapshot", () => {
    expect(formatOrgSnapshot({ ...BASE, countersReady: false })).toBe("");
  });

  test("summarizes projects/assets/crew without an attention line when nothing is flagged", () => {
    const out = formatOrgSnapshot(BASE);
    expect(out).toContain("8 active project(s)");
    expect(out).toContain("120 total asset units");
    expect(out).toContain("30 currently checked out");
    expect(out).toContain("5 active crew member(s)");
    expect(out).not.toContain("pending crew offer");
    expect(out).not.toContain("Needs attention");
  });

  test("surfaces overdue returns, maintenance due, and pending crew offers in the attention line", () => {
    const out = formatOrgSnapshot({ ...BASE, overdueReturns: 3, maintenanceDue: 2, modelsDueForService: 1, pendingCrewOffers: 4 });
    expect(out).toContain("4 pending crew offer(s)");
    expect(out).toContain("Needs attention: 3 overdue return(s), 2 maintenance job(s) due, 1 model(s) due for scheduled service.");
  });
});
