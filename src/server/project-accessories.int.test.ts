/**
 * Integration tests for accessories on a project (Phase D).
 *
 * When a serialised asset with permanent accessories is added to a project,
 * its accessories must auto-expand into child line items (isKitChild:true +
 * childKind:ACCESSORY + parentLineItemId), excluded from totals, removed only
 * via the parent, and cascade-deleted with it.
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

import { addLineItem, removeLineItem } from "@/server/line-items";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/** Local setup helper — the model-accessories server action was deleted in Phase 3
 *  (writes are browser-direct now). This inserts the same modelBulkAccessories row via
 *  the Convex service client so the project-expansion assertions below are unchanged. */
async function addModelBulkAccessory(
  modelId: string,
  data: { bulkAssetId: string; quantity: number },
) {
  const convex = await getConvexClient();
  await convex.mutation(api.modelBulkAccessories.create, {
    id: createId(),
    organizationId: h.ctx.organizationId,
    modelId,
    bulkAssetId: data.bulkAssetId,
    quantity: data.quantity,
    sortOrder: 0,
    addedAt: Date.now(),
    addedById: h.ctx.userId,
  });
}

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
      name: "Test Project",
    },
  });
  return { org, user, model, project };
}

describe("accessories on a project (Phase D)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("auto-expands a serialised + bulk accessory into child lines on add", async () => {
    const { org, model, user, project } = await seed();
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-D1" });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: "IEC-D1" });
    const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: "CLAMP-D1", total: 50 });

    // Attach: 1 serialised cable + 2 bulk clamps
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });
    await testPrisma.assetBulkChild.create({
      data: { organizationId: org.id, parentAssetId: light.id, bulkAssetId: clamps.id, quantity: 2, addedById: user.id },
    });

    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: (parent as { id: string }).id },
      orderBy: { sortOrder: "asc" },
    });
    expect(children).toHaveLength(2);
    for (const c of children) {
      expect(c.isKitChild).toBe(true);
      expect(c.childKind).toBe("ACCESSORY");
      expect(c.unitPrice).toBeNull();
    }
    const serial = children.find((c) => c.assetId === cable.id);
    const bulk = children.find((c) => c.bulkAssetId === clamps.id);
    expect(serial).toBeTruthy();
    expect(bulk?.quantity).toBe(2);
  });

  it("expands a MODEL's accessories when added by model (no specific asset)", async () => {
    // The common quoting flow: a model-level accessory (every IMX6A ships a Micon
    // adaptor) added to a project BY MODEL — not by scanning a specific tag.
    const { org, model, project } = await seed();
    const micon = await createBulkAssetFixture(org.id, model.id, { assetTag: "MICON-1", total: 50 });
    await addModelBulkAccessory(model.id, { bulkAssetId: micon.id, quantity: 1 });

    // Add "2x <model>" by MODEL — assetId is intentionally absent.
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 2 }, true);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: (parent as { id: string }).id, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    const adaptor = children[0];
    expect(adaptor.bulkAssetId).toBe(micon.id);
    // 2 units x 1 adaptor each = 2.
    expect(adaptor.quantity).toBe(2);
    expect(adaptor.isKitChild).toBe(true);
    expect(adaptor.assetId).toBeNull();
  });

  it("does not expand accessories for a model with none", async () => {
    const { model, project } = await seed();
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 1 }, true);
    const children = await testPrisma.projectLineItem.count({
      where: { parentLineItemId: (parent as { id: string }).id, childKind: "ACCESSORY" },
    });
    expect(children).toBe(0);
  });

  it("an asset with no accessories adds a lone line (no children)", async () => {
    const { org, model, project } = await seed();
    const plain = await createAssetFixture(org.id, model.id, { assetTag: "PLAIN-D1" });
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: plain.id, quantity: 1 }, true);
    const children = await testPrisma.projectLineItem.findMany({ where: { parentLineItemId: (parent as { id: string }).id } });
    expect(children).toHaveLength(0);
  });

  it("removing the parent line cascade-deletes accessory children", async () => {
    const { org, model, project } = await seed();
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-D2" });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: "IEC-D2", });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
    const parentId = (parent as { id: string }).id;
    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: parentId } })).toBe(1);

    await removeLineItem(parentId);
    expect(await testPrisma.projectLineItem.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("an accessory child line cannot be removed directly", async () => {
    const { org, model, project } = await seed();
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-D3" });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: "IEC-D3" });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
    const child = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: (parent as { id: string }).id },
    });
    await expect(removeLineItem(child!.id)).rejects.toThrow();
  });

  it("accessory children are excluded from project totals", async () => {
    const { org, model, project } = await seed();
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-D4" });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: "IEC-D4" });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    // Parent line priced at 100; accessory unpriced.
    await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1, unitPrice: 100, pricingType: "FLAT" }, true);

    const after = await testPrisma.project.findUnique({ where: { id: project.id }, select: { equipmentRevenue: true } });
    // Only the parent's 100 counts — accessory child contributes nothing.
    expect(Number(after?.equipmentRevenue ?? 0)).toBe(100);
  });
});
