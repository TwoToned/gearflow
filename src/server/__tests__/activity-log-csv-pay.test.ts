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
const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => ({ query: vi.fn(async () => rows.value) })) }));

import { exportActivityLogCSV } from "../activity-log";

beforeEach(() => {
  role.value = "member";
  rows.value = [row];
});

describe("exportActivityLogCSV — maintenance labour and part prices", () => {
  const snap = (before: Record<string, unknown>, after: Record<string, unknown>) => ({ before, after, serverSavedAt: 1, authorId: "u" });
  const maintenanceRows = () => [
    { createdAt: "2026-11-24T00:00:00.000Z", userName: "Ann", action: "UPDATE", entityType: "maintenance", entityName: "Fix desk", summary: "Added part Strut", details: { partOp: snap({ name: "Strut", unitPrice: 12.5 }, { name: "Strut", unitPrice: 15 }) } },
    { createdAt: "2026-11-24T00:00:00.000Z", userName: "Ann", action: "UPDATE", entityType: "maintenance", entityName: "Fix desk", summary: "Completed", details: { lifecycle: snap({ status: "IN_PROGRESS", cost: 50 }, { status: "COMPLETED", cost: 120 }) } },
    { createdAt: "2026-11-24T00:00:00.000Z", userName: "Ann", action: "UPDATE", entityType: "maintenance", entityName: "Fix desk", summary: "Edited", details: { fieldEdit: snap({ title: "A", cost: 50 }, { title: "B", cost: 80 }) } },
  ];

  it("a role without invoice:read gets none of the money keys, but every row and its other fields", async () => {
    rows.value = maintenanceRows();
    role.value = "custom:legacy";
    const csv = await exportActivityLogCSV();
    expect(csv).not.toMatch(/unitPrice|cost/);
    expect(csv).toMatch(/Strut/);
    expect(csv).toMatch(/COMPLETED/);
    expect(csv).toMatch(/Edited/);
  });

  it("a caller who sees job cost reads the money keys", async () => {
    rows.value = maintenanceRows();
    role.value = "manager";
    const csv = await exportActivityLogCSV();
    expect(csv).toMatch(/unitPrice/);
    expect(csv).toMatch(/cost/);
  });
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
