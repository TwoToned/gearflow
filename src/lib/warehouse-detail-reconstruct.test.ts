import { describe, it, expect } from "vitest";
import {
  reconstructWarehouseProject,
  reconstructSaleItemsToPrep,
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
          // WS11 (#950) — a SALE line stays out of the EQUIPMENT scan/kit tree
          // (not EQUIPMENT type); it's picked up separately by
          // reconstructSaleItemsToPrep instead (2026-08 warehouse sales-prep split).
          d({ id: "sale1", organizationId: ORG, projectId: PROJ, type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 2, status: "CONFIRMED" }),
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
    expect(res.lineItems).toHaveLength(1); // SERVICE + SALE dropped
    const li = res.lineItems[0];
    expect(li.id).toBe("li1");
    expect(li.model?._count?.modelCheckItems).toBe(3);
    expect(li.kit?._count?.kitCheckItems).toBe(2);
    expect(li.asset?.assetTag).toBe("TAG-A1"); // asset on the line
    expect(li.units).toHaveLength(1);
    expect(li.units[0].asset?.assetTag).toBe("TAG-A2"); // asset on the unit

    // The SALE line is excluded from the EQUIPMENT tree above but DOES surface
    // in the separate sale-items-to-prep list, with its model's SKU attached.
    expect(res.saleItemsToPrep).toHaveLength(1);
    expect(res.saleItemsToPrep[0].id).toBe("sale1");
    expect(res.saleItemsToPrep[0].quantity).toBe(2);
    expect(res.saleItemsToPrep[0].modelName).toBe("SM58");
    expect(res.saleItemsToPrep[0].picked).toBe(false);
  });
});

describe("reconstructSaleItemsToPrep", () => {
  it("includes only NEW_STOCK, non-cancelled SALE lines, with SKU + picked state", () => {
    const res = reconstructSaleItemsToPrep(
      makeBundle({
        lineItems: [
          d({ id: "sale-new", organizationId: ORG, projectId: PROJ, type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 3, status: "CONFIRMED", salePickedAt: 12345 }),
          // FROM_RENTAL_STOCK sale — excluded (2026-08 split kept this half out of the warehouse tree).
          d({ id: "sale-fleet", organizationId: ORG, projectId: PROJ, type: "SALE", saleMode: "FROM_RENTAL_STOCK", modelId: "m1", quantity: 1, status: "CONFIRMED" }),
          // Cancelled NEW_STOCK sale — excluded, nothing left to pick.
          d({ id: "sale-cancelled", organizationId: ORG, projectId: PROJ, type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 1, status: "CANCELLED" }),
          // Rental EQUIPMENT line — excluded, not a sale.
          d({ id: "li-rental", organizationId: ORG, projectId: PROJ, type: "EQUIPMENT", modelId: "m1", quantity: 1, status: "CONFIRMED" }),
        ],
        models: [d({ id: "m1", organizationId: ORG, name: "SM58", sku: "SKU-SM58", categoryId: "cat1" })],
      }),
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toEqual({
      id: "sale-new",
      description: null,
      quantity: 3,
      sku: "SKU-SM58",
      modelName: "SM58",
      picked: true,
    });
  });

  it("falls back to null sku/modelName when the model has no SKU or is missing", () => {
    const res = reconstructSaleItemsToPrep(
      makeBundle({
        lineItems: [
          d({ id: "sale-no-model", organizationId: ORG, projectId: PROJ, type: "SALE", saleMode: "NEW_STOCK", description: "Custom cable", quantity: 1, status: "CONFIRMED" }),
        ],
      }),
    );
    expect(res).toEqual([
      { id: "sale-no-model", description: "Custom cable", quantity: 1, sku: null, modelName: null, picked: false },
    ]);
  });
});
