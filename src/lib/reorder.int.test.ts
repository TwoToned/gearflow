/**
 * Integration tests for reorder dashboard (Wave 3).
 *
 * Invariants under test:
 *   - getReorderCandidatesCore returns only bulk assets where
 *     reorderThreshold > 0 AND availableQuantity <= reorderThreshold
 *   - items with reorderThreshold null or 0 are excluded
 *   - inactive bulk assets are excluded
 *   - suggested quantity = ceil(threshold × 1.5) − available, min 1
 *   - createReorderDraftCore creates a DRAFT SupplierOrder + items
 *   - lastReorderedAt is stamped on each ordered bulk asset
 *   - cross-org isolation on both create and read
 *   - empty lines or missing supplier rejected
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import {
  getReorderCandidatesCore,
  createReorderDraftCore,
} from "@/lib/reorder";

async function createSupplierFixture(orgId: string, name?: string) {
  return testPrisma.supplier.create({
    data: {
      organizationId: orgId,
      name: name ?? `Supplier ${createId().slice(0, 8)}`,
    },
  });
}

async function createBulkAssetFixture(
  orgId: string,
  modelId: string,
  options: {
    assetTag?: string;
    total: number;
    available?: number;
    reorderThreshold?: number | null;
    preferredSupplierId?: string;
    isActive?: boolean;
  },
) {
  return testPrisma.bulkAsset.create({
    data: {
      organizationId: orgId,
      modelId,
      assetTag: options.assetTag ?? `B-${createId().slice(0, 8)}`,
      totalQuantity: options.total,
      availableQuantity: options.available ?? options.total,
      reorderThreshold: options.reorderThreshold ?? null,
      preferredSupplierId: options.preferredSupplierId ?? null,
      isActive: options.isActive ?? true,
    },
  });
}

describe("getReorderCandidatesCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns items where availableQuantity <= reorderThreshold", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);

    // At threshold → included
    const atThreshold = await createBulkAssetFixture(org.id, model.id, {
      total: 20,
      available: 10,
      reorderThreshold: 10,
    });
    // Below threshold → included
    const below = await createBulkAssetFixture(org.id, model.id, {
      total: 20,
      available: 3,
      reorderThreshold: 10,
    });
    // Above threshold → excluded
    await createBulkAssetFixture(org.id, model.id, {
      total: 20,
      available: 15,
      reorderThreshold: 10,
    });

    const result = await getReorderCandidatesCore(org.id);
    const ids = result.map((r) => r.bulkAssetId).sort();
    expect(ids).toEqual([atThreshold.id, below.id].sort());
  });

  it("excludes items with null reorderThreshold (not configured)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);

    await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 1, // would qualify if threshold were set
      reorderThreshold: null,
    });

    const result = await getReorderCandidatesCore(org.id);
    expect(result).toHaveLength(0);
  });

  it("excludes items with reorderThreshold = 0", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);

    await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 0,
      reorderThreshold: 0, // "no reorder configured" signal
    });

    const result = await getReorderCandidatesCore(org.id);
    expect(result).toHaveLength(0);
  });

  it("excludes inactive bulk assets", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);

    await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 1,
      reorderThreshold: 10,
      isActive: false,
    });

    const result = await getReorderCandidatesCore(org.id);
    expect(result).toHaveLength(0);
  });

  it("suggestedOrderQuantity = ceil(threshold × 1.5) − available, min 1", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);

    // threshold 10, available 3 → target 15, suggest 12
    const a = await createBulkAssetFixture(org.id, model.id, {
      total: 20,
      available: 3,
      reorderThreshold: 10,
    });
    // threshold 6, available 6 → target 9 (ceil 6×1.5), suggest 3
    const b = await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 6,
      reorderThreshold: 6,
    });
    // threshold 5, available 5 → target 8 (ceil 5×1.5=7.5→8), suggest 3
    const c = await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 5,
      reorderThreshold: 5,
    });

    const result = await getReorderCandidatesCore(org.id);
    const byId = new Map(result.map((r) => [r.bulkAssetId, r]));
    expect(byId.get(a.id)?.suggestedOrderQuantity).toBe(12);
    expect(byId.get(b.id)?.suggestedOrderQuantity).toBe(3);
    expect(byId.get(c.id)?.suggestedOrderQuantity).toBe(3);
  });

  it("isolates by organization", async () => {
    const orgA = await createOrgFixture();
    const orgB = await createOrgFixture();
    await createUserFixture(orgA.id);
    const modelA = await createModelFixture(orgA.id);
    const modelB = await createModelFixture(orgB.id);

    await createBulkAssetFixture(orgA.id, modelA.id, {
      total: 10,
      available: 1,
      reorderThreshold: 5,
    });
    await createBulkAssetFixture(orgB.id, modelB.id, {
      total: 10,
      available: 1,
      reorderThreshold: 5,
    });

    const resultA = await getReorderCandidatesCore(orgA.id);
    expect(resultA).toHaveLength(1);
    const resultB = await getReorderCandidatesCore(orgB.id);
    expect(resultB).toHaveLength(1);
    // Cross-org leak would show 2 in one of them
  });

  it("includes preferred supplier when set", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const supplier = await createSupplierFixture(org.id, "Acme Cables");

    await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 1,
      reorderThreshold: 5,
      preferredSupplierId: supplier.id,
    });

    const result = await getReorderCandidatesCore(org.id);
    expect(result[0].preferredSupplier).toEqual({
      id: supplier.id,
      name: "Acme Cables",
    });
  });
});

describe("createReorderDraftCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates a DRAFT supplier order with items + stamps lastReorderedAt", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const supplier = await createSupplierFixture(org.id);

    const bulk1 = await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 2,
      reorderThreshold: 5,
    });
    const bulk2 = await createBulkAssetFixture(org.id, model.id, {
      total: 10,
      available: 0,
      reorderThreshold: 5,
    });

    const result = await createReorderDraftCore({
      organizationId: org.id,
      userId: user.id,
      supplierId: supplier.id,
      lines: [
        { bulkAssetId: bulk1.id, quantity: 10 },
        { bulkAssetId: bulk2.id, quantity: 15, unitPrice: 4.5 },
      ],
    });

    const order = await testPrisma.supplierOrder.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    expect(order.type).toBe("PURCHASE");
    expect(order.status).toBe("DRAFT");
    expect(order.orderNumber).toMatch(/^REORDER-/);
    expect(order.items).toHaveLength(2);

    const item1 = order.items.find((i) => i.modelId === model.id && i.quantity === 10);
    const item2 = order.items.find((i) => i.modelId === model.id && i.quantity === 15);
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
    expect(Number(item2!.unitPrice)).toBe(4.5);
    expect(Number(item2!.lineTotal)).toBe(67.5); // 15 × 4.5

    // Both bulk assets got their lastReorderedAt stamped
    const after1 = await testPrisma.bulkAsset.findUniqueOrThrow({
      where: { id: bulk1.id },
    });
    const after2 = await testPrisma.bulkAsset.findUniqueOrThrow({
      where: { id: bulk2.id },
    });
    expect(after1.lastReorderedAt).not.toBeNull();
    expect(after2.lastReorderedAt).not.toBeNull();
  });

  it("rejects empty line list", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const supplier = await createSupplierFixture(org.id);

    await expect(
      createReorderDraftCore({
        organizationId: org.id,
        userId: user.id,
        supplierId: supplier.id,
        lines: [],
      }),
    ).rejects.toThrow(/At least one line item/);
  });

  it("rejects cross-org supplier", async () => {
    const orgA = await createOrgFixture();
    const orgB = await createOrgFixture();
    const userA = await createUserFixture(orgA.id);
    const modelA = await createModelFixture(orgA.id);
    const supplierB = await createSupplierFixture(orgB.id);
    const bulkA = await createBulkAssetFixture(orgA.id, modelA.id, {
      total: 10,
      available: 1,
      reorderThreshold: 5,
    });

    await expect(
      createReorderDraftCore({
        organizationId: orgA.id,
        userId: userA.id,
        supplierId: supplierB.id, // belongs to org B!
        lines: [{ bulkAssetId: bulkA.id, quantity: 5 }],
      }),
    ).rejects.toThrow(/Supplier not found/);
  });

  it("rejects cross-org bulk asset in lines", async () => {
    const orgA = await createOrgFixture();
    const orgB = await createOrgFixture();
    const userA = await createUserFixture(orgA.id);
    const modelB = await createModelFixture(orgB.id);
    const supplierA = await createSupplierFixture(orgA.id);
    const bulkB = await createBulkAssetFixture(orgB.id, modelB.id, {
      total: 10,
      available: 1,
      reorderThreshold: 5,
    });

    await expect(
      createReorderDraftCore({
        organizationId: orgA.id,
        userId: userA.id,
        supplierId: supplierA.id,
        lines: [{ bulkAssetId: bulkB.id, quantity: 5 }],
      }),
    ).rejects.toThrow(/items could not be found/);
  });
});
