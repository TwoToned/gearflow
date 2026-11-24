// @vitest-environment node
//
// The activity-log CSV reads `activityLog.exportRows` with the SERVICE identity
// (which always sees money), so it redacts field diffs for its real caller:
// individual pay by `callerSeesCrewPay`, job cost by `callerSeesJobCost`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ value: "member" as string }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Ann" })),
  getCurrentRole: vi.fn(async () => role.value),
}));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => null) }));
const row = {
  createdAt: "2026-11-24T00:00:00.000Z", userName: "Ann", action: "UPDATE", entityType: "crew_member", entityName: "Bob Ryan", summary: "Updated crew member Bob Ryan",
  details: { changes: [{ field: "firstName", from: "Bob", to: "Robert" }, { field: "defaultDayRate", from: 600, to: 650 }, { field: "margin", from: 4000, to: 4050 }] },
};
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => ({ query: vi.fn(async () => [row]) })) }));

import { exportActivityLogCSV } from "../activity-log";

beforeEach(() => {
  role.value = "member";
});

describe("exportActivityLogCSV — crew pay in field diffs", () => {
  it("a member (invoice:read, below the pay line): no rate change, but the job-cost margin change stays", async () => {
    const csv = await exportActivityLogCSV();
    expect(csv).toMatch(/Robert/);
    expect(csv).not.toMatch(/defaultDayRate|650/);
    expect(csv).toMatch(/margin/);
  });

  it("a role without invoice:read loses the margin change too", async () => {
    role.value = "custom:legacy";
    const csv = await exportActivityLogCSV();
    expect(csv).toMatch(/Robert/);
    expect(csv).not.toMatch(/defaultDayRate|margin/);
  });

  it("a manager's CSV keeps both", async () => {
    role.value = "manager";
    const csv = await exportActivityLogCSV();
    expect(csv).toMatch(/defaultDayRate/);
    expect(csv).toMatch(/margin/);
  });
});
