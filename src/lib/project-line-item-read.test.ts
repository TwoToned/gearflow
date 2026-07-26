import { describe, it, expect } from "vitest";
import {
  mapLineItemDoc,
  mapUnitDoc,
  mapCategoryDoc,
  mapGroupDoc,
} from "@/lib/project-line-item-read";

/**
 * Unit tests for the Convex-doc → Prisma-shape mappers behind the getProject
 * keystone. The tree RECONSTRUCTION is tested in project-line-item-tree-read.test.ts;
 * here we pin the field-level fidelity: epoch-ms → Date, absent → null, defaults.
 */

const EPOCH = 1_700_000_000_000; // a fixed ms timestamp

describe("mapLineItemDoc", () => {
  it("maps date fields from epoch-ms to Date and leaves money as number", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = {
      _id: "convex_internal",
      _creationTime: 123,
      id: "li1",
      organizationId: "org1",
      projectId: "p1",
      modelId: "m1",
      quantity: 3,
      unitPrice: 12.5,
      lineTotal: 37.5,
      sortOrder: 2,
      status: "CONFIRMED",
      checkedOutAt: EPOCH,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    };
    const r = mapLineItemDoc(doc);
    expect(r.checkedOutAt).toBeInstanceOf(Date);
    expect((r.checkedOutAt as Date).getTime()).toBe(EPOCH);
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.unitPrice).toBe(12.5);
    expect(r.lineTotal).toBe(37.5);
    expect(r.modelId).toBe("m1");
    expect(r.quantity).toBe(3);
    // Convex meta must not leak through.
    expect((r as unknown as Record<string, unknown>)._id).toBeUndefined();
    expect((r as unknown as Record<string, unknown>)._creationTime).toBeUndefined();
  });

  it("defaults absent nullable fields to null and absent scalars to Prisma defaults", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = {
      id: "li2",
      organizationId: "org1",
      projectId: "p1",
      ordinal: 0,
    };
    const r = mapLineItemDoc(doc);
    expect(r.modelId).toBeNull();
    expect(r.assetId).toBeNull();
    expect(r.kitId).toBeNull();
    expect(r.parentLineItemId).toBeNull();
    expect(r.checkedOutAt).toBeNull();
    expect(r.returnedAt).toBeNull();
    expect(r.unitPrice).toBeNull();
    expect(r.subHireId).toBeNull();
    // Prisma scalar defaults.
    expect(r.quantity).toBe(1);
    expect(r.duration).toBe(1);
    expect(r.type).toBe("EQUIPMENT");
    expect(r.pricingType).toBe("PER_DAY");
    expect(r.isKitChild).toBe(false);
    expect(r.priceOverridden).toBe(false);
    expect(r.status).toBe("QUOTED");
    expect(r.checkedOutQuantity).toBe(0);
  });
});

describe("mapUnitDoc", () => {
  it("maps dates and defaults", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = {
      id: "u1",
      organizationId: "org1",
      lineItemId: "li1",
      ordinal: 1,
      assetId: "a1",
      checkedOutAt: EPOCH,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    };
    const r = mapUnitDoc(doc);
    expect(r.assetId).toBe("a1");
    expect(r.bulkAssetId).toBeNull();
    expect(r.quantity).toBe(1);
    expect(r.status).toBe("CONFIRMED");
    expect((r.checkedOutAt as Date).getTime()).toBe(EPOCH);
    expect(r.returnedAt).toBeNull();
  });
});

describe("mapCategoryDoc / mapGroupDoc", () => {
  it("maps category scalars + dates", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = { id: "c1", organizationId: "o", projectId: "p", name: "Audio", sortOrder: 1, createdAt: EPOCH, updatedAt: EPOCH };
    const r = mapCategoryDoc(doc);
    expect(r.name).toBe("Audio");
    expect(r.sortOrder).toBe(1);
    expect((r.createdAt as Date).getTime()).toBe(EPOCH);
  });

  it("maps group money + nullable fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = { id: "g1", organizationId: "o", projectId: "p", title: "Stage", quantity: 2, price: 100, createdAt: EPOCH, updatedAt: EPOCH };
    const r = mapGroupDoc(doc);
    expect(r.title).toBe("Stage");
    expect(r.price).toBe(100);
    expect(r.suggestedPrice).toBeNull();
    expect(r.categoryId).toBeNull();
  });
});
