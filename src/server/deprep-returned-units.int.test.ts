/**
 * Regression: depreping a RETURNED line must PRESERVE its return record.
 *
 * Bug (warehouse linear-flow rework): the forward Returned → Depreped step ran
 * through deprepItem, which deleted every non-CHECKED_OUT unit — including the
 * RETURNED ones. That rolled returnedQuantity back to 0 and reverted the line to
 * CONFIRMED, so returned gear reappeared in Pick/Prep as if it never shipped —
 * the exact bug the rework set out to kill.
 *
 * Fix: deprepItem excludes RETURNED units from deletion and only clears their
 * stale PACKED prepStatus (so the rollup keeps the line in Depreped, not back in
 * PACKED/Returned). deprepItem commits in a tx then syncs to Convex (which throws
 * here — no trusted test JWKS), so we run it, swallow the post-commit Convex
 * error, and assert the committed DB state.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma, setupIntegrationTest, createOrgFixture, createUserFixture,
  createModelFixture, createAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { prepUnit } from "@/lib/line-item-fulfillment";

const h = vi.hoisted(() => ({ ctx: { organizationId: "", userId: "", userName: "Tester" } }));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { deprepItem } from "@/server/check-records";

describe("deprep preserves a returned line's units", () => {
  beforeEach(async () => { await setupIntegrationTest(); });
  afterAll(async () => { await testPrisma.$disconnect(); });

  it("depreping a RETURNED line keeps the unit + returnedQuantity, only clears prepStatus", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id, { name: "Wedge" });
    const asset = await createAssetFixture(org.id, model.id, { assetTag: `WDG-${createId().slice(0, 4)}` });
    const project = await testPrisma.project.create({
      data: { organizationId: org.id, projectNumber: `P-${createId().slice(0, 8)}`, name: "T", taxRate: 0 },
    });
    const line = await testPrisma.projectLineItem.create({
      data: { organizationId: org.id, projectId: project.id, modelId: model.id, quantity: 1, status: "CONFIRMED" },
    });

    // Prep the unit, then hand-seed the RETURNED state (deployed → returned),
    // leaving the stale PACKED prepStatus that the old deprep path tripped on.
    await testPrisma.$transaction((tx) =>
      prepUnit(tx, { organizationId: org.id, lineItemId: line.id, assetId: asset.id, bulkAssetId: null }));
    const unit = await testPrisma.projectLineItemUnit.findFirstOrThrow({ where: { lineItemId: line.id } });
    await testPrisma.projectLineItemUnit.update({
      where: { id: unit.id },
      data: { status: "RETURNED", returnedQuantity: 1, prepStatus: "PACKED" },
    });
    await testPrisma.projectLineItem.update({
      where: { id: line.id },
      data: { status: "RETURNED", returnedQuantity: 1, prepStatus: "PACKED" },
    });

    // Forward deprep (put away). Swallow the post-commit Convex sync error.
    await deprepItem(project.id, line.id, 1).catch(() => {});

    // The return record must survive: unit still there, still RETURNED, count intact.
    const unitsAfter = await testPrisma.projectLineItemUnit.findMany({ where: { lineItemId: line.id } });
    expect(unitsAfter).toHaveLength(1);
    expect(unitsAfter[0].status).toBe("RETURNED");

    const lineAfter = await testPrisma.projectLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(lineAfter.status).toBe("RETURNED");
    expect(lineAfter.returnedQuantity).toBe(1);
    // Put away: prepStatus reset so it sits in Depreped, not Returned, and never
    // bounces back to PACKED on a later rollup.
    expect(lineAfter.prepStatus).toBe("PENDING");
    expect(unitsAfter[0].prepStatus).toBe("PENDING");
  });
});
