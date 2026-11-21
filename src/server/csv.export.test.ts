/**
 * The models list export (`exportModelsCSV`) routes its cells through `@/lib/csv`
 * (the one formula-injection guard): a model name, manufacturer, category,
 * description or tag that starts with `= + - @`, tab or CR opens as text.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(), toConvexDoc: vi.fn() }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org_1" })),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/categories-read", () => ({
  getCategoryMap: vi.fn(async () => new Map([["cat_1", { id: "cat_1", name: "-Audio" }]])),
  getCategoriesByOrg: vi.fn(),
}));
vi.mock("@/lib/models-read", () => ({
  getModelsByOrg: vi.fn(async () => [
    {
      id: "m_1",
      name: "=HYPERLINK(\"http://x\",\"y\")",
      manufacturer: "+Shure",
      modelNumber: "@SM58",
      sku: "\tSKU",
      categoryId: "cat_1",
      assetType: "SERIALIZED",
      description: "\rdesc",
      dailyRate: 25,
      requiresTestAndTag: false,
      tags: ["=tag", "mic"],
      isActive: true,
    },
  ]),
}));

import { exportModelsCSV } from "./csv";

describe("exportModelsCSV", () => {
  it("neutralises formula starts in every text column", async () => {
    const csv = await exportModelsCSV();
    const [header, row] = csv.split("\n");

    expect(header.startsWith("name,manufacturer,modelNumber,sku,category,")).toBe(true);
    // name is guarded and quoted (it holds `"` and `,`); the CR cell is guarded AND quoted.
    expect(row).toBe(
      "\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\",'+Shure,'@SM58,'\tSKU,'-Audio,SERIALIZED,\"'\rdesc\"," +
        ",25,,,,,,,,,false,,,'=tag;mic",
    );
  });
});
