import { describe, it, expect } from "vitest";
import {
  reconstructProjectDetail,
  enrichProjectDetailOverbooked,
} from "./project-detail-reconstruct";
import type { EquipmentBundleData } from "./project-equipment-reconstruct";
import type { OverbookingBundleData } from "./overbooking-core";

/**
 * Unit coverage for the full native project-detail reconstruction (Phase 1d B.2).
 * Parity guard for the getProject-shaped object the native useProjectDetail returns.
 */

const EMPTY_EQUIPMENT: EquipmentBundleData = {
  lineItems: [], projectCategories: [], groups: [], units: [],
  assets: [], bulkAssets: [], kits: [], models: [], suppliers: [], categories: [],
};

const d = <T extends Record<string, unknown>>(o: T) =>
  ({ _id: `id_${o.id ?? "x"}`, _creationTime: 0, ...o }) as never;

// Minimal projectDetail.bundle fixture.
function detailBundle(overrides: Record<string, unknown> = {}) {
  return {
    project: d({ id: "p1", organizationId: "o1", projectNumber: "P-1", name: "Gig", createdAt: 1000 }),
    projectManagers: [],
    managerUsers: [],
    media: [],
    mediaFiles: [],
    client: null,
    location: null,
    parentLocation: null,
    ...overrides,
  } as never;
}

describe("reconstructProjectDetail", () => {
  it("maps project scalars (defaults + epoch→Date) and empty relations", () => {
    const res = reconstructProjectDetail(detailBundle(), EMPTY_EQUIPMENT);
    expect(res.id).toBe("p1");
    expect(res.name).toBe("Gig");
    expect(res.status).toBe("ENQUIRY"); // default
    expect(res.createdAt).toBeInstanceOf(Date);
    expect(res.projectManagers).toEqual([]);
    expect(res.media).toEqual([]);
    expect(res.location).toBeNull();
    expect(res.client).toBeNull();
    expect(res.categories).toEqual([]);
    expect(res.lineItems).toEqual([]);
  });

  it("attaches managers to their mirrored users (sorted by addedAt)", () => {
    const res = reconstructProjectDetail(
      detailBundle({
        projectManagers: [
          d({ id: "pm2", organizationId: "o1", projectId: "p1", userId: "u2", addedAt: 200 }),
          d({ id: "pm1", organizationId: "o1", projectId: "p1", userId: "u1", addedAt: 100 }),
        ],
        managerUsers: [
          d({ id: "u1", name: "Alice", email: "a@x.com" }),
          d({ id: "u2", name: "Bob", email: "b@x.com" }),
        ],
      }),
      EMPTY_EQUIPMENT,
    );
    expect(res.projectManagers.map((m) => m.id)).toEqual(["pm1", "pm2"]); // addedAt order
    expect(res.projectManagers[0].user?.name).toBe("Alice");
    expect(res.projectManagers[0].addedAt).toBeInstanceOf(Date);
  });

  it("reconstructs location with parent + inherits address/coords when child has none", () => {
    const res = reconstructProjectDetail(
      detailBundle({
        location: d({ id: "loc1", organizationId: "o1", name: "Bay 3", parentId: "loc0" }),
        parentLocation: d({ id: "loc0", organizationId: "o1", name: "HQ", address: "1 Main St", latitude: 1, longitude: 2 }),
      }),
      EMPTY_EQUIPMENT,
    );
    expect(res.location?.id).toBe("loc1");
    expect(res.location?.parent?.id).toBe("loc0");
    // child had no address/coords → inherits parent's
    expect(res.location?.address).toBe("1 Main St");
    expect(res.location?.latitude).toBe(1);
  });

  it("resolves media files and drops file-less rows", () => {
    const res = reconstructProjectDetail(
      detailBundle({
        media: [
          d({ id: "m1", organizationId: "o1", projectId: "p1", fileId: "f1", sortOrder: 0 }),
          d({ id: "m2", organizationId: "o1", projectId: "p1", fileId: "missing", sortOrder: 1 }),
        ],
        mediaFiles: [
          d({ id: "f1", organizationId: "o1", fileName: "a.jpg", fileSize: 10, mimeType: "image/jpeg", storageKey: "k", url: "http://x/a.jpg", uploadedById: "u1" }),
        ],
      }),
      EMPTY_EQUIPMENT,
    );
    expect(res.media).toHaveLength(1); // m2 dropped (file unresolved)
    expect(res.media[0].id).toBe("m1");
    expect(res.media[0].file.url).toBe("http://x/a.jpg");
  });

  it("line items default to not-overbooked before enrichment", () => {
    const equipment: EquipmentBundleData = {
      ...EMPTY_EQUIPMENT,
      lineItems: [d({ id: "li1", organizationId: "o1", projectId: "p1", modelId: "m1", quantity: 3, status: "QUOTED" })],
    };
    const res = reconstructProjectDetail(detailBundle(), equipment);
    expect(res.lineItems).toHaveLength(1);
    expect(res.lineItems[0].isOverbooked).toBe(false);
    expect(res.lineItems[0].overbookedInfo).toBeNull();
  });
});

