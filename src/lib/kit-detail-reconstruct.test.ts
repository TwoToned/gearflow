import { describe, it, expect } from "vitest";
import { reconstructKit, type KitBundleData } from "./kit-detail-reconstruct";

const d = <T extends Record<string, unknown>>(o: T) =>
  ({ _id: `id_${o.id ?? "x"}`, _creationTime: 0, ...o }) as never;

const ORG = "o1";

function makeBundle(parts: Partial<Record<keyof KitBundleData, unknown>>): KitBundleData {
  return {
    kit: d({ id: "k1", organizationId: ORG, name: "Vocal Kit", assetTag: "KIT-1", purchaseDate: 1700000000000 }),
    serializedItems: [], bulkItems: [], lineItems: [], scanLogs: [], media: [],
    assets: [], bulkAssets: [], models: [], projects: [], users: [], files: [],
    location: null, category: null,
    ...parts,
  } as never;
}

describe("reconstructKit", () => {
  it("maps kit scalars with defaults + purchaseDate→Date + empty relations", () => {
    const res = reconstructKit(makeBundle({
      location: d({ id: "loc1", organizationId: ORG, name: "Bay 3" }),
      category: d({ id: "cat1", organizationId: ORG, name: "Audio" }),
    }));
    expect(res.id).toBe("k1");
    expect(res.status).toBe("AVAILABLE"); // default
    expect(res.condition).toBe("NEW"); // default
    expect(res.purchaseDate).toBeInstanceOf(Date);
    expect(res.location?.name).toBe("Bay 3");
    expect(res.category?.name).toBe("Audio");
    expect(res.maintenanceRecords).toEqual([]);
  });

  it("builds serialized + bulk members with asset/model, dropping members whose asset is absent", () => {
    const res = reconstructKit(makeBundle({
      serializedItems: [
        d({ id: "si1", kitId: "k1", assetId: "a1", position: "Slot A" }),
        d({ id: "si2", kitId: "k1", assetId: "missing" }), // dropped (asset absent)
      ],
      bulkItems: [d({ id: "bi1", kitId: "k1", bulkAssetId: "b1", quantity: 4 })],
      assets: [d({ id: "a1", organizationId: ORG, assetTag: "TAG-A1", condition: "GOOD", modelId: "m1" })],
      bulkAssets: [d({ id: "b1", organizationId: ORG, modelId: "m2" })],
      models: [d({ id: "m1", organizationId: ORG, name: "SM58" }), d({ id: "m2", organizationId: ORG, name: "Cable" })],
    }));
    expect(res.serializedItems.map((s) => s.id)).toEqual(["si1"]); // si2 dropped
    expect(res.serializedItems[0].asset.assetTag).toBe("TAG-A1");
    expect(res.serializedItems[0].asset.model?.name).toBe("SM58");
    expect(res.serializedItems[0].position).toBe("Slot A");
    expect(res.bulkItems[0].quantity).toBe(4);
    expect(res.bulkItems[0].bulkAsset.model?.name).toBe("Cable");
  });

  it("attaches project to usage line items (dropping project-less) and resolves scan log user/project", () => {
    const res = reconstructKit(makeBundle({
      lineItems: [
        d({ id: "li1", projectId: "p1", status: "CHECKED_OUT", checkedOutAt: 1700000000000 }),
        d({ id: "li2", projectId: "gone" }), // dropped (project absent)
      ],
      scanLogs: [d({ id: "sl1", scannedById: "u1", projectId: "p1", scannedAt: 1700000000001 })],
      projects: [d({ id: "p1", organizationId: ORG, name: "Gig", projectNumber: "P-1" })],
      users: [d({ id: "u1", organizationId: ORG, name: "Alice", email: "a@x.com" })],
    }));
    expect(res.lineItems.map((l) => l.id)).toEqual(["li1"]); // li2 dropped
    expect(res.lineItems[0].project.projectNumber).toBe("P-1");
    expect(res.lineItems[0].checkedOutAt).toBeInstanceOf(Date);
    expect(res.scanLogs[0].scannedBy?.name).toBe("Alice");
    expect(res.scanLogs[0].project?.name).toBe("Gig");
  });

  it("resolves media files (url/thumbnailUrl)", () => {
    const res = reconstructKit(makeBundle({
      media: [d({ id: "med1", kitId: "k1", fileId: "f1", type: "PHOTO", isPrimary: true })],
      files: [d({ id: "f1", organizationId: ORG, url: "http://x/a.jpg", thumbnailUrl: "http://x/t.jpg" })],
    }));
    expect(res.media[0].isPrimary).toBe(true);
    expect(res.media[0].file?.url).toBe("http://x/a.jpg");
    expect(res.media[0].file?.thumbnailUrl).toBe("http://x/t.jpg");
  });
});
