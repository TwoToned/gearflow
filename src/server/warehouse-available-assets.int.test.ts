/**
 * Integration tests for the batched available-asset read (asset picker load
 * path). getAvailableAssetsForModel now uses ONE listByModelId query instead of
 * a per-asset listByAssetId loop, and getAvailableAssetsForModels fans that over
 * many models in one round-trip. Both must return the same in-use-filtered set.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

const h = vi.hoisted(() => ({ ctx: { organizationId: "", userId: "", userName: "Tester" } }));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { getAvailableAssetsForModel, getAvailableAssetsForModels } from "@/server/warehouse";

async function project(orgId: string, status = "CONFIRMED") {
  return testPrisma.project.create({
    data: { organizationId: orgId, projectNumber: `P-${createId().slice(0, 8)}`, name: "T", taxRate: 0, status: status as never },
  });
}
async function lineForAsset(orgId: string, projectId: string, modelId: string, assetId: string, status: string) {
  return testPrisma.projectLineItem.create({
    data: { organizationId: orgId, projectId, modelId, assetId, quantity: 1, status: status as never },
  });
}

describe("available-asset read — in-use filter + batch parity", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("excludes assets in use on an active project; single == batch", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "AV-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "AV-2" });
    const a3 = await createAssetFixture(org.id, model.id, { assetTag: "AV-3" });

    const proj = await project(org.id, "CONFIRMED");
    // a1 is on an active, non-terminal line → in use.
    await lineForAsset(org.id, proj.id, model.id, a1.id, "CONFIRMED");
    // a2 is on a RETURNED line (terminal, not PACKED) → NOT in use.
    await lineForAsset(org.id, proj.id, model.id, a2.id, "RETURNED");
    // a3 has no line at all → available.

    const single = await getAvailableAssetsForModel(model.id);
    const ids = single.map((r) => r.id).sort();
    expect(ids).toEqual([a2.id, a3.id].sort());
    expect(ids).not.toContain(a1.id);

    const batch = await getAvailableAssetsForModels([model.id]);
    expect(batch[model.id].map((r) => r.id).sort()).toEqual(ids);
  });

  it("batches several models into one map", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const mA = await createModelFixture(org.id);
    const mB = await createModelFixture(org.id);
    const a = await createAssetFixture(org.id, mA.id, { assetTag: "MA-1" });
    const b1 = await createAssetFixture(org.id, mB.id, { assetTag: "MB-1" });
    const b2 = await createAssetFixture(org.id, mB.id, { assetTag: "MB-2" });

    const proj = await project(org.id, "CONFIRMED");
    await lineForAsset(org.id, proj.id, mB.id, b1.id, "CONFIRMED"); // b1 in use

    const map = await getAvailableAssetsForModels([mA.id, mB.id]);
    expect(map[mA.id].map((r) => r.id)).toEqual([a.id]);
    expect(map[mB.id].map((r) => r.id)).toEqual([b2.id]);
    // Each model's result equals the single-model action.
    expect(map[mA.id]).toEqual(await getAvailableAssetsForModel(mA.id));
    expect(map[mB.id]).toEqual(await getAvailableAssetsForModel(mB.id));
  });

  it("empty input returns an empty map (no round-trip needed)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    expect(await getAvailableAssetsForModels([])).toEqual({});
  });
});