const WIN_START = new Date("2026-01-01T00:00:00Z").getTime();
const WIN_END = new Date("2026-01-10T00:00:00Z").getTime();

describe("enrichProjectDetailOverbooked", () => {
  // p1 books 3 of model m1, which has only 2 serialized assets → over by 1.
  const equipment: EquipmentBundleData = {
    ...EMPTY_EQUIPMENT,
    lineItems: [d({ id: "li1", organizationId: "o1", projectId: "p1", modelId: "m1", quantity: 3, status: "QUOTED" })],
  };
  const detail = detailBundle({
    project: d({ id: "p1", organizationId: "o1", projectNumber: "P-1", name: "Gig", createdAt: 1000, rentalStartDate: WIN_START, rentalEndDate: WIN_END }),
  });
  const overbooking: OverbookingBundleData = {
    lineItems: [d({ id: "li1", organizationId: "o1", projectId: "p1", modelId: "m1", quantity: 3, status: "QUOTED" })],
    assets: [d({ id: "a1", organizationId: "o1", modelId: "m1", status: "AVAILABLE", isActive: true }), d({ id: "a2", organizationId: "o1", modelId: "m1", status: "AVAILABLE", isActive: true })],
    bulkAssets: [],
    projects: [d({ id: "p1", organizationId: "o1", projectNumber: "P-1", name: "Gig", status: "CONFIRMED", isTemplate: false, rentalStartDate: WIN_START, rentalEndDate: WIN_END })],
    models: [d({ id: "m1", organizationId: "o1", assetType: "SERIALIZED" })],
  } as never;

  it("returns the base unchanged while the overbooking bundle is still loading", () => {
    const base = reconstructProjectDetail(detail, equipment);
    const out = enrichProjectDetailOverbooked(base, undefined);
    expect(out.lineItems[0].isOverbooked).toBe(false);
    expect(out).toBe(base);
  });

  it("flags overbooked line items once the bundle lands", () => {
    const base = reconstructProjectDetail(detail, equipment);
    const out = enrichProjectDetailOverbooked(base, overbooking);
    expect(out.lineItems[0].isOverbooked).toBe(true);
    expect(out.lineItems[0].overbookedInfo).toMatchObject({ overBy: 1, totalStock: 2, effectiveStock: 2 });
  });

  it("leaves non-overbooked items false when within stock", () => {
    const within: EquipmentBundleData = {
      ...EMPTY_EQUIPMENT,
      lineItems: [d({ id: "li1", organizationId: "o1", projectId: "p1", modelId: "m1", quantity: 1, status: "QUOTED" })],
    };
    const ob: OverbookingBundleData = {
      ...overbooking,
      lineItems: [d({ id: "li1", organizationId: "o1", projectId: "p1", modelId: "m1", quantity: 1, status: "QUOTED" })],
    } as never;
    const base = reconstructProjectDetail(detail, within);
    const out = enrichProjectDetailOverbooked(base, ob);
    expect(out.lineItems[0].isOverbooked).toBe(false);
  });
});
