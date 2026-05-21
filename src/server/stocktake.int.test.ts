/**
 * Integration tests for the stocktake / inventory-verification system.
 *
 * `src/server/stocktake.ts` was ported from the old `feat/stocktake`
 * branch with zero dedicated tests. It carries a 4-state machine
 * (IN_PROGRESS → REVIEWING → COMPLETED / CANCELLED) and resolution
 * actions that mutate live inventory — `Asset.status`, `BulkAsset`
 * quantities, `locationId`. A regression here silently corrupts stock.
 *
 * Approach: the server actions gate on `requirePermission` /
 * `getOrgContext`, which need a request scope. We mock `@/lib/org-context`
 * with a mutable hoisted context so the REAL stocktake.ts logic runs
 * against the Postgres test DB. `prisma` (used by the actions) and
 * `testPrisma` (used by fixtures + assertions) hit the same DATABASE_URL.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

// Mutable context the mocked org-context returns. Each test sets it after
// creating its org + user fixtures.
const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import {
  createStocktake,
  startStocktake,
  scanStocktakeItem,
  updateBulkCount,
  completeScanning,
  resolveDiscrepancy,
  bulkResolveDiscrepancies,
  completeStocktake,
  cancelStocktake,
} from "./stocktake";

// ── Fixtures ────────────────────────────────────────────────────────────────

async function createLocation(orgId: string, name = "Main Warehouse") {
  return testPrisma.location.create({
    data: { organizationId: orgId, name, type: "WAREHOUSE" },
  });
}

async function createAssetAt(
  orgId: string,
  modelId: string,
  locationId: string | null,
  options?: { status?: "AVAILABLE" | "IN_MAINTENANCE" | "LOST" | "RETIRED"; assetTag?: string },
) {
  return testPrisma.asset.create({
    data: {
      organizationId: orgId,
      modelId,
      assetTag: options?.assetTag ?? `A-${createId().slice(0, 8)}`,
      status: options?.status ?? "AVAILABLE",
      locationId,
    },
  });
}

async function createBulkAt(
  orgId: string,
  modelId: string,
  locationId: string | null,
  options: { total: number; available?: number; assetTag?: string },
) {
  return testPrisma.bulkAsset.create({
    data: {
      organizationId: orgId,
      modelId,
      assetTag: options.assetTag ?? `B-${createId().slice(0, 8)}`,
      totalQuantity: options.total,
      availableQuantity: options.available ?? options.total,
      locationId,
    },
  });
}

/** Spin up an org + user, point the mocked context at them, return ids. */
async function freshOrg() {
  const org = await createOrgFixture();
  const user = await createUserFixture(org.id);
  h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
  return { orgId: org.id, userId: user.id };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("stocktake — creation + state machine", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("createStocktake pre-populates items for assets + bulk assets at the location", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createAssetAt(orgId, model.id, loc.id);
    await createAssetAt(orgId, model.id, loc.id);
    await createBulkAt(orgId, model.id, loc.id, { total: 50 });
    // An asset at a DIFFERENT location must not be included.
    const otherLoc = await createLocation(orgId, "Other");
    await createAssetAt(orgId, model.id, otherLoc.id);

    const st = await createStocktake({
      name: "Q2 count",
      locationId: loc.id,
      scope: "FULL",
    });

    const fresh = await testPrisma.stocktake.findUniqueOrThrow({
      where: { id: st.id },
      include: { items: true },
    });
    expect(fresh.status).toBe("IN_PROGRESS");
    expect(fresh.items).toHaveLength(3); // 2 assets + 1 bulk, other location excluded
    expect(fresh.expectedCount).toBe(3);
    const bulkItem = fresh.items.find((i) => i.bulkAssetId != null);
    expect(bulkItem?.expectedQuantity).toBe(50); // bulk uses availableQuantity
  });

  it("completeScanning transitions IN_PROGRESS → REVIEWING and marks unfound expected items MISSING", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    const found = await createAssetAt(orgId, model.id, loc.id, { assetTag: "FOUND-1" });
    await createAssetAt(orgId, model.id, loc.id, { assetTag: "MISSING-1" });

    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await scanStocktakeItem({ stocktakeId: st.id, assetTag: "FOUND-1" });
    await completeScanning(st.id);

    const fresh = await testPrisma.stocktake.findUniqueOrThrow({
      where: { id: st.id },
      include: { items: true },
    });
    expect(fresh.status).toBe("REVIEWING");
    expect(fresh.foundCount).toBe(1);
    expect(fresh.missingCount).toBe(1);
    const missingItem = fresh.items.find((i) => i.assetId === found.id ? false : true);
    expect(missingItem?.result).toBe("MISSING");
  });

  it("completeStocktake transitions REVIEWING → COMPLETED with final stats", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createAssetAt(orgId, model.id, loc.id, { assetTag: "X-1" });

    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await scanStocktakeItem({ stocktakeId: st.id, assetTag: "X-1" });
    await completeScanning(st.id);
    await completeStocktake(st.id);

    const fresh = await testPrisma.stocktake.findUniqueOrThrow({ where: { id: st.id } });
    expect(fresh.status).toBe("COMPLETED");
    expect(fresh.completedAt).not.toBeNull();
    expect(fresh.foundCount).toBe(1);
  });

  it("cancelStocktake sets CANCELLED", async () => {
    const { orgId } = await freshOrg();
    const loc = await createLocation(orgId);
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await cancelStocktake(st.id);
    const fresh = await testPrisma.stocktake.findUniqueOrThrow({ where: { id: st.id } });
    expect(fresh.status).toBe("CANCELLED");
  });

  it("cancelStocktake throws on a COMPLETED stocktake", async () => {
    const { orgId } = await freshOrg();
    const loc = await createLocation(orgId);
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await completeScanning(st.id);
    await completeStocktake(st.id);
    await expect(cancelStocktake(st.id)).rejects.toThrow(/completed/i);
  });

  it("completeScanning throws when not IN_PROGRESS", async () => {
    const { orgId } = await freshOrg();
    const loc = await createLocation(orgId);
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await completeScanning(st.id); // → REVIEWING
    await expect(completeScanning(st.id)).rejects.toThrow(/IN_PROGRESS/);
  });

  it("completeStocktake throws when not REVIEWING", async () => {
    const { orgId } = await freshOrg();
    const loc = await createLocation(orgId);
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    // still IN_PROGRESS
    await expect(completeStocktake(st.id)).rejects.toThrow(/REVIEWING/);
  });

  it("startStocktake throws when the stocktake is not DRAFT", async () => {
    // createStocktake makes IN_PROGRESS directly, so start should reject.
    const { orgId } = await freshOrg();
    const loc = await createLocation(orgId);
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await expect(startStocktake(st.id)).rejects.toThrow(/DRAFT/);
  });
});

