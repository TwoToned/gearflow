/**
 * Integration parity tests for deprepItemsBatch — proves the batched deprep
 * (one atomic Convex mutation) produces the identical DB result as the old
 * per-op loop of deprepItem / deprepKit server-action round-trips.
 *
 * Phase C writes units + line rollups to Convex only, so assertions read from
 * Convex (reading Postgres via testPrisma would be stale).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
  createKitFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import {
  prepItemDirect,
  prepKitChildren,
  deprepItem,
  deprepKit,
  deprepItemsBatch,
} from "@/server/check-records";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
    },
  });
}

async function createLine(orgId: string, projectId: string, modelId: string, quantity: number) {
  return testPrisma.projectLineItem.create({
    data: { organizationId: orgId, projectId, modelId, quantity, status: "CONFIRMED" },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normUnit(u: any) {
  return {
    hasAsset: !!u.assetId,
    hasBulk: !!u.bulkAssetId,
    hasParentUnit: !!u.parentUnitAssetId,
    quantity: u.quantity ?? null,
    status: u.status ?? null,
    prepStatus: u.prepStatus ?? null,
    ordinal: u.ordinal ?? null,
  };
}

async function snapshotLine(lineItemId: string) {
  const convex = await getConvexClient();
  const [line, units] = await Promise.all([
    convex.query(api.projectLineItems.getById, { id: lineItemId }),
    convex.query(api.projectLineItemUnits.listByLineItem, { lineItemId }),
  ]);
  return {
    line: line
      ? {
          status: line.status ?? null,
          prepStatus: line.prepStatus ?? null,
          quantity: line.quantity ?? null,
          assignedQuantity: line.assignedQuantity ?? 0,
          packedQuantity: line.packedQuantity ?? 0,
          hasAssetId: !!line.assetId,
        }
      : null,
    units: units
      .map(normUnit)
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0) || Number(b.hasAsset) - Number(a.hasAsset)),
  };
}

describe("deprepItemsBatch — parity with the per-op deprep loop", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("distinct prepped items: batch deprep == the deprepItem loop", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);

    // Scenario A — old loop: prep 3 lines, deprepItem each.
    const projA = await createProjectFixture(org.id);
    const linesA = [];
    for (let i = 0; i < 3; i++) {
      const line = await createLine(org.id, projA.id, model.id, 1);
      const asset = await createAssetFixture(org.id, model.id, { assetTag: `DPB-A-${i}` });
      await prepItemDirect(projA.id, line.id, asset.id);
      linesA.push(line);
    }
    for (const line of linesA) await deprepItem(projA.id, line.id, 1);

    // Scenario B — one batch call over the identical setup.
    const projB = await createProjectFixture(org.id);
    const linesB = [];
    for (let i = 0; i < 3; i++) {
      const line = await createLine(org.id, projB.id, model.id, 1);
      const asset = await createAssetFixture(org.id, model.id, { assetTag: `DPB-B-${i}` });
      await prepItemDirect(projB.id, line.id, asset.id);
      linesB.push(line);
    }
    await deprepItemsBatch(projB.id, linesB.map((l) => ({ lineItemId: l.id, quantity: 1 })));

    for (let i = 0; i < 3; i++) {
      const snap = await snapshotLine(linesB[i].id);
      expect(snap).toEqual(await snapshotLine(linesA[i].id));
      expect(snap.units).toHaveLength(0);
      expect(snap.line?.prepStatus).toBe("PENDING");
    }
  });

  it("partial deprep of a multi-unit line: batch qty == loop qty", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);

    // Loop: prep 3 units, deprep 2 in one deprepItem call.
    const projA = await createProjectFixture(org.id);
    const lineA = await createLine(org.id, projA.id, model.id, 3);
    for (let i = 0; i < 3; i++) {
      const asset = await createAssetFixture(org.id, model.id, { assetTag: `DPP-A-${i}` });
      await prepItemDirect(projA.id, lineA.id, asset.id);
    }
    await deprepItem(projA.id, lineA.id, 2);

    // Batch: identical setup, deprep 2 via a single batch op.
    const projB = await createProjectFixture(org.id);
    const lineB = await createLine(org.id, projB.id, model.id, 3);
    for (let i = 0; i < 3; i++) {
      const asset = await createAssetFixture(org.id, model.id, { assetTag: `DPP-B-${i}` });
      await prepItemDirect(projB.id, lineB.id, asset.id);
    }
    await deprepItemsBatch(projB.id, [{ lineItemId: lineB.id, quantity: 2 }]);

    const snap = await snapshotLine(lineB.id);
    expect(snap).toEqual(await snapshotLine(lineA.id));
    expect(snap.units).toHaveLength(1); // one prepped unit left
    expect(snap.line?.prepStatus).toBe("PACKED");
  });

  it("kit deprep: batch isKit op == the deprepKit call", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);

    async function buildAndPrepKit(assetTag: string) {
      const project = await createProjectFixture(org.id);
      const kit = await createKitFixture(org.id, { assetTag, name: "K", userId: user.id });
      const parent = await testPrisma.projectLineItem.create({
        data: {
          organizationId: org.id,
          projectId: project.id,
          kitId: kit.id,
          quantity: 1,
          status: "CONFIRMED",
          isKitChild: false,
        },
      });
      const children = [];
      for (let i = 0; i < 2; i++) {
        const child = await testPrisma.projectLineItem.create({
          data: {
            organizationId: org.id,
            projectId: project.id,
            modelId: model.id,
            quantity: 1,
            status: "CONFIRMED",
            parentLineItemId: parent.id,
            isKitChild: true,
            childKind: "KIT",
          },
        });
        children.push(child);
      }
      await prepKitChildren(project.id, parent.id);
      return { project, parent, children };
    }

    const a = await buildAndPrepKit(`KIT-A-${createId().slice(0, 6)}`);
    await deprepKit(a.project.id, a.parent.id);

    const b = await buildAndPrepKit(`KIT-B-${createId().slice(0, 6)}`);
    await deprepItemsBatch(b.project.id, [{ lineItemId: b.parent.id, isKit: true }]);

    expect(await snapshotLine(b.parent.id)).toEqual(await snapshotLine(a.parent.id));
    for (let i = 0; i < 2; i++) {
      const snap = await snapshotLine(b.children[i].id);
      expect(snap).toEqual(await snapshotLine(a.children[i].id));
      expect(snap.line?.prepStatus).toBe("PENDING");
    }
  });
});
