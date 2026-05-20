/**
 * Integration tests for reservation conflict detection + swap (Wave 3).
 *
 * Invariants under test:
 *   - findProjectConflictsCore returns a row only when the same serialized
 *     asset is booked on another live project with an overlapping window
 *   - non-overlapping windows don't conflict
 *   - CANCELLED / RETURNED / COMPLETED / INVOICED projects don't conflict
 *   - dateless projects produce no conflicts
 *   - findSwapCandidatesCore returns same-model assets free in the window,
 *     excludes the current asset, kit assets, retired/lost, and assets
 *     booked on an overlapping live project
 *   - swapLineItemAssetCore reassigns the asset, re-checks the window,
 *     rejects different-model / kit / retired targets and races
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import {
  findProjectConflictsCore,
  findSwapCandidatesCore,
  swapLineItemAssetCore,
} from "@/lib/reservation-conflicts";

async function createProject(
  orgId: string,
  start: Date | null,
  end: Date | null,
  status:
    | "ENQUIRY"
    | "CONFIRMED"
    | "CANCELLED"
    | "RETURNED"
    | "COMPLETED"
    | "INVOICED" = "CONFIRMED",
) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
      status,
      rentalStartDate: start,
      rentalEndDate: end,
    },
  });
}

async function addLineItem(
  orgId: string,
  projectId: string,
  modelId: string,
  assetId: string | null,
  status: "QUOTED" | "CONFIRMED" | "CANCELLED" = "CONFIRMED",
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      modelId,
      assetId,
      type: "EQUIPMENT",
      quantity: 1,
      unitPrice: 100,
      duration: 1,
      pricingType: "FLAT",
      lineTotal: 100,
      status,
    },
  });
}

describe("findProjectConflictsCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("flags an asset booked on two overlapping live projects", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "A1" });

    const projA = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const projB = await createProject(org.id, new Date("2026-06-05"), new Date("2026-06-15"));
    await addLineItem(org.id, projA.id, model.id, asset.id);
    await addLineItem(org.id, projB.id, model.id, asset.id);

    const conflicts = await findProjectConflictsCore(projA.id, org.id);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assetId).toBe(asset.id);
    expect(conflicts[0].conflictingProject.id).toBe(projB.id);
  });

  it("does NOT flag non-overlapping windows", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "A1" });

    const projA = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const projB = await createProject(org.id, new Date("2026-07-01"), new Date("2026-07-10"));
    await addLineItem(org.id, projA.id, model.id, asset.id);
    await addLineItem(org.id, projB.id, model.id, asset.id);

    const conflicts = await findProjectConflictsCore(projA.id, org.id);
    expect(conflicts).toHaveLength(0);
  });

  it.each(["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] as const)(
    "does NOT flag against a %s project",
    async (deadStatus) => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, { assetTag: "A1" });

      const projA = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
      const projB = await createProject(org.id, new Date("2026-06-05"), new Date("2026-06-15"), deadStatus);
      await addLineItem(org.id, projA.id, model.id, asset.id);
      await addLineItem(org.id, projB.id, model.id, asset.id);

      const conflicts = await findProjectConflictsCore(projA.id, org.id);
      expect(conflicts).toHaveLength(0);
    },
  );

  it("produces no conflicts for a dateless project", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "A1" });

    const projA = await createProject(org.id, null, null);
    const projB = await createProject(org.id, new Date("2026-06-05"), new Date("2026-06-15"));
    await addLineItem(org.id, projA.id, model.id, asset.id);
    await addLineItem(org.id, projB.id, model.id, asset.id);

    const conflicts = await findProjectConflictsCore(projA.id, org.id);
    expect(conflicts).toHaveLength(0);
  });

  it("ignores CANCELLED line items on the other project", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "A1" });

    const projA = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const projB = await createProject(org.id, new Date("2026-06-05"), new Date("2026-06-15"));
    await addLineItem(org.id, projA.id, model.id, asset.id);
    await addLineItem(org.id, projB.id, model.id, asset.id, "CANCELLED");

    const conflicts = await findProjectConflictsCore(projA.id, org.id);
    expect(conflicts).toHaveLength(0);
  });
});

describe("findSwapCandidatesCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns same-model assets free in the window", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const booked = await createAssetFixture(org.id, model.id, { assetTag: "BOOKED" });
    const free1 = await createAssetFixture(org.id, model.id, { assetTag: "FREE1" });
    const free2 = await createAssetFixture(org.id, model.id, { assetTag: "FREE2" });

    const proj = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const li = await addLineItem(org.id, proj.id, model.id, booked.id);

    const candidates = await findSwapCandidatesCore(li.id, org.id);
    const ids = candidates.map((c) => c.assetId).sort();
    expect(ids).toEqual([free1.id, free2.id].sort());
  });

  it("excludes assets booked on an overlapping live project", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const booked = await createAssetFixture(org.id, model.id, { assetTag: "BOOKED" });
    const alsoBooked = await createAssetFixture(org.id, model.id, { assetTag: "BUSY" });
    const free = await createAssetFixture(org.id, model.id, { assetTag: "FREE" });

    const proj = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const li = await addLineItem(org.id, proj.id, model.id, booked.id);

    // alsoBooked is on another overlapping project
    const other = await createProject(org.id, new Date("2026-06-05"), new Date("2026-06-12"));
    await addLineItem(org.id, other.id, model.id, alsoBooked.id);

    const candidates = await findSwapCandidatesCore(li.id, org.id);
    expect(candidates.map((c) => c.assetId)).toEqual([free.id]);
  });

  it("excludes retired / lost / kit assets", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const booked = await createAssetFixture(org.id, model.id, { assetTag: "BOOKED" });
    await createAssetFixture(org.id, model.id, { assetTag: "RETIRED", status: "RETIRED" });
    await createAssetFixture(org.id, model.id, { assetTag: "LOST", status: "LOST" });
    const free = await createAssetFixture(org.id, model.id, { assetTag: "FREE" });

    const proj = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const li = await addLineItem(org.id, proj.id, model.id, booked.id);

    const candidates = await findSwapCandidatesCore(li.id, org.id);
    expect(candidates.map((c) => c.assetId)).toEqual([free.id]);
  });
});

describe("swapLineItemAssetCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("reassigns the line item to the new asset", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const oldAsset = await createAssetFixture(org.id, model.id, { assetTag: "OLD" });
    const newAsset = await createAssetFixture(org.id, model.id, { assetTag: "NEW" });

    const proj = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const li = await addLineItem(org.id, proj.id, model.id, oldAsset.id);

    const result = await swapLineItemAssetCore(li.id, newAsset.id, org.id);
    expect(result.assetId).toBe(newAsset.id);

    const reread = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: li.id },
    });
    expect(reread.assetId).toBe(newAsset.id);
  });

  it("rejects a different-model target", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const modelA = await createModelFixture(org.id);
    const modelB = await createModelFixture(org.id);
    const oldAsset = await createAssetFixture(org.id, modelA.id, { assetTag: "OLD" });
    const wrongModel = await createAssetFixture(org.id, modelB.id, { assetTag: "WRONG" });

    const proj = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const li = await addLineItem(org.id, proj.id, modelA.id, oldAsset.id);

    await expect(
      swapLineItemAssetCore(li.id, wrongModel.id, org.id),
    ).rejects.toThrow(/different model/i);
  });

  it("rejects a target that's booked in the window (race guard)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const oldAsset = await createAssetFixture(org.id, model.id, { assetTag: "OLD" });
    const raced = await createAssetFixture(org.id, model.id, { assetTag: "RACED" });

    const proj = await createProject(org.id, new Date("2026-06-01"), new Date("2026-06-10"));
    const li = await addLineItem(org.id, proj.id, model.id, oldAsset.id);

    // Someone books `raced` on an overlapping project between list + click.
    const other = await createProject(org.id, new Date("2026-06-03"), new Date("2026-06-08"));
    await addLineItem(org.id, other.id, model.id, raced.id);

    await expect(
      swapLineItemAssetCore(li.id, raced.id, org.id),
    ).rejects.toThrow(/just booked/i);
  });
});
