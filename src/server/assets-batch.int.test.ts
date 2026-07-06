/**
 * Integration tests for createAssets' batched insert — proves N assets create in
 * one atomic mutation with the same Convex rows as before, the duplicate-tag
 * guard still fires (existing AND in-batch dupes) and rolls back atomically, and
 * T&T rows are registered when the model requires it.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
} from "../../tests/helpers/integration";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

const h = vi.hoisted(() => ({ ctx: { organizationId: "", userId: "", userName: "Tester" } }));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { createAssets } from "@/server/assets";

async function assetsForModel(orgId: string, modelId: string) {
  const convex = await getConvexClient();
  return convex.query(api.assets.listByModel, { modelId, orgId });
}

const baseData = (modelId: string) => ({ modelId, assetTag: "PLACEHOLDER" }) as never;

describe("createAssets — batched insert", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates N assets with the given tags in one call", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);

    const rows = await createAssets(baseData(model.id), [
      { tag: "BA-1" },
      { tag: "BA-2", serialNumber: "SN2" },
      { tag: "BA-3" },
    ]);
    expect(rows.map((r) => r.assetTag).sort()).toEqual(["BA-1", "BA-2", "BA-3"]);

    const inConvex = await assetsForModel(org.id, model.id);
    expect(inConvex.map((a) => a.assetTag).sort()).toEqual(["BA-1", "BA-2", "BA-3"]);
    expect(inConvex.find((a) => a.assetTag === "BA-2")?.serialNumber).toBe("SN2");
  });

  it("rejects an in-batch duplicate tag and writes nothing (atomic)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);

    await expect(
      createAssets(baseData(model.id), [{ tag: "DUP" }, { tag: "DUP" }]),
    ).rejects.toMatchObject({ code: "DUPLICATE_ASSET_TAG" });

    expect(await assetsForModel(org.id, model.id)).toHaveLength(0);
  });

  it("rejects a tag that already exists", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);

    await createAssets(baseData(model.id), [{ tag: "EXIST" }]);
    await expect(
      createAssets(baseData(model.id), [{ tag: "EXIST" }]),
    ).rejects.toMatchObject({ code: "DUPLICATE_ASSET_TAG" });

    expect(await assetsForModel(org.id, model.id)).toHaveLength(1);
  });

  it("registers a T&T row per asset when the model requires test-and-tag", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await testPrisma.model.create({
      data: { organizationId: org.id, name: "TT Model", requiresTestAndTag: true, testAndTagIntervalDays: 90 },
    });

    await createAssets(baseData(model.id), [{ tag: "TT-1" }, { tag: "TT-2" }]);

    const convex = await getConvexClient();
    const tt = await convex.query(api.testTagAssets.list, { orgId: org.id });
    const tags = tt.map((t: { testTagId: string }) => t.testTagId).filter((t) => t === "TT-1" || t === "TT-2");
    expect(tags.sort()).toEqual(["TT-1", "TT-2"]);
  });
});
