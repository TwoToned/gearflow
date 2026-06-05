/**
 * Integration tests for two P1 warehouse safety fixes (fix/warehouse-tenant-tt-safety):
 *
 *  1. Cross-tenant write guard — `checkOutItems` re-scopes the scanned
 *     `assetId` to the caller's org. A caller must not be able to flip the
 *     status/location of another tenant's asset by scanning its id onto their
 *     own line item.
 *
 *  2. Accessory T&T compliance gate — accessory child lines are materialised
 *     AFTER the top-level checkout preflight (or live on separate line ids it
 *     never sees), so a failed/overdue accessory used to ship ungated. The
 *     gate now runs inside `checkoutAccessoryChildren` and rolls back the
 *     whole batch on a block.
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

async function createTestTagFixture(
  orgId: string,
  options: {
    testTagId: string;
    status: "NOT_YET_TESTED" | "CURRENT" | "DUE_SOON" | "OVERDUE" | "FAILED" | "RETIRED";
    assetId?: string;
    bulkAssetId?: string;
  },
) {
  return testPrisma.testTagAsset.create({
    data: {
      organizationId: orgId,
      testTagId: options.testTagId,
      description: `Test tag ${options.testTagId}`,
      status: options.status,
      assetId: options.assetId ?? null,
      bulkAssetId: options.bulkAssetId ?? null,
      isActive: true,
    },
  });
}

async function makeProject(orgId: string) {
  await testPrisma.location.create({
    data: { organizationId: orgId, name: "Warehouse", isDefault: true },
  });
  const location = await testPrisma.location.create({
    data: { organizationId: orgId, name: "Venue", isDefault: false },
  });
  return testPrisma.project.create({
    data: {
      id: createId(),
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name: "Gig",
      locationId: location.id,
    },
  });
}

describe("checkOutItems — cross-tenant write guard", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("rejects scanning another org's asset onto a line and does not mutate it", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id);
    await createUserFixture(orgB.id);

    // Caller acts as orgA.
    h.ctx.organizationId = orgA.id;
    h.ctx.userId = userA.id;

    const modelA = await createModelFixture(orgA.id);
    const modelB = await createModelFixture(orgB.id);
    // The victim asset lives in orgB.
    const victim = await createAssetFixture(orgB.id, modelB.id, { assetTag: "ORGB-VICTIM" });

    const project = await makeProject(orgA.id);
    // A model-level line in orgA (no specific asset) so targetAssetId comes
    // purely from the untrusted scan payload.
    const line = (await addLineItem(
      project.id,
      { type: "EQUIPMENT", modelId: modelA.id, quantity: 1 },
      true,
    )) as { id: string };

    await expect(
      checkOutItems(project.id, [{ lineItemId: line.id, assetId: victim.id }]),
    ).rejects.toThrow(/not found in this organization/i);

    // The victim asset must be untouched.
    const after = await testPrisma.asset.findUnique({ where: { id: victim.id } });
    expect(after?.status).toBe("AVAILABLE");
  });
});

describe("checkOutItems — accessory T&T compliance gate", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("blocks checkout when a serialised accessory has a FAILED T&T, rolling back the parent", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx.organizationId = org.id;
    h.ctx.userId = user.id;

    const model = await createModelFixture(org.id);
    const project = await makeProject(org.id);

    const light = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-${createId().slice(0, 4)}` });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: `IEC-${createId().slice(0, 4)}` });
    // cable is a permanent accessory of light.
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });
    // The accessory itself has a FAILED Test & Tag — must block the parent's checkout.
    await createTestTagFixture(org.id, { testTagId: "TT-CABLE", status: "FAILED", assetId: cable.id });

    const parent = (await addLineItem(
      project.id,
      { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 },
      true,
    )) as { id: string };

    await expect(
      checkOutItems(project.id, [{ lineItemId: parent.id, assetId: light.id }]),
    ).rejects.toBeTruthy();

    // Whole batch rolled back — neither parent nor accessory shipped.
    const lightAfter = await testPrisma.asset.findUnique({ where: { id: light.id } });
    const cableAfter = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(lightAfter?.status).toBe("AVAILABLE");
    expect(cableAfter?.status).toBe("AVAILABLE");
  });

  it("allows checkout when the accessory's T&T is current", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx.organizationId = org.id;
    h.ctx.userId = user.id;

    const model = await createModelFixture(org.id);
    const project = await makeProject(org.id);

    const light = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-${createId().slice(0, 4)}` });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: `IEC-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });
    await createTestTagFixture(org.id, { testTagId: "TT-CABLE-OK", status: "CURRENT", assetId: cable.id });

    const parent = (await addLineItem(
      project.id,
      { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 },
      true,
    )) as { id: string };

    await checkOutItems(project.id, [{ lineItemId: parent.id, assetId: light.id }]);

    const lightAfter = await testPrisma.asset.findUnique({ where: { id: light.id } });
    const cableAfter = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(lightAfter?.status).toBe("CHECKED_OUT");
    expect(cableAfter?.status).toBe("CHECKED_OUT");
  });
});
