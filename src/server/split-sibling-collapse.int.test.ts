/**
 * Integration tests for the Phase 3.8 split-sibling collapse migration.
 *
 * Pure helper logic is unit-tested in
 * `src/lib/split-sibling-collapse.test.ts`. These tests drive the
 * end-to-end transaction: shape the DB like real historic split-sibling
 * data, run the collapse, assert the post-state.
 *
 * Each test verifies one of:
 *   - mergeable group: 3 split siblings collapse to 1 canonical line +
 *     3 units, sibling rows deactivated, CheckRecord/DamageEvent
 *     repointed, audit row written, rollup counters recomputed.
 *   - flagged group: divergent unitPrice ⇒ not merged.
 *   - dry-run: zero mutations, plan reflects what would happen.
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
import { runCollapse } from "@/server/split-sibling-collapse";

async function createProject(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Collapse Test",
      taxRate: 0,
    },
  });
}

/**
 * Create what historic `splitLineItem` produced: one ProjectLineItem
 * per asset, qty 1, all sharing the same order-level fields. Also
 * creates the Phase-2a-style unit row for each.
 */
async function createSplitSiblings(
  orgId: string,
  projectId: string,
  modelId: string,
  assetIds: string[],
  overrides: { unitPrice?: number; description?: string; sortOrder?: number } = {},
) {
  const lines: { id: string; assetId: string }[] = [];
  for (let i = 0; i < assetIds.length; i++) {
    const line = await testPrisma.projectLineItem.create({
      data: {
        organizationId: orgId,
        projectId,
        modelId,
        assetId: assetIds[i],
        type: "EQUIPMENT",
        quantity: 1,
        unitPrice: overrides.unitPrice ?? 100,
        pricingType: "FLAT",
        duration: 1,
        lineTotal: overrides.unitPrice ?? 100,
        description: overrides.description ?? null,
        sortOrder: (overrides.sortOrder ?? 0) + i,
        status: "CONFIRMED",
      },
    });
    // Phase 2a unit.
    await testPrisma.projectLineItemUnit.create({
      data: {
        organizationId: orgId,
        lineItemId: line.id,
        ordinal: 1,
        assetId: assetIds[i],
        quantity: 1,
        status: "CONFIRMED",
      },
    });
    lines.push({ id: line.id, assetId: assetIds[i] });
  }
  return lines;
}

