/**
 * Integration tests for model-level bulk accessories — "every asset of this
 * model ships with N of this bulk asset" inheritance.
 *
 * Cases:
 *   - office add of a model-only asset → model accessories auto-expand
 *   - warehouse scan-time assignment → model accessories materialise
 *   - asset-level override wins on bulkAssetId conflict
 *   - duplicate model accessory rejected by unique (modelId, bulkAssetId)
 *   - removing the model accessory after expansion does NOT retroactively
 *     remove children from existing projects
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
  createBulkAssetFixture,
} from "../../tests/helpers/integration";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

import { addLineItem } from "@/server/line-items";
import { checkOutItems } from "@/server/warehouse";
import {
  addModelBulkAccessory,
  removeModelBulkAccessory,
} from "@/server/model-accessories";
import { addBulkChildToAsset } from "@/server/asset-accessories";

async function seed() {
  const org = await createOrgFixture();
  const user = await createUserFixture(org.id);
  h.ctx.organizationId = org.id;
  h.ctx.userId = user.id;
  const model = await createModelFixture(org.id);
  const project = await testPrisma.project.create({
    data: {
      id: createId(),
      organizationId: org.id,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name: "Gig",
    },
  });
  await testPrisma.location.create({
    data: { organizationId: org.id, name: "Warehouse", isDefault: true },
  });
  return { org, user, model, project };
}

describe("model-level bulk accessories — inheritance", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("auto-expands the model's default accessory onto a project when the asset has none", async () => {
    const { org, model, project } = await seed();
    const trueCons = await createBulkAssetFixture(org.id, model.id, { assetTag: "TRUECON", total: 100 });
    await addModelBulkAccessory(model.id, { bulkAssetId: trueCons.id, quantity: 1 });

    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-M1" });
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: (parent as { id: string }).id, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    expect(children[0].bulkAssetId).toBe(trueCons.id);
    expect(children[0].quantity).toBe(1);
  });

  it("model + asset accessories combine; asset-level wins on bulkAssetId conflict", async () => {
    const { org, user, model, project } = await seed();
    const trueCons = await createBulkAssetFixture(org.id, model.id, { assetTag: "TRUECON-2", total: 100 });
    const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: "CLAMP-M2", total: 100 });
    // Model says: 1 trueCon, 2 clamps (default).
    await addModelBulkAccessory(model.id, { bulkAssetId: trueCons.id, quantity: 1 });
    await addModelBulkAccessory(model.id, { bulkAssetId: clamps.id, quantity: 2 });

    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-M2" });
    // Asset-level override: this specific light ships with 4 clamps, not 2.
    await addBulkChildToAsset(light.id, { bulkAssetId: clamps.id, quantity: 4 });
    void user;

    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: (parent as { id: string }).id, childKind: "ACCESSORY" },
    });
    // Two distinct rows: one trueCon (inherited), one clamp (asset-level wins).
    expect(children).toHaveLength(2);
    const clampRow = children.find((c) => c.bulkAssetId === clamps.id);
    const trueConRow = children.find((c) => c.bulkAssetId === trueCons.id);
    expect(clampRow?.quantity).toBe(4); // asset override, NOT 2
    expect(trueConRow?.quantity).toBe(1);
  });

  it("re-scan picks up an asset-level override added AFTER the initial expansion", async () => {
    const { org, model, project } = await seed();
    const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: "CLAMP-RS", total: 100 });
    // Model default: every light of this model ships with 2 clamps.
    await addModelBulkAccessory(model.id, { bulkAssetId: clamps.id, quantity: 2 });
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-RS" });

    // Office adds the specific light → expandAccessoriesForAsset materialises the
    // model default (no asset-level override yet → qty 2).
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
    const parentLineId = (parent as { id: string }).id;
    const before = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY", bulkAssetId: clamps.id },
    });
    expect(before?.quantity).toBe(2);

    // Operator later overrides THIS light to ship 4 clamps (asset-level wins).
    await addBulkChildToAsset(light.id, { bulkAssetId: clamps.id, quantity: 4 });

    // Warehouse re-scans the light at checkout → expandAccessoriesForAsset re-runs,
    // recomputes demand, and updates the existing child row IN PLACE (no duplicate,
    // not stuck at the stale qty 2). Regression guard for the v0.14.0.0 re-scan fix.
    await checkOutItems(project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    expect(children[0].bulkAssetId).toBe(clamps.id);
    expect(children[0].quantity).toBe(4);
    // Same row, updated in place — NOT deleted-and-recreated. Without this the
    // implementation could drop the child and re-insert and the test would
    // still pass; the whole point of the re-scan path is an in-place update.
    expect(children[0].id).toBe(before!.id);
  });

  it("warehouse scan-time assignment also pulls model accessories (idempotent)", async () => {
    const { org, model, project } = await seed();
    const trueCons = await createBulkAssetFixture(org.id, model.id, { assetTag: "TRUECON-3", total: 100 });
    await addModelBulkAccessory(model.id, { bulkAssetId: trueCons.id, quantity: 1 });
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-M3" });

    // Model-level project line (added by model): addLineItem now expands the
    // model's default accessory immediately so it shows on the quote.
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 1 }, true);
    const parentLineId = (parent as { id: string }).id;
    expect(await testPrisma.projectLineItem.count({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    })).toBe(1);

    // Warehouse assigns the specific light at deploy → reconciles the same row,
    // no duplicate (the (parentLineItemId, bulkAssetId) unique index backstops it).
    await checkOutItems(project.id, [{ lineItemId: parentLineId, assetId: light.id }]);
    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    expect(children[0].bulkAssetId).toBe(trueCons.id);

    // Re-scan: idempotent.
    await checkOutItems(project.id, [{ lineItemId: parentLineId, assetId: light.id }]);
    expect(await testPrisma.projectLineItem.count({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    })).toBe(1);
  });

  it("attaching the same bulk to a model twice is rejected by the unique constraint", async () => {
    const { org, model } = await seed();
    const trueCons = await createBulkAssetFixture(org.id, model.id, { assetTag: "TRUECON-4", total: 100 });
    await addModelBulkAccessory(model.id, { bulkAssetId: trueCons.id, quantity: 1 });
    await expect(
      addModelBulkAccessory(model.id, { bulkAssetId: trueCons.id, quantity: 2 }),
    ).rejects.toThrow();
  });

  it("removing the model accessory after an expansion does not retroactively delete project children", async () => {
    const { org, model, project } = await seed();
    const trueCons = await createBulkAssetFixture(org.id, model.id, { assetTag: "TRUECON-5", total: 100 });
    const acc = (await addModelBulkAccessory(model.id, { bulkAssetId: trueCons.id, quantity: 1 })) as { id: string };
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-M5" });
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
    const parentLineId = (parent as { id: string }).id;
    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: parentLineId } })).toBe(1);

    await removeModelBulkAccessory(model.id, acc.id);

    // Past expansion remains — it's a concrete line item now, decoupled from the template.
    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: parentLineId } })).toBe(1);
    // But a new asset of the model added now gets no accessory.
    const light2 = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-M5B" });
    const parent2 = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light2.id, quantity: 1 }, true);
    expect(await testPrisma.projectLineItem.count({
      where: { parentLineItemId: (parent2 as { id: string }).id },
    })).toBe(0);
  });
});
