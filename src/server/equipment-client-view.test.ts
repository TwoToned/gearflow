import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = { organizationId: "org_1", userId: "user_1", userName: "Ada" };
const requirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-context", () => ({ requirePermission }));

vi.mock("../../convex/_generated/api", () => ({
  api: { financeArtifacts: { versionPreviewContext: "financeArtifacts.versionPreviewContext" } },
}));
const convexMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

const getProjectByIdMapped = vi.hoisted(() => vi.fn());
vi.mock("@/lib/projects-read", () => ({ getProjectByIdMapped }));
const buildDocumentLineItemData = vi.hoisted(() => vi.fn());
vi.mock("@/lib/project-line-item-read", () => ({ buildDocumentLineItemData }));
vi.mock("@/lib/locations-read", () => ({ getLocationMap: vi.fn(async () => new Map()) }));
const getProjectServicesForVersion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/project-services-read", () => ({ getProjectServicesForVersion }));

const { getEquipmentClientView } = await import("@/server/equipment-client-view");

const LIVE_MONEY = { subtotal: 1000, discountAmount: 0, taxAmount: 100, total: 1100 };

function line(overrides: Record<string, unknown>) {
  return {
    id: "li-1",
    description: "Lectern",
    quantity: 2,
    checkedOutQuantity: 0,
    unitPrice: 50,
    pricingType: "FLAT",
    duration: 1,
    discount: null,
    lineTotal: 100,
    status: "CONFIRMED",
    isKitChild: false,
    isOptional: false,
    sortOrder: 0,
    categoryId: null,
    groupId: null,
    model: null,
    asset: null,
    bulkAsset: null,
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ctx);
  getProjectByIdMapped.mockResolvedValue({ id: "p1", ...LIVE_MONEY });
  buildDocumentLineItemData.mockResolvedValue({ categories: [], lineItems: [line({})] });
  getProjectServicesForVersion.mockResolvedValue([]);
});

describe("getEquipmentClientView", () => {
  it("refuses a malformed request before touching anything", async () => {
    await expect(getEquipmentClientView({ projectId: "" })).rejects.toThrow();
    await expect(getEquipmentClientView({ projectId: "p1", versionId: "x".repeat(65) })).rejects.toThrow();
    expect(requirePermission).not.toHaveBeenCalled();
    expect(buildDocumentLineItemData).not.toHaveBeenCalled();
  });

  it("gates on project:read and stops when it is refused", async () => {
    requirePermission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(getEquipmentClientView({ projectId: "p1" })).rejects.toThrow("Forbidden");
    expect(requirePermission).toHaveBeenCalledWith("project", "read");
    expect(buildDocumentLineItemData).not.toHaveBeenCalled();
  });

  it("treats another org's job as not found", async () => {
    getProjectByIdMapped.mockResolvedValueOnce(null);
    await expect(getEquipmentClientView({ projectId: "p1" })).rejects.toThrow("Job not found");
    expect(getProjectByIdMapped).toHaveBeenCalledWith("p1", "org_1");
    expect(buildDocumentLineItemData).not.toHaveBeenCalled();
  });

  it("renders the live version with the project's stored totals", async () => {
    const view = await getEquipmentClientView({ projectId: "p1" });
    expect(convexMock.query).not.toHaveBeenCalled();
    expect(buildDocumentLineItemData).toHaveBeenCalledWith("p1", "org_1", undefined);
    expect(view.totals).toEqual(LIVE_MONEY);
    expect(view.sections.flatMap((s) => s.rows.map((r) => [r.name, r.qty, r.total]))).toEqual([["Lectern", "2", "$100.00"]]);
  });

  it("threads a viewed version through every read and prints that version's totals", async () => {
    convexMock.query.mockResolvedValueOnce({ versionId: "v3", subtotal: 400, discountAmount: 40, taxAmount: 36, total: 396 });
    const view = await getEquipmentClientView({ projectId: "p1", versionId: "v3" });
    expect(convexMock.query).toHaveBeenCalledWith("financeArtifacts.versionPreviewContext", {
      projectId: "p1",
      versionId: "v3",
      orgId: "org_1",
    });
    expect(buildDocumentLineItemData).toHaveBeenCalledWith("p1", "org_1", "v3");
    expect(getProjectServicesForVersion).toHaveBeenCalledWith("org_1", "p1", "v3");
    expect(view.totals).toEqual({ subtotal: 400, discountAmount: 40, taxAmount: 36, total: 396 });
  });

  it("appends billable services and never sends cost or asset fields", async () => {
    buildDocumentLineItemData.mockResolvedValueOnce({
      categories: [],
      lineItems: [line({ costTotal: 30, asset: { assetTag: "A-1", locationId: null } })],
    });
    getProjectServicesForVersion.mockResolvedValueOnce([
      { id: "s1", title: "Audio engineer", status: "CONFIRMED", lineTotal: 600, unitPrice: 600, discount: null, sortOrder: 0, description: null },
      { id: "s2", title: "Unpriced", status: "CONFIRMED", lineTotal: 0, unitPrice: null, discount: null, sortOrder: 1, description: null },
    ]);
    const view = await getEquipmentClientView({ projectId: "p1" });
    const services = view.sections.find((s) => s.title === "Services");
    expect(services?.rows.map((r) => r.name)).toEqual(["Audio engineer"]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("costTotal");
    expect(json).not.toContain("A-1");
  });
});
