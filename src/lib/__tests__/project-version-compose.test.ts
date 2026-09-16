// Project Versioning v2, Phase 5 (#1231, parent #1221, design §5 D32) — the
// composed-object overlay. Pure function, no jsdom needed.
import { describe, it, expect } from "vitest";
import { composeProjectWithVersion } from "@/lib/project-version-compose";

describe("composeProjectWithVersion", () => {
  it("returns the project unchanged when no viewing plan fields are given (live)", () => {
    const project = { id: "p1", rentalStartDate: "2026-07-01", discountPercent: 10 };
    expect(composeProjectWithVersion(project, null)).toBe(project);
    expect(composeProjectWithVersion(project, undefined)).toBe(project);
  });

  it("overlays the viewed version's plan fields onto a copy of the live project", () => {
    const project = { id: "p1", name: "Big gig", rentalStartDate: "2026-07-01", discountPercent: 10 };
    const composed = composeProjectWithVersion(project, { rentalStartDate: "2026-06-15", discountPercent: 5 });
    expect(composed).toEqual({ id: "p1", name: "Big gig", rentalStartDate: "2026-06-15", discountPercent: 5 });
    // Never mutates the original live project.
    expect(project.rentalStartDate).toBe("2026-07-01");
  });

  it("an explicit undefined in the overlay CLEARS the live field (pickPlanFields' own convention)", () => {
    const project = { id: "p1", clientNotes: "call before arrival" };
    const composed = composeProjectWithVersion(project, { clientNotes: undefined });
    expect(composed.clientNotes).toBeUndefined();
  });

  it("leaves fields the overlay never mentions untouched (non-plan fields stay live)", () => {
    const project = { id: "p1", status: "CONFIRMED", subtotal: 500, rentalStartDate: "2026-07-01" };
    const composed = composeProjectWithVersion(project, { rentalStartDate: "2026-06-15" });
    expect(composed.status).toBe("CONFIRMED");
    expect(composed.subtotal).toBe(500);
  });
});