describe("runCollapse — split-sibling collapse", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("dry-run reports the merge plan and mutates nothing", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "DR-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "DR-2" });
    const lines = await createSplitSiblings(org.id, project.id, model.id, [a1.id, a2.id]);

    const result = await runCollapse({
      apply: false,
      projectId: project.id,
      runId: "test-dry",
    });

    expect(result.mergeable).toHaveLength(1);
    expect(result.mergeable[0].moves).toHaveLength(1);
    expect(result.flagged).toHaveLength(0);

    // No mutations.
    for (const l of lines) {
      const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
        where: { id: l.id },
      });
      expect(refreshed.quantity).toBe(1);
      expect(refreshed.status).toBe("CONFIRMED");
    }
    expect(await testPrisma.lineItemMergeMap.count()).toBe(0);
  });

  it("apply: three siblings collapse to one canonical with three units", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "A1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "A2" });
    const a3 = await createAssetFixture(org.id, model.id, { assetTag: "A3" });
    const [canonical, s1, s2] = await createSplitSiblings(
      org.id,
      project.id,
      model.id,
      [a1.id, a2.id, a3.id],
      { sortOrder: 0 },
    );

    const result = await runCollapse({
      apply: true,
      projectId: project.id,
      runId: "test-apply",
    });

    expect(result.stats.groupsMergeable).toBe(1);
    expect(result.stats.rowsMergedAway).toBe(2);
    expect(result.stats.unitsMoved).toBe(2);

    // Canonical: quantity grows to 3, units count = 3.
    const can = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: canonical.id },
    });
    expect(can.quantity).toBe(3);
    expect(can.status).not.toBe("CANCELLED");
    const canUnits = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: canonical.id },
      orderBy: { ordinal: "asc" },
    });
    expect(canUnits).toHaveLength(3);
    // Each unit points at a distinct asset, ordinals are unique.
    expect(new Set(canUnits.map((u) => u.assetId))).toEqual(
      new Set([a1.id, a2.id, a3.id]),
    );
    expect(new Set(canUnits.map((u) => u.ordinal)).size).toBe(3);

    // Siblings: inert.
    for (const s of [s1, s2]) {
      const r = await testPrisma.projectLineItem.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(r.status).toBe("CANCELLED");
      expect(r.quantity).toBe(0);
      expect(r.assetId).toBeNull();
    }

    // Audit rows persisted.
    const maps = await testPrisma.lineItemMergeMap.findMany({
      where: { canonicalLineItemId: canonical.id },
    });
    expect(maps).toHaveLength(2);
    expect(maps.every((m) => m.notes?.includes("test-apply"))).toBe(true);
  });

  it("CheckRecord rows on a sibling get repointed onto the canonical with lineItemUnitId set", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "CR-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "CR-2" });
    const [canonical, sibling] = await createSplitSiblings(
      org.id,
      project.id,
      model.id,
      [a1.id, a2.id],
    );

    // Set up a CheckItem + CheckRecord on the sibling.
    const checkItem = await testPrisma.checkItem.create({
      data: {
        organizationId: org.id,
        label: "Functional check",
        type: "PASS_FAIL",
      },
    });
    const checkRecord = await testPrisma.checkRecord.create({
      data: {
        organizationId: org.id,
        context: "PREP",
        lineItemId: sibling.id,
        assetId: a2.id,
        checkItemId: checkItem.id,
        checkItemLabelSnapshot: "Functional check",
        checkItemTypeSnapshot: "PASS_FAIL",
        result: "PASS",
        performedById: user.id,
      },
    });

    await runCollapse({
      apply: true,
      projectId: project.id,
      runId: "test-cr",
    });

    const refreshed = await testPrisma.checkRecord.findUniqueOrThrow({
      where: { id: checkRecord.id },
    });
    expect(refreshed.lineItemId).toBe(canonical.id);
    // The matching-asset CheckRecord should now point at the moved unit.
    const movedUnit = await testPrisma.projectLineItemUnit.findFirstOrThrow({
      where: { lineItemId: canonical.id, assetId: a2.id },
    });
    expect(refreshed.lineItemUnitId).toBe(movedUnit.id);
  });

  it("DamageEvent rows on a sibling get repointed similarly", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "DE-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "DE-2" });
    const [canonical, sibling] = await createSplitSiblings(
      org.id,
      project.id,
      model.id,
      [a1.id, a2.id],
    );

    const damage = await testPrisma.damageEvent.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        lineItemId: sibling.id,
        assetId: a2.id,
        severity: "MINOR",
        status: "OPEN",
        createdById: user.id,
      },
    });

    await runCollapse({
      apply: true,
      projectId: project.id,
      runId: "test-de",
    });

    const refreshed = await testPrisma.damageEvent.findUniqueOrThrow({
      where: { id: damage.id },
    });
    expect(refreshed.lineItemId).toBe(canonical.id);
    const movedUnit = await testPrisma.projectLineItemUnit.findFirstOrThrow({
      where: { lineItemId: canonical.id, assetId: a2.id },
    });
    expect(refreshed.lineItemUnitId).toBe(movedUnit.id);
  });

  it("flags a group with divergent unitPrice — refuses to merge", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "FX-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "FX-2" });
    await createSplitSiblings(org.id, project.id, model.id, [a1.id], { unitPrice: 100 });
    await createSplitSiblings(org.id, project.id, model.id, [a2.id], { unitPrice: 150 });

    const result = await runCollapse({
      apply: true,
      projectId: project.id,
      runId: "test-flag",
    });

    // Two singleton equivalence groups ⇒ neither merges.
    expect(result.mergeable).toHaveLength(0);
    expect(await testPrisma.lineItemMergeMap.count()).toBe(0);
  });

  it("flags a group with divergent description but otherwise identical", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "DS-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "DS-2" });
    const a3 = await createAssetFixture(org.id, model.id, { assetTag: "DS-3" });
    await createSplitSiblings(org.id, project.id, model.id, [a1.id, a2.id], {
      description: "stage",
    });
    await createSplitSiblings(org.id, project.id, model.id, [a3.id], {
      description: "FOH",
    });

    const result = await runCollapse({
      apply: true,
      projectId: project.id,
      runId: "test-desc",
    });

    expect(result.mergeable).toHaveLength(1); // only the "stage" pair
    expect(result.mergeable[0].moves).toHaveLength(1);
    const audit = await testPrisma.lineItemMergeMap.findMany();
    expect(audit).toHaveLength(1);
  });

  it("idempotent: a second run finds nothing to merge", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "ID-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "ID-2" });
    await createSplitSiblings(org.id, project.id, model.id, [a1.id, a2.id]);

    await runCollapse({ apply: true, projectId: project.id, runId: "first" });
    const second = await runCollapse({
      apply: true,
      projectId: project.id,
      runId: "second",
    });
    expect(second.stats.groupsMergeable).toBe(0);
    expect(second.stats.rowsMergedAway).toBe(0);
  });
});
