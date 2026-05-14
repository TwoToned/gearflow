/**
 * Integration tests for the Wave 1.7 T&T compliance gate.
 *
 * The production helper `assertTestTagAllowsCheckout` (in src/server/warehouse.ts)
 * is private — server actions inside "use server" files can't export non-async
 * helpers without bundler complaints. These tests exercise the same Prisma query
 * the helper runs, against a real test DB, to verify the data-shape invariants:
 *
 *  • FAILED / OVERDUE T&T blocks scoped assets/bulks
 *  • AVAILABLE / CURRENT / DUE_SOON / NOT_YET_TESTED do NOT block
 *  • inactive T&T records don't block (isActive=false)
 *  • cross-org T&T records don't block (different org's failure must not leak)
 *  • no T&T records at all = no block
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
  createBulkAssetFixture,
} from "../../tests/helpers/integration";

async function createTestTagFixture(
  orgId: string,
  options: {
    testTagId: string;
    status: "NOT_YET_TESTED" | "CURRENT" | "DUE_SOON" | "OVERDUE" | "FAILED" | "RETIRED";
    assetId?: string;
    bulkAssetId?: string;
    isActive?: boolean;
    nextDueDate?: Date | null;
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
      isActive: options.isActive ?? true,
      nextDueDate: options.nextDueDate ?? null,
    },
  });
}

/** Replicates the exact query the production helper runs. */
async function queryBlockedTestTags(
  orgId: string,
  assetIds: string[],
  bulkAssetIds: string[],
) {
  return testPrisma.testTagAsset.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      status: { in: ["FAILED", "OVERDUE"] },
      OR: [
        ...(assetIds.length > 0 ? [{ assetId: { in: assetIds } }] : []),
        ...(bulkAssetIds.length > 0 ? [{ bulkAssetId: { in: bulkAssetIds } }] : []),
      ],
    },
  });
}

describe("T&T checkout block query (Wave 1.7)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("FAILED T&T on a serialized asset returns a block", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "ASSET-001" });
    await createTestTagFixture(org.id, {
      testTagId: "TT-001",
      status: "FAILED",
      assetId: asset.id,
    });

    const blocks = await queryBlockedTestTags(org.id, [asset.id], []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("FAILED");
    expect(blocks[0].assetId).toBe(asset.id);
  });

  it("OVERDUE T&T on a serialized asset returns a block", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "ASSET-002" });
    await createTestTagFixture(org.id, {
      testTagId: "TT-002",
      status: "OVERDUE",
      assetId: asset.id,
    });

    const blocks = await queryBlockedTestTags(org.id, [asset.id], []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("OVERDUE");
  });

  it("FAILED T&T on a bulk asset returns a block", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "BULK-001",
      total: 10,
    });
    await createTestTagFixture(org.id, {
      testTagId: "TT-BULK-001",
      status: "FAILED",
      bulkAssetId: bulk.id,
    });

    const blocks = await queryBlockedTestTags(org.id, [], [bulk.id]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].bulkAssetId).toBe(bulk.id);
  });

  it.each(["NOT_YET_TESTED", "CURRENT", "DUE_SOON"] as const)(
    "%s T&T does NOT block",
    async (status) => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, {
        assetTag: `ASSET-${status}`,
      });
      await createTestTagFixture(org.id, {
        testTagId: `TT-${status}`,
        status,
        assetId: asset.id,
      });

      const blocks = await queryBlockedTestTags(org.id, [asset.id], []);
      expect(blocks).toHaveLength(0);
    },
  );

  it("inactive (isActive=false) FAILED T&T does NOT block", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "ASSET-INACTIVE" });
    await createTestTagFixture(org.id, {
      testTagId: "TT-INACTIVE",
      status: "FAILED",
      assetId: asset.id,
      isActive: false,
    });

    const blocks = await queryBlockedTestTags(org.id, [asset.id], []);
    expect(blocks).toHaveLength(0);
  });

  it("cross-org FAILED T&T does NOT leak across the org boundary", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    await createUserFixture(orgA.id);
    await createUserFixture(orgB.id);
    const model = await createModelFixture(orgB.id);
    const asset = await createAssetFixture(orgB.id, model.id, { assetTag: "ORGB-ASSET" });
    // Failure record lives on orgB
    await createTestTagFixture(orgB.id, {
      testTagId: "TT-ORGB",
      status: "FAILED",
      assetId: asset.id,
    });

    // orgA queries — must NOT see orgB's failure
    const blocksFromAPerspective = await queryBlockedTestTags(orgA.id, [asset.id], []);
    expect(blocksFromAPerspective).toHaveLength(0);

    // orgB queries — sees its own failure
    const blocksFromBPerspective = await queryBlockedTestTags(orgB.id, [asset.id], []);
    expect(blocksFromBPerspective).toHaveLength(1);
  });

  it("asset with no T&T record at all does NOT block", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "NO-TT" });

    const blocks = await queryBlockedTestTags(org.id, [asset.id], []);
    expect(blocks).toHaveLength(0);
  });

  it("mixed FAILED + AVAILABLE returns only the FAILED rows", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const failedAsset = await createAssetFixture(org.id, model.id, { assetTag: "FAIL" });
    const okAsset = await createAssetFixture(org.id, model.id, { assetTag: "OK" });
    await createTestTagFixture(org.id, {
      testTagId: "TT-FAIL",
      status: "FAILED",
      assetId: failedAsset.id,
    });
    await createTestTagFixture(org.id, {
      testTagId: "TT-OK",
      status: "CURRENT",
      assetId: okAsset.id,
    });

    const blocks = await queryBlockedTestTags(
      org.id,
      [failedAsset.id, okAsset.id],
      [],
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].assetId).toBe(failedAsset.id);
  });
});
