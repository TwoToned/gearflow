import { describe, it, expect } from "vitest";
import { projectSchema } from "@/lib/validations/project";
import { buildProjectUpdate, changedGroups } from "./project-edit-patch";
import { LOCKED_PROJECT_FIELDS } from "../../convex/lib/projectLocks";

const parse = (over: Record<string, unknown> = {}) =>
  projectSchema.parse({ projectNumber: "P-1", name: "Gala", type: "FESTIVAL", ...over });

const NOW = 1_700_000_000_000;

describe("buildProjectUpdate: full mode", () => {
  it("sends every field and clears blanks, including the locked money fields", () => {
    const { set, clear } = buildProjectUpdate(parse(), { now: NOW });
    expect(set).toMatchObject({ projectNumber: "P-1", name: "Gala", type: "FESTIVAL", status: "ENQUIRY", updatedAt: NOW });
    // This is the shape that a pricing-locked job refuses (assertPricingUnlocked).
    for (const f of LOCKED_PROJECT_FIELDS) expect(clear).toContain(f);
  });

  it("keeps 0 as a value, never a clear (blank is not $0)", () => {
    const { set, clear } = buildProjectUpdate(parse({ discountPercent: 0, billingDaysOverride: 0 }), { now: NOW });
    expect(set.discountPercent).toBe(0);
    expect(set.billingDaysOverride).toBe(0);
    expect(clear).not.toContain("discountPercent");
  });

  it("turns dates into epoch-ms", () => {
    const { set } = buildProjectUpdate(parse({ rentalStartDate: "2026-12-01" }), { now: NOW });
    expect(set.rentalStartDate).toBe(new Date("2026-12-01").getTime());
  });
});

describe("buildProjectUpdate: diff mode (the pricing-lock fix)", () => {
  it("an unchanged form touches NO locked field and sends no status", () => {
    const before = parse({ discountPercent: 10, rentalStartDate: "2026-12-01" });
    const u = buildProjectUpdate(parse({ discountPercent: 10, rentalStartDate: "2026-12-01", description: "x" }), { before, now: NOW });
    expect(Object.keys(u.set).sort()).toEqual(["description", "updatedAt"]);
    expect(u.clear).toEqual([]);
    for (const f of LOCKED_PROJECT_FIELDS) {
      expect(u.set).not.toHaveProperty(f);
      expect(u.clear).not.toContain(f);
    }
    expect(u.set).not.toHaveProperty("status");
  });

  it("a blank locked field stays blank without a clear", () => {
    const before = parse();
    const u = buildProjectUpdate(parse({ name: "Gala 2" }), { before, now: NOW });
    expect(u.clear).toEqual([]);
    expect(u.set).toEqual({ name: "Gala 2", updatedAt: NOW });
  });

  it("clears a field the user blanked and sends a changed discount", () => {
    const before = parse({ description: "x", discountPercent: 5 });
    const u = buildProjectUpdate(parse({ discountPercent: 0 }), { before, now: NOW });
    expect(u.clear).toEqual(["description"]);
    expect(u.set.discountPercent).toBe(0);
  });

  it("no change at all is an empty update", () => {
    const p = parse();
    expect(buildProjectUpdate(p, { before: p, now: NOW })).toEqual({ set: {}, clear: [] });
  });

  it("names what changed for the sheet footer", () => {
    const before = parse({ rentalStartDate: "2026-12-01", projectStartDate: "2026-11-30" });
    const u = buildProjectUpdate(parse({ rentalStartDate: "2026-12-03", projectStartDate: "2026-12-02", tags: ["a"] }), { before, now: NOW });
    expect(changedGroups(u)).toEqual(["dates", "project window", "tags"]);
  });
});
