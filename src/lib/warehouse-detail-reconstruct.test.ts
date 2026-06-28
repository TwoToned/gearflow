import { describe, it, expect } from "vitest";
import {
  reconstructWarehouseProject,
  type WarehouseBundleData,
} from "./warehouse-detail-reconstruct";

/**
 * Parity coverage for the native warehouse reconstruction — getProjectForWarehouse's
 * `{ ...project, lineItems, client, location }` rebuilt from warehouseDetail.bundle.
 */

const d = <T extends Record<string, unknown>>(o: T) =>
  ({ _id: `id_${o.id ?? "x"}`, _creationTime: 0, ...o }) as never;

const ORG = "o1";
const PROJ = "p1";

function makeBundle(parts: Partial<Record<keyof WarehouseBundleData, unknown>>): WarehouseBundleData {
  return {
    project: d({ id: PROJ, organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "PREPPING", createdAt: 1000 }),
    lineItems: [],
    units: [],
    assets: [],
    bulkAssets: [],
    kits: [],
    models: [],
    suppliers: [],
    orgCategories: [],
    modelCheckCounts: {},
    kitCheckCounts: {},
    client: null,
    location: null,
    ...parts,
  } as never;
}

describe("reconstructWarehouseProject", () => {
  it("maps project scalars + client name + empty tree", () => {
    const res = reconstructWarehouseProject(
      makeBundle({ client: d({ id: "cl1", organizationId: ORG, name: "Acme" }) }),
    );
    expect(res.id).toBe(PROJ);
    expect(res.status).toBe("PREPPING");
    expect(res.client?.name).toBe("Acme");
    expect(res.lineItems).toEqual([]);
  });

  it("builds the EQUIPMENT tree with model/kit check counts + asset on line AND unit", () => {
    const res = reconstructWarehouseProject(
      makeBundle({
        lineItems: [
          d({ id: "li1", organizationId: ORG, projectId: PROJ, type: "EQUIPMENT", modelId: "m1", kitId: "k1", assetId: "a1", quantity: 1, status: "CHECKED_OUT" }),
          d({ id: "svc1", organizationId: ORG, projectId: PROJ, type: "SERVICE", quantity: 1, status: "QUOTED" }), // dropped (not EQUIPMENT)
        ],
        units: [
          d({ id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a2", status: "CHECKED_OUT" }),
        ],
        models: [d({ id: "m1", organizationId: ORG, name: "SM58", categoryId: "cat1" })],
        kits: [d({ id: "k1", organizationId: ORG, name: "Vocal Kit" })],
        assets: [
          d({ id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-A1" }),
          d({ id: "a2", organizationId: ORG, modelId: "m1", assetTag: "TAG-A2" }),
        ],
        orgCategories: [d({ id: "cat1", organizationId: ORG, name: "Audio" })],
        modelCheckCounts: { m1: 3 },
        kitCheckCounts: { k1: 2 },
      }),
    );
    expect(res.lineItems).toHaveLength(1); // SERVICE dropped
    const li = res.lineItems[0];
    expect(li.id).toBe("li1");
    expect(li.model?._count?.modelCheckItems).toBe(3);
    expect(li.kit?._count?.kitCheckItems).toBe(2);
    expect(li.asset?.assetTag).toBe("TAG-A1"); // asset on the line
    expect(li.units).toHaveLength(1);
    expect(li.units[0].asset?.assetTag).toBe("TAG-A2"); // asset on the unit
  });
});
