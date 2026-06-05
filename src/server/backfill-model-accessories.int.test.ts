/**
 * Validates the one-time backfill migration
 * (20260605130000_backfill_model_accessories) against seeded "pre-fix" data:
 * model-level equipment lines with no accessory children, whose model has a
 * model-level bulk accessory. Runs the EXACT migration SQL.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createId } from "@paralleldrive/cuid2";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createBulkAssetFixture,
} from "../../tests/helpers/integration";

async function attachModelAccessory(orgId: string, userId: string, modelId: string, bulkAssetId: string, quantity: number) {
  return testPrisma.modelBulkAccessory.create({
    data: { organizationId: orgId, modelId, bulkAssetId, quantity, addedById: userId },
  });
}

const BACKFILL_SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20260605130000_backfill_model_accessories/migration.sql"),
  "utf8",
);

async function project(orgId: string, status: string = "QUOTED", isTemplate = false) {
  return testPrisma.project.create({
    data: {
      id: createId(),
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name: "Job",
      status: status as never,
      isTemplate,
    },
    select: { id: true },
  });
}

/** A pre-fix model-level line: modelId set, no asset, no accessory children. */
async function modelLine(
  orgId: string,
  projectId: string,
  modelId: string,
  quantity: number,
  opts: { status?: string; checkedOutQuantity?: number } = {},
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      type: "EQUIPMENT",
      modelId,
      quantity,
      status: (opts.status ?? "QUOTED") as never,
      checkedOutQuantity: opts.checkedOutQuantity ?? 0,
    },
    select: { id: true },
  });
}

describe("backfill: model-level accessories onto existing lines", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("expands the model accessory onto an existing model line, qty-scaled, idempotently", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const micon = await createBulkAssetFixture(org.id, model.id, { assetTag: "MICON-BF", total: 50 });
    await attachModelAccessory(org.id, user.id, model.id, micon.id, 1);
    const proj = await project(org.id);
    const line = await modelLine(org.id, proj.id, model.id, 3);

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: line.id, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    expect(children[0].bulkAssetId).toBe(micon.id);
    expect(children[0].quantity).toBe(3); // 3 units x 1 each
    expect(children[0].isKitChild).toBe(true);

    // Idempotent — re-running creates no duplicate (NOT EXISTS + unique index).
    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);
    const after = await testPrisma.projectLineItem.count({
      where: { parentLineItemId: line.id, childKind: "ACCESSORY" },
    });
    expect(after).toBe(1);
  });

  it("skips a line that already has the accessory child", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const micon = await createBulkAssetFixture(org.id, model.id, { assetTag: "MICON-BF2", total: 50 });
    await attachModelAccessory(org.id, user.id, model.id, micon.id, 1);
    const proj = await project(org.id);
    const line = await modelLine(org.id, proj.id, model.id, 1);
    // Already-expanded child (qty deliberately odd to prove it isn't overwritten).
    await testPrisma.projectLineItem.create({
      data: { organizationId: org.id, projectId: proj.id, type: "EQUIPMENT", modelId: model.id, bulkAssetId: micon.id, quantity: 99, isKitChild: true, childKind: "ACCESSORY", parentLineItemId: line.id },
    });

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: line.id, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    expect(children[0].quantity).toBe(99); // untouched
  });

  it("leaves finished / template projects and specific-asset lines alone", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const micon = await createBulkAssetFixture(org.id, model.id, { assetTag: "MICON-BF3", total: 50 });
    await attachModelAccessory(org.id, user.id, model.id, micon.id, 1);
    const invoiced = await project(org.id, "INVOICED");
    const template = await project(org.id, "QUOTED", true);
    const invoicedLine = await modelLine(org.id, invoiced.id, model.id, 1);
    const templateLine = await modelLine(org.id, template.id, model.id, 1);

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    for (const l of [invoicedLine, templateLine]) {
      const n = await testPrisma.projectLineItem.count({
        where: { parentLineItemId: l.id, childKind: "ACCESSORY" },
      });
      expect(n).toBe(0);
    }
  });

  it("does NOT backfill already-fulfilled lines (no phantom accessory on deployed gear)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const micon = await createBulkAssetFixture(org.id, model.id, { assetTag: "MICON-BF4", total: 50 });
    await attachModelAccessory(org.id, user.id, model.id, micon.id, 1);
    const proj = await project(org.id, "CHECKED_OUT");
    // A line already checked out — backfilling here would inject a phantom,
    // un-picked accessory onto gear that's already out.
    const out = await modelLine(org.id, proj.id, model.id, 1, { status: "CHECKED_OUT", checkedOutQuantity: 1 });
    // A confirmed, not-yet-out line on the same project SHOULD be backfilled.
    const ready = await modelLine(org.id, proj.id, model.id, 1, { status: "CONFIRMED", checkedOutQuantity: 0 });

    await testPrisma.$executeRawUnsafe(BACKFILL_SQL);

    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: out.id, childKind: "ACCESSORY" } })).toBe(0);
    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: ready.id, childKind: "ACCESSORY" } })).toBe(1);
  });
});
