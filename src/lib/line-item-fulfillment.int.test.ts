/**
 * Focused integration tests for `returnLineUnits` — the canonical
 * "what does returning mean physically" helper. These run against the
 * Postgres test DB directly: they seed the deployed unit rows by hand
 * and call `returnLineUnits` inside a transaction, so the partial-
 * quantity branch is verified WITHOUT the Convex mirror that the
 * checkInItems/checkOutItems wrappers depend on.
 *
 * Regression target: a single order line of N identical serialised
 * units (e.g. "SM58 x4") has no line-level assetId and no bulkAssetId,
 * so a quantity-only return falls into the whole-line branch. That
 * branch used to ignore `quantity` and flip EVERY still-out unit — so
 * ticking one of four in the warehouse returned all four. It must flip
 * exactly the requested count.
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
import { returnLineUnits } from "@/lib/line-item-fulfillment";

async function seedDeployedLine(orgId: string, units: number) {
  const model = await createModelFixture(orgId);
  const project = await testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
    },
  });
  const line = await testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId: project.id,
      modelId: model.id,
      quantity: units,
      status: "CHECKED_OUT",
      checkedOutQuantity: units,
    },
  });
  const seeded = [];
  for (let i = 0; i < units; i++) {
    const asset = await createAssetFixture(orgId, model.id, {
      assetTag: `U${i}-${createId().slice(0, 6)}`,
      status: "CHECKED_OUT",
    });
    const unit = await testPrisma.projectLineItemUnit.create({
      data: {
        organizationId: orgId,
        lineItemId: line.id,
        ordinal: i,
        assetId: asset.id,
        quantity: 1,
        status: "CHECKED_OUT",
      },
    });
    seeded.push({ asset, unit });
  }
  return { project, line, seeded };
}

describe("returnLineUnits — partial quantity on a multi-unit serialised line", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("quantity:1 flips exactly one unit (lowest ordinal), leaving the rest out", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line, seeded } = await seedDeployedLine(org.id, 4);

    const res = await testPrisma.$transaction((tx) =>
      returnLineUnits(tx, {
        organizationId: org.id,
        projectId: project.id,
        lineItemId: line.id,
        returnCondition: "GOOD",
        quantity: 1,
        userId: user.id,
        defaultLocationId: null,
      }),
    );

    expect(res.unitsFlipped).toBe(1);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
      orderBy: { ordinal: "asc" },
    });
    expect(units.filter((u) => u.status === "RETURNED")).toHaveLength(1);
    expect(units.filter((u) => u.status === "CHECKED_OUT")).toHaveLength(3);
    // Lowest ordinal is the one returned.
    expect(units[0].status).toBe("RETURNED");

    // Exactly one physical asset came back; three stay out.
    const assetIds = seeded.map((s) => s.asset.id);
    const assets = await testPrisma.asset.findMany({
      where: { id: { in: assetIds } },
    });
    expect(assets.filter((a) => a.status === "AVAILABLE")).toHaveLength(1);
    expect(assets.filter((a) => a.status === "CHECKED_OUT")).toHaveLength(3);
  });

  it("quantity:2 flips exactly two units", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line } = await seedDeployedLine(org.id, 4);

    const res = await testPrisma.$transaction((tx) =>
      returnLineUnits(tx, {
        organizationId: org.id,
        projectId: project.id,
        lineItemId: line.id,
        returnCondition: "GOOD",
        quantity: 2,
        userId: user.id,
        defaultLocationId: null,
      }),
    );

    expect(res.unitsFlipped).toBe(2);
    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units.filter((u) => u.status === "RETURNED")).toHaveLength(2);
    expect(units.filter((u) => u.status === "CHECKED_OUT")).toHaveLength(2);
  });

  it("no quantity still returns the whole line (every still-out unit)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line } = await seedDeployedLine(org.id, 4);

    const res = await testPrisma.$transaction((tx) =>
      returnLineUnits(tx, {
        organizationId: org.id,
        projectId: project.id,
        lineItemId: line.id,
        returnCondition: "GOOD",
        userId: user.id,
        defaultLocationId: null,
      }),
    );

    expect(res.unitsFlipped).toBe(4);
    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units.every((u) => u.status === "RETURNED")).toBe(true);
  });

  it("quantity larger than what's out caps at the still-out count", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line } = await seedDeployedLine(org.id, 3);

    const res = await testPrisma.$transaction((tx) =>
      returnLineUnits(tx, {
        organizationId: org.id,
        projectId: project.id,
        lineItemId: line.id,
        returnCondition: "GOOD",
        quantity: 10,
        userId: user.id,
        defaultLocationId: null,
      }),
    );

    expect(res.unitsFlipped).toBe(3);
  });
});

import { prepUnit } from "@/lib/line-item-fulfillment";

describe("prepUnit — per-asset prep on a multi-unit serialised line", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  // The prep-side mirror of the return bug: a multi-qty serialised line with
  // no chosen asset hits prepUnit's generic branch, which flips the WHOLE line
  // to PACKED ignoring quantity ("prep one, all four move"). The warehouse UI
  // is supposed to route serialised lines through the asset picker so each
  // ticked unit preps with a specific asset (this test) — the misroute that
  // sent them to the generic branch (assetType absent from the Convex mirror)
  // is fixed in handlePrepSelected by discriminating on `!== "BULK"`.
  it("prepUnit with a specific assetId preps exactly one unit, not the whole line", async () => {
    const org = await createOrgFixture();
    const model = await createModelFixture(org.id);
    const project = await testPrisma.project.create({
      data: { organizationId: org.id, projectNumber: `P-${createId().slice(0, 8)}`, name: "T", taxRate: 0 },
    });
    const line = await testPrisma.projectLineItem.create({
      data: { organizationId: org.id, projectId: project.id, modelId: model.id, quantity: 4, status: "CONFIRMED" },
    });
    const asset = await createAssetFixture(org.id, model.id, { assetTag: `PR-${createId().slice(0, 6)}` });

    await testPrisma.$transaction((tx) =>
      prepUnit(tx, { organizationId: org.id, lineItemId: line.id, assetId: asset.id, bulkAssetId: null }),
    );

    const units = await testPrisma.projectLineItemUnit.findMany({ where: { lineItemId: line.id } });
    // Exactly one unit was created and packed — the other three stay unprepped.
    expect(units).toHaveLength(1);
    expect(units[0].assetId).toBe(asset.id);
    expect(units[0].prepStatus).toBe("PACKED");
  });
});
