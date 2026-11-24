// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ value: "member" as string | null, actor: null as null | { actorType: string } }));
vi.mock("@/lib/org-context", () => ({ getCurrentRole: vi.fn(async () => role.value) }));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => role.actor) }));

import { callerSeesCrewPay, callerSeesJobCost, jobCostSortAllowed, withoutJobCost } from "./crew-pay-caller";
import { crewPayVisible, jobCostVisible } from "../../convex/lib/crewPayRule";

beforeEach(() => {
  role.value = "member";
  role.actor = null;
});

describe("jobCostVisible — the ONE job-cost rule (owner ruling 2026-11-24)", () => {
  it("is invoice:read AND not noFinancials, over every input", () => {
    expect(jobCostVisible({ invoiceRead: true, noFinancials: false })).toBe(true);
    expect(jobCostVisible({ invoiceRead: true, noFinancials: true })).toBe(false);
    expect(jobCostVisible({ invoiceRead: false, noFinancials: false })).toBe(false);
    expect(jobCostVisible({ invoiceRead: false, noFinancials: true })).toBe(false);
  });

  it("is a different line from crew pay: a member passes job cost and fails pay", () => {
    expect(jobCostVisible({ invoiceRead: true, noFinancials: false })).toBe(true);
    expect(crewPayVisible({ managerPlus: false, noFinancials: false })).toBe(false);
  });
});

describe("callerSeesJobCost — the server-action twin", () => {
  it("every built-in role holding invoice:read passes; pay stays manager+", async () => {
    for (const r of ["owner", "admin", "manager", "member", "warehouse", "viewer"]) {
      role.value = r;
      expect(await callerSeesJobCost(), r).toBe(true);
    }
    role.value = "member";
    expect(await callerSeesCrewPay()).toBe(false);
  });

  it("a role without invoice:read (an unknown / removed role) and a non-member fail", async () => {
    role.value = "custom:legacy";
    expect(await callerSeesJobCost()).toBe(false);
    role.value = null;
    expect(await callerSeesJobCost()).toBe(false);
  });

  it("an ambient API key fails closed, even as an owner (its noFinancials flag isn't known here)", async () => {
    role.value = "owner";
    role.actor = { actorType: "apiKey" };
    expect(await callerSeesJobCost()).toBe(false);
    role.actor = { actorType: "session" };
    expect(await callerSeesJobCost()).toBe(true);
  });
});

describe("withoutJobCost", () => {
  const row = { id: "p1", total: 5000, serviceCostTotal: 650, labourCostTotal: 300, margin: 4050, subHireCostTotal: 10 };

  it("without job cost the three job-level fields are ABSENT (not zero); everything else stays", () => {
    const out = withoutJobCost(row, false) as Record<string, unknown>;
    expect(out).toEqual({ id: "p1", total: 5000, subHireCostTotal: 10 });
    for (const f of ["serviceCostTotal", "labourCostTotal", "margin"]) expect(out, f).not.toHaveProperty(f);
    expect(row.margin).toBe(4050); // the input is not mutated
  });

  it("with job cost the row is returned as is", () => {
    expect(withoutJobCost(row, true)).toBe(row);
  });
});

describe("jobCostSortAllowed", () => {
  it("a job-cost field is not a sort key without job cost; any other field is", () => {
    for (const f of ["serviceCostTotal", "labourCostTotal", "margin"]) {
      expect(jobCostSortAllowed(f, false), f).toBe(false);
      expect(jobCostSortAllowed(f, true), f).toBe(true);
    }
    expect(jobCostSortAllowed("createdAt", false)).toBe(true);
    expect(jobCostSortAllowed("total", false)).toBe(true);
  });
});