describe("stocktake — scanning", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("scanning an expected asset marks it found + MATCH", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createAssetAt(orgId, model.id, loc.id, { assetTag: "SCAN-1" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });

    const res = await scanStocktakeItem({ stocktakeId: st.id, assetTag: "SCAN-1" });
    expect(res.found).toBe(true);
    expect(res.result).toBe("MATCH");
    expect(res.isExpected).toBe(true);
    expect(res.alreadyScanned).toBe(false);
  });

  it("scanning an unknown tag throws", async () => {
    const { orgId } = await freshOrg();
    const loc = await createLocation(orgId);
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await expect(
      scanStocktakeItem({ stocktakeId: st.id, assetTag: "DOES-NOT-EXIST" }),
    ).rejects.toThrow(/No asset found/);
  });

  it("scanning an asset not in the expected list creates an UNEXPECTED item", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    // Asset has no location → not picked up by createStocktake's expected set.
    await createAssetAt(orgId, model.id, null, { assetTag: "STRAY-1" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });

    const res = await scanStocktakeItem({ stocktakeId: st.id, assetTag: "STRAY-1" });
    expect(res.isExpected).toBe(false);
    expect(res.result).toBe("UNEXPECTED");
  });

  it("scanning an asset that lives at another location flags WRONG_LOCATION", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    const otherLoc = await createLocation(orgId, "Elsewhere");
    await createAssetAt(orgId, model.id, otherLoc.id, { assetTag: "MOVED-1", status: "AVAILABLE" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });

    const res = await scanStocktakeItem({ stocktakeId: st.id, assetTag: "MOVED-1" });
    expect(res.result).toBe("WRONG_LOCATION");
  });

  it("re-scanning an already-found item is idempotent (alreadyScanned: true)", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createAssetAt(orgId, model.id, loc.id, { assetTag: "DUP-1" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });

    await scanStocktakeItem({ stocktakeId: st.id, assetTag: "DUP-1" });
    const second = await scanStocktakeItem({ stocktakeId: st.id, assetTag: "DUP-1" });
    expect(second.alreadyScanned).toBe(true);

    // Still exactly one item for the asset — no duplicate row.
    const items = await testPrisma.stocktakeItem.findMany({ where: { stocktakeId: st.id } });
    expect(items).toHaveLength(1);
  });

  it("scanning throws when the stocktake is not IN_PROGRESS", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createAssetAt(orgId, model.id, loc.id, { assetTag: "LATE-1" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await completeScanning(st.id); // → REVIEWING
    await expect(
      scanStocktakeItem({ stocktakeId: st.id, assetTag: "LATE-1" }),
    ).rejects.toThrow(/scanning mode/);
  });

  it("rejects scanning into another org's stocktake (cross-org isolation)", async () => {
    // Org A owns the stocktake; org B's context can't reach it.
    const { orgId: orgA } = await freshOrg();
    const model = await createModelFixture(orgA);
    const loc = await createLocation(orgA);
    await createAssetAt(orgA, model.id, loc.id, { assetTag: "A-OWNED" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });

    // Switch context to a different org.
    await freshOrg();
    await expect(
      scanStocktakeItem({ stocktakeId: st.id, assetTag: "A-OWNED" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("stocktake — bulk count classification", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function bulkItemFor(quantity: number) {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createBulkAt(orgId, model.id, loc.id, { total: 100, assetTag: "BULK-1" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    const item = await testPrisma.stocktakeItem.findFirstOrThrow({
      where: { stocktakeId: st.id, bulkAssetId: { not: null } },
    });
    await updateBulkCount({ itemId: item.id, quantity });
    return testPrisma.stocktakeItem.findUniqueOrThrow({ where: { id: item.id } });
  }

  it("counted == expected → MATCH", async () => {
    const item = await bulkItemFor(100);
    expect(item.result).toBe("MATCH");
    expect(item.found).toBe(true);
    expect(item.foundQuantity).toBe(100);
  });

  it("counted == 0 → MISSING", async () => {
    const item = await bulkItemFor(0);
    expect(item.result).toBe("MISSING");
    expect(item.found).toBe(false);
  });

  it("counted != expected and > 0 → QUANTITY_MISMATCH", async () => {
    const item = await bulkItemFor(83);
    expect(item.result).toBe("QUANTITY_MISMATCH");
    expect(item.found).toBe(true);
    expect(item.foundQuantity).toBe(83);
  });
});

describe("stocktake — discrepancy resolution (inventory side effects)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  /** Build a REVIEWING stocktake with one asset + one bulk, nothing scanned. */
  async function reviewingStocktake() {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    const asset = await createAssetAt(orgId, model.id, loc.id, { assetTag: "RES-A" });
    const bulk = await createBulkAt(orgId, model.id, loc.id, { total: 40, assetTag: "RES-B" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await completeScanning(st.id); // → REVIEWING, both items now MISSING
    return { orgId, loc, asset, bulk, st };
  }

  it("MARK_LOST sets the asset status to LOST", async () => {
    const { asset, st } = await reviewingStocktake();
    const item = await testPrisma.stocktakeItem.findFirstOrThrow({
      where: { stocktakeId: st.id, assetId: asset.id },
    });
    await resolveDiscrepancy({ itemId: item.id, action: "MARK_LOST" });

    const after = await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.status).toBe("LOST");
    const itemAfter = await testPrisma.stocktakeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.actionTaken).toMatch(/LOST/);
  });

  it("ADJUST_QUANTITY writes the counted quantity onto the bulk asset", async () => {
    const { bulk, st } = await reviewingStocktake();
    const item = await testPrisma.stocktakeItem.findFirstOrThrow({
      where: { stocktakeId: st.id, bulkAssetId: bulk.id },
    });
    // Counted 30 of an expected 40 → diff -10.
    await updateBulkCount({ itemId: item.id, quantity: 30 });
    await resolveDiscrepancy({ itemId: item.id, action: "ADJUST_QUANTITY" });

    const after = await testPrisma.bulkAsset.findUniqueOrThrow({ where: { id: bulk.id } });
    // 40 + (30 - 40) = 30
    expect(after.availableQuantity).toBe(30);
    expect(after.totalQuantity).toBe(30);
  });

  it("ADJUST_QUANTITY floors quantities at 0 on a large shortfall", async () => {
    const { bulk, st } = await reviewingStocktake();
    const item = await testPrisma.stocktakeItem.findFirstOrThrow({
      where: { stocktakeId: st.id, bulkAssetId: bulk.id },
    });
    // Drop the bulk asset's stock low, then resolve a 0-count against an
    // expected 40 → diff -40, which would drive quantities negative.
    await testPrisma.bulkAsset.update({
      where: { id: bulk.id },
      data: { availableQuantity: 5, totalQuantity: 5 },
    });
    await updateBulkCount({ itemId: item.id, quantity: 0 });
    await resolveDiscrepancy({ itemId: item.id, action: "ADJUST_QUANTITY" });

    const after = await testPrisma.bulkAsset.findUniqueOrThrow({ where: { id: bulk.id } });
    expect(after.availableQuantity).toBe(0);
    expect(after.totalQuantity).toBe(0);
  });

  it("UPDATE_LOCATION rewrites the asset's locationId to the stocktake location", async () => {
    const { orgId, loc, st } = await reviewingStocktake();
    // A stray asset scanned at the wrong location.
    const otherLoc = await createLocation(orgId, "Wrong place");
    const model = await createModelFixture(orgId);
    const stray = await createAssetAt(orgId, model.id, otherLoc.id, { assetTag: "STRAY-X" });
    // Resume so we can scan it as WRONG_LOCATION, then complete again.
    // Simpler: directly create the stray's stocktake item via a scan while IN_PROGRESS.
    // The stocktake is REVIEWING here, so instead create the item directly.
    const item = await testPrisma.stocktakeItem.create({
      data: {
        stocktakeId: st.id,
        assetId: stray.id,
        expectedAtLocation: false,
        expectedQuantity: 0,
        found: true,
        foundQuantity: 1,
        result: "WRONG_LOCATION",
      },
    });
    await resolveDiscrepancy({ itemId: item.id, action: "UPDATE_LOCATION" });

    const after = await testPrisma.asset.findUniqueOrThrow({ where: { id: stray.id } });
    expect(after.locationId).toBe(loc.id);
  });

  it("IGNORE leaves inventory untouched", async () => {
    const { asset, st } = await reviewingStocktake();
    const item = await testPrisma.stocktakeItem.findFirstOrThrow({
      where: { stocktakeId: st.id, assetId: asset.id },
    });
    const before = await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    await resolveDiscrepancy({ itemId: item.id, action: "IGNORE" });
    const after = await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.status).toBe(before.status);
    const itemAfter = await testPrisma.stocktakeItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.actionTaken).toBe("Ignored");
  });

  it("resolveDiscrepancy throws when the stocktake is not REVIEWING", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    await createAssetAt(orgId, model.id, loc.id, { assetTag: "EARLY-1" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    // Still IN_PROGRESS.
    const item = await testPrisma.stocktakeItem.findFirstOrThrow({
      where: { stocktakeId: st.id },
    });
    await expect(
      resolveDiscrepancy({ itemId: item.id, action: "IGNORE" }),
    ).rejects.toThrow(/REVIEWING/);
  });

  it("bulkResolveDiscrepancies MARK_ALL_MISSING_LOST marks every missing asset LOST", async () => {
    const { orgId } = await freshOrg();
    const model = await createModelFixture(orgId);
    const loc = await createLocation(orgId);
    const a1 = await createAssetAt(orgId, model.id, loc.id, { assetTag: "BR-1" });
    const a2 = await createAssetAt(orgId, model.id, loc.id, { assetTag: "BR-2" });
    const st = await createStocktake({ name: "c", locationId: loc.id, scope: "FULL" });
    await completeScanning(st.id); // both unscanned → MISSING, status REVIEWING

    await bulkResolveDiscrepancies({ stocktakeId: st.id, action: "MARK_ALL_MISSING_LOST" });

    const after1 = await testPrisma.asset.findUniqueOrThrow({ where: { id: a1.id } });
    const after2 = await testPrisma.asset.findUniqueOrThrow({ where: { id: a2.id } });
    expect(after1.status).toBe("LOST");
    expect(after2.status).toBe("LOST");
  });
});
