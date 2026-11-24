// @vitest-environment node
//
// The activity-log CSV reads `activityLog.exportRows` with the SERVICE identity
// (which always sees pay), so it redacts crew pay in field diffs for its real
// caller (`callerSeesCrewPay`, the ONE rule).
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ value: "member" as string }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Ann" })),
  getCurrentRole: vi.fn(async () => role.value),
}));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => null) }));
const row = {
  createdAt: "2026-11-24T00:00:00.000Z", userName: "Ann", action: "UPDATE", entityType: "crew_member", entityName: "Bob Ryan", summary: "Updated crew member Bob Ryan",
  details: { changes: [{ field: "firstName", from: "Bob", to: "Robert" }, { field: "defaultDayRate", from: 600, to: 650 }] },
};
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => ({ query: vi.fn(async () => [row]) })) }));

import { exportActivityLogCSV } from "../activity-log";

beforeEach(() => {
  role.value = "member";
});

describe("exportActivityLogCSV — crew pay in field diffs", () => {
  it("below the pay line the rate change is not in the CSV; the rest of the row is", async () => {
    const csv = await exportActivityLogCSV();
    expect(csv).toMatch(/Robert/);
    expect(csv).not.toMatch(/defaultDayRate|650/);
  });

  it("a manager's CSV keeps it", async () => {
    role.value = "manager";
    expect(await exportActivityLogCSV()).toMatch(/defaultDayRate/);
  });
});
