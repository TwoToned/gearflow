import { describe, it, expect } from "vitest";
import { reconstructAsset, type AssetBundleData } from "./asset-detail-reconstruct";

const d = <T extends Record<string, unknown>>(o: T) =>
  ({ _id: `id_${o.id ?? "x"}`, _creationTime: 0, ...o }) as never;

const ORG = "o1";

function makeBundle(parts: Partial<Record<keyof AssetBundleData, unknown>>): AssetBundleData {
  return {
    asset: d({ id: "as1", organizationId: ORG, assetTag: "TAG-1", modelId: "m1", purchaseDate: 1700000000000 }),
    model: null, category: null, supplier: null, parentAsset: null, location: null,
    assetMedia: [], modelMedia: [], childAssets: [], childBulkChildren: [], lineItems: [],
    testTags: [], maintenanceLinks: [], modelAccessories: [],
    bulkAssets: [], models: [], projects: [], maintenanceRecords: [], files: [],
    ...parts,
  } as never;
}

describe("reconstructAsset", () => {
  it("maps asset scalars (defaults + purchaseDate→Date) + empty relations", () => {
    const res = reconstructAsset(makeBundle({ location: d({ id: "loc1", organizationId: ORG, name: "Bay 3" }) }));
    expect(res.id).toBe("as1");
    expect(res.assetTag).toBe("TAG-1");
    expect(res.status).toBe("AVAILABLE"); // default
    expect(res.condition).toBe("GOOD"); // default
    expect(res.purchaseDate).toBeInstanceOf(Date);
    expect(res.location?.name).toBe("Bay 3");
    expect(res.scanLogs).toEqual([]);
  });

  it("builds model with category + specs + media docs + bulk accessories", () => {
    const res = reconstructAsset(makeBundle({
      model: d({ id: "m1", organizationId: ORG, name: "SM58", requiresTestAndTag: true, specifications: [{ key: "Impedance", value: "300" }], categoryId: "cat1" }),
      category: d({ id: "cat1", organizationId: ORG, name: "Audio" }),
      modelMedia: [d({ id: "mm1", modelId: "m1", fileId: "f1", type: "MANUAL", displayName: "Manual" })],
      modelAccessories: [d({ id: "ma1", organizationId: ORG, modelId: "m1", bulkAssetId: "b1", quantity: 2, sortOrder: 0 })],
      bulkAssets: [d({ id: "b1", organizationId: ORG, assetTag: "BULK-1", modelId: "m2" })],
      models: [d({ id: "m2", organizationId: ORG, name: "XLR Cable" })],
      files: [d({ id: "f1", organizationId: ORG, fileName: "manual.pdf", fileSize: 1000, mimeType: "application/pdf", url: "http://x/m.pdf" })],
    }));
    expect(res.model?.name).toBe("SM58");
    expect(res.model?.requiresTestAndTag).toBe(true);
    expect(res.model?.category?.name).toBe("Audio");
    expect(res.model?.specifications).toEqual([{ key: "Impedance", value: "300" }]);
    expect(res.model?.media[0].file.fileName).toBe("manual.pdf");
    expect(res.model?.bulkAccessories[0].quantity).toBe(2);
    expect(res.model?.bulkAccessories[0].bulkAsset.model?.name).toBe("XLR Cable");
  });

  it("builds child assets + child bulk items with resolved models", () => {
    const res = reconstructAsset(makeBundle({
      childAssets: [d({ id: "c1", organizationId: ORG, assetTag: "CHILD-1", modelId: "m3" })],
      childBulkChildren: [d({ id: "cb1", organizationId: ORG, parentAssetId: "as1", bulkAssetId: "b2", quantity: 3, sortOrder: 0 })],
      bulkAssets: [d({ id: "b2", organizationId: ORG, assetTag: "BULK-2", modelId: "m4" })],
      models: [d({ id: "m3", organizationId: ORG, name: "Clamp" }), d({ id: "m4", organizationId: ORG, name: "Gel" })],
    }));
    expect(res.childAssets[0].assetTag).toBe("CHILD-1");
    expect(res.childAssets[0].model?.name).toBe("Clamp");
    expect(res.childBulkItems[0].quantity).toBe(3);
    expect(res.childBulkItems[0].bulkAsset.model?.name).toBe("Gel");
  });

  it("attaches projects to usage line items + maintenance records to links + test-tag", () => {
    const res = reconstructAsset(makeBundle({
      lineItems: [d({ id: "li1", projectId: "p1", status: "CHECKED_OUT", checkedOutAt: 1700000000000 })],
      projects: [d({ id: "p1", organizationId: ORG, name: "Gig", projectNumber: "P-1" })],
      maintenanceLinks: [d({ id: "ml1", maintenanceRecordId: "mr1" })],
      maintenanceRecords: [d({ id: "mr1", organizationId: ORG, title: "Service", type: "REPAIR", status: "COMPLETED", result: "PASS", createdAt: 1700000000000 })],
      testTags: [d({ id: "tt1", testTagId: "T-1", status: "PASS", lastTestDate: 1700000000000, nextDueDate: 1800000000000 })],
    }));
    expect(res.lineItems[0].project.projectNumber).toBe("P-1");
    expect(res.lineItems[0].checkedOutAt).toBeInstanceOf(Date);
    expect(res.maintenanceLinks[0].maintenanceRecord.title).toBe("Service");
    expect(res.maintenanceLinks[0].maintenanceRecord.result).toBe("PASS");
    expect(res.testTagAsset?.status).toBe("PASS");
    expect(res.testTagAsset?.nextDueDate).toBeInstanceOf(Date);
  });

  it("drops media rows whose file is absent", () => {
    const res = reconstructAsset(makeBundle({
      assetMedia: [
        d({ id: "am1", assetId: "as1", fileId: "f1", type: "PHOTO", isPrimary: true }),
        d({ id: "am2", assetId: "as1", fileId: "gone" }),
      ],
      files: [d({ id: "f1", organizationId: ORG, fileName: "a.jpg", fileSize: 10, mimeType: "image/jpeg", url: "http://x/a.jpg", thumbnailUrl: "http://x/t.jpg" })],
    }));
    expect(res.media.map((m) => m.id)).toEqual(["am1"]); // am2 dropped
    expect(res.media[0].file.thumbnailUrl).toBe("http://x/t.jpg");
  });
});
