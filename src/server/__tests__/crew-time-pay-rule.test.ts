import { describe, expect, it, vi } from "vitest";

/**
 * The timesheet CSV decides its pay columns with THE crew-pay rule
 * (`convex/lib/crewPayRule.ts`), the same function `canSeeCrewPay` uses — not a
 * second "who sees pay" check (R-3.1). Proven by spying on the rule: the CSV
 * asks it, with the caller's real inputs, and obeys its answer.
 */
type RuleInput = { managerPlus: boolean; invoiceRead: boolean; noFinancials: boolean };
const rule = vi.hoisted(() => ({ answer: true, calls: [] as RuleInput[] }));
vi.mock("../../../convex/lib/crewPayRule", () => ({
  crewPayVisible: (input: RuleInput) => {
    rule.calls.push(input);
    return rule.answer;
  },
}));
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Alice" })),
  getCurrentRole: vi.fn(async () => "manager"),
}));
const ambient = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => ambient.value) }));
vi.mock("@/lib/crew-read", () => ({ getCrewMembersByOrg: vi.fn(async () => []), getCrewRoleMap: vi.fn(async () => new Map()) }));
vi.mock("@/lib/projects-read", () => ({ getProjectsByOrg: vi.fn(async () => []) }));
vi.mock("@/lib/crew-scheduling-read", () => ({ getAssignmentsByOrg: vi.fn(async () => []), getTimeEntriesByOrg: vi.fn(async () => []) }));

import { exportTimesheetCSV } from "../crew-time";
import { crewPayVisible } from "../../../convex/lib/crewPayRule";

describe("exportTimesheetCSV asks the one crew-pay rule", () => {
  it("a manager in the UI: the rule is asked (manager+, invoice:read, not noFinancials) and its NO is obeyed", async () => {
    rule.calls.length = 0;
    rule.answer = false;
    const csv = await exportTimesheetCSV();
    expect(rule.calls).toEqual([{ managerPlus: true, invoiceRead: true, noFinancials: false }]);
    expect(csv).not.toContain("Rate (pay)");
    rule.answer = true;
    expect(await exportTimesheetCSV()).toContain("Rate (pay)");
  });

  it("an API-key actor reaches the rule as noFinancials (fail closed)", async () => {
    rule.calls.length = 0;
    ambient.value = { organizationId: "org1", userId: "u1", userName: "Alice", actorType: "apiKey" };
    await exportTimesheetCSV();
    expect(rule.calls).toEqual([{ managerPlus: true, invoiceRead: true, noFinancials: true }]);
    ambient.value = undefined;
  });

  it("is the mocked module (sanity)", () => {
    expect(typeof crewPayVisible).toBe("function");
  });
});
