/**
 * Integration tests for child assets / accessories (Phase B).
 *
 * Exercises the real attach/detach server actions against a live DB, with
 * auth + activity-log mocked. The highest-risk logic here is the bulk
 * allocation semantics resolved at the CEO gate:
 *   - SHIPS_WITH: attaching does NOT touch BulkAsset.availableQuantity
 *     (the quantity is drawn live at prep/checkout)
 *   - DEDICATED: attaching decrements the shared pool (guarded) and detaching
 *     restores it
 * Plus the data-integrity guards the eng review flagged (dual membership,
 * self/nesting/already-attached, cross-kit).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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

vi.mock("@/lib/activity-log", () => ({
  logActivity: vi.fn(async () => {}),
}));

import {
  addSerializedChildToAsset,
  addBulkChildToAsset,
  removeSerializedChildFromAsset,
  removeBulkChildFromAsset,
} from "@/server/asset-accessories";
import { addSerializedItemToKit } from "@/server/kits";

async function seed() {
  const org = await createOrgFixture();
  const user = await createUserFixture(org.id);
  h.ctx.organizationId = org.id;
  h.ctx.userId = user.id;
  const model = await createModelFixture(org.id);
  return { org, user, model };
}

describe("child assets / accessories — attach/detach", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("attaches a serialised child and inherits the parent's location", async () => {
    const { org, model } = await seed();
    const loc = await testPrisma.location.create({
      data: { organizationId: org.id, name: "Truss Room" },
    });
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-1", locationId: loc.id });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: "IEC-1" });

    await addSerializedChildToAsset(parent.id, { childAssetId: cable.id });

    const updated = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(updated?.parentAssetId).toBe(parent.id);
    expect(updated?.locationId).toBe(loc.id);
  });

  it("rejects attaching an asset to itself", async () => {
    const { org, model } = await seed();
    const a = await createAssetFixture(org.id, model.id, { assetTag: "A-1" });
    await expect(addSerializedChildToAsset(a.id, { childAssetId: a.id })).rejects.toThrow();
  });

  it("rejects attaching an asset that is already an accessory", async () => {
    const { org, model } = await seed();
    const p1 = await createAssetFixture(org.id, model.id, { assetTag: "P1" });
    const p2 = await createAssetFixture(org.id, model.id, { assetTag: "P2" });
    const child = await createAssetFixture(org.id, model.id, { assetTag: "C1" });
    await addSerializedChildToAsset(p1.id, { childAssetId: child.id });
    await expect(addSerializedChildToAsset(p2.id, { childAssetId: child.id })).rejects.toThrow();
  });

  it("rejects attaching a kit member as an accessory", async () => {
    const { org, model, user } = await seed();
    const kit = await testPrisma.kit.create({ data: { organizationId: org.id, assetTag: "KIT-1", name: "Kit" } });
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "MX-1" });
    const inKit = await createAssetFixture(org.id, model.id, { assetTag: "K-MEMBER", kitId: kit.id });
    void user;
    await expect(addSerializedChildToAsset(parent.id, { childAssetId: inKit.id })).rejects.toThrow();
  });

  it("rejects attaching an asset that itself has accessories (one level deep)", async () => {
    const { org, model } = await seed();
    const grandparent = await createAssetFixture(org.id, model.id, { assetTag: "GP" });
    const middle = await createAssetFixture(org.id, model.id, { assetTag: "MID" });
    const leaf = await createAssetFixture(org.id, model.id, { assetTag: "LEAF" });
    await addSerializedChildToAsset(middle.id, { childAssetId: leaf.id });
    // middle now has a child → it can't become someone else's accessory
    await expect(addSerializedChildToAsset(grandparent.id, { childAssetId: middle.id })).rejects.toThrow();
  });

  it("SHIPS_WITH bulk accessory does NOT touch the shared pool", async () => {
    const { org, model } = await seed();
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-2" });
    const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: "CLAMP", total: 100, available: 100 });

    await addBulkChildToAsset(parent.id, { bulkAssetId: clamps.id, quantity: 2, allocationMode: "SHIPS_WITH" });

    const after = await testPrisma.bulkAsset.findUnique({ where: { id: clamps.id } });
    expect(after?.availableQuantity).toBe(100);
    const child = await testPrisma.assetBulkChild.findFirst({ where: { parentAssetId: parent.id } });
    expect(child?.allocationMode).toBe("SHIPS_WITH");
    expect(child?.quantity).toBe(2);
  });

  it("DEDICATED bulk accessory decrements the pool and restores it on detach", async () => {
    const { org, model } = await seed();
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-3" });
    const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: "CLAMP-D", total: 10, available: 10 });

    const child = await addBulkChildToAsset(parent.id, { bulkAssetId: clamps.id, quantity: 3, allocationMode: "DEDICATED" });
    let after = await testPrisma.bulkAsset.findUnique({ where: { id: clamps.id } });
    expect(after?.availableQuantity).toBe(7);

    await removeBulkChildFromAsset(parent.id, (child as { id: string }).id);
    after = await testPrisma.bulkAsset.findUnique({ where: { id: clamps.id } });
    expect(after?.availableQuantity).toBe(10);
  });

  it("DEDICATED attach fails (and rolls back) when the pool is short", async () => {
    const { org, model } = await seed();
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-4" });
    const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: "CLAMP-S", total: 1, available: 1 });

    await expect(
      addBulkChildToAsset(parent.id, { bulkAssetId: clamps.id, quantity: 5, allocationMode: "DEDICATED" }),
    ).rejects.toThrow();

    const after = await testPrisma.bulkAsset.findUnique({ where: { id: clamps.id } });
    expect(after?.availableQuantity).toBe(1); // unchanged — transaction rolled back
    const child = await testPrisma.assetBulkChild.findFirst({ where: { parentAssetId: parent.id } });
    expect(child).toBeNull();
  });

  it("detaching a serialised child clears parentAssetId", async () => {
    const { org, model } = await seed();
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "P-DETACH" });
    const child = await createAssetFixture(org.id, model.id, { assetTag: "C-DETACH" });
    await addSerializedChildToAsset(parent.id, { childAssetId: child.id });

    await removeSerializedChildFromAsset(parent.id, child.id);
    const after = await testPrisma.asset.findUnique({ where: { id: child.id } });
    expect(after?.parentAssetId).toBeNull();
  });

  it("a serialised accessory cannot then be added to a kit (symmetric guard)", async () => {
    const { org, model } = await seed();
    const kit = await testPrisma.kit.create({ data: { organizationId: org.id, assetTag: "KIT-2", name: "Kit2" } });
    const parent = await createAssetFixture(org.id, model.id, { assetTag: "P-SYM" });
    const child = await createAssetFixture(org.id, model.id, { assetTag: "C-SYM" });
    await addSerializedChildToAsset(parent.id, { childAssetId: child.id });

    await expect(addSerializedItemToKit(kit.id, { assetId: child.id })).rejects.toThrow();
  });
});
