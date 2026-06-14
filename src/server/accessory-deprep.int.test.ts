/**
 * Deprep cascade for per-parent-unit accessories (FEATUREDOCS/48). Depreping a
 * handheld must also remove ITS accessory units (battery/clip), else they linger
 * on the deploy board with no parent. deprepItem commits its work in a tx then
 * syncs to Convex (which throws here — no trusted test JWKS), so we run it,
 * swallow the post-commit Convex error, and assert the committed DB state.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma, setupIntegrationTest, createOrgFixture, createUserFixture,
  createModelFixture, createAssetFixture, createBulkAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { prepUnit } from "@/lib/line-item-fulfillment";

const h = vi.hoisted(() => ({ ctx: { organizationId: "", userId: "", userName: "Tester" } }));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { deprepItem } from "@/server/check-records";

describe("deprep removes the depreped handheld's accessory units", () => {
  beforeEach(async () => { await setupIntegrationTest(); });
  afterAll(async () => { await testPrisma.$disconnect(); });

  it("depreping one of two handhelds removes only its battery unit", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id, { name: "Handheld" });
    const aaModel = await createModelFixture(org.id, { name: "AA Battery" });
    const aa = await createBulkAssetFixture(org.id, aaModel.id, { assetTag: "AA-D", total: 50 });
    const project = await testPrisma.project.create({
      data: { organizationId: org.id, projectNumber: `P-${createId().slice(0, 8)}`, name: "T", taxRate: 0 },
    });
    const line = await testPrisma.projectLineItem.create({
      data: { organizationId: org.id, projectId: project.id, modelId: model.id, quantity: 2, status: "CONFIRMED" },
    });
    const handhelds: { id: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const hh = await createAssetFixture(org.id, model.id, { assetTag: `HHD-${i}-${createId().slice(0, 4)}` });
      await testPrisma.assetBulkChild.create({
        data: { organizationId: org.id, parentAssetId: hh.id, bulkAssetId: aa.id, quantity: 1, addedById: user.id },
      });
      await testPrisma.$transaction((tx) =>
        prepUnit(tx, { organizationId: org.id, lineItemId: line.id, assetId: hh.id, bulkAssetId: null }));
      handhelds.push(hh);
    }

    const accLine = await testPrisma.projectLineItem.findFirstOrThrow({
      where: { parentLineItemId: line.id, childKind: "ACCESSORY", bulkAssetId: aa.id },
    });
    // Two handheld prep units + two battery units before deprep.
    expect(await testPrisma.projectLineItemUnit.count({ where: { lineItemId: line.id } })).toBe(2);
    expect(await testPrisma.projectLineItemUnit.count({ where: { lineItemId: accLine.id } })).toBe(2);

    // Deprep one (highest ordinal = handheld #2). Swallow the post-commit Convex sync error.
    await deprepItem(project.id, line.id, 1).catch(() => {});

    const parentUnits = await testPrisma.projectLineItemUnit.findMany({ where: { lineItemId: line.id } });
    const accUnits = await testPrisma.projectLineItemUnit.findMany({ where: { lineItemId: accLine.id } });
    // One handheld + one battery remain; the depreped handheld's battery is gone.
    expect(parentUnits).toHaveLength(1);
    expect(accUnits).toHaveLength(1);
    // The surviving battery belongs to the surviving handheld.
    expect(accUnits[0].parentUnitAssetId).toBe(parentUnits[0].assetId);
  });
});
