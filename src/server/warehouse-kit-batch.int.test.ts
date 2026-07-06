/**
 * Integration parity tests for checkOutKitsBatch / checkInKitsBatch — proves the
 * batched kit deploy/return produces the same Convex state as looping the single
 * checkOutKit / checkInKit actions, plus per-kit partial-success.
 *
 * Kits are built with no assets so the T&T preflight passes trivially; the
 * deploy/return status flips are what we assert on (read from Convex, since
 * Phase C writes line/kit state to Convex only).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
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
  checkOutKit,
  checkInKit,
  checkOutKitsBatch,
  checkInKitsBatch,
} from "@/server/warehouse";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: { organizationId: orgId, projectNumber: `P-${createId().slice(0, 8)}`, name: "T", taxRate: 0 },
  });
}

// A prepped, asset-free kit on a project: parent line + 2 KIT children, all PACKED.
async function buildKit(orgId: string, userId: string, tag: string) {
  const project = await createProjectFixture(orgId);
  const kit = await createKitFixture(orgId, { assetTag: tag, name: "K", userId });
  const parent = await testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId, projectId: project.id, kitId: kit.id, quantity: 1,
      status: "CONFIRMED", prepStatus: "PACKED", isKitChild: false,
    },
  });
  const children = [];
  for (let i = 0; i < 2; i++) {
    children.push(
      await testPrisma.projectLineItem.create({
        data: {
          organizationId: orgId, projectId: project.id, quantity: 1, status: "CONFIRMED",
          prepStatus: "PACKED", parentLineItemId: parent.id, isKitChild: true, childKind: "KIT",
        },
      }),
    );
  }
  return { project, kit, parent, children };
}

async function statuses(kitId: string, lineIds: string[]) {
  const convex = await getConvexClient();
  const [kit, ...lines] = await Promise.all([
    convex.query(api.kits.getById, { id: kitId }),
    ...lineIds.map((id) => convex.query(api.projectLineItems.getById, { id })),
  ]);
  return {
    kit: kit?.status ?? null,
    lines: lines.map((l) => l?.status ?? null),
  };
}

describe("checkOut/checkInKitsBatch — parity with the per-kit loop", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("batch deploy == the checkOutKit loop", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const a = await buildKit(org.id, user.id, `KO-A-${createId().slice(0, 6)}`);
    await checkOutKit(a.project.id, a.kit.id);

    const b = await buildKit(org.id, user.id, `KO-B-${createId().slice(0, 6)}`);
    const res = await checkOutKitsBatch(b.project.id, [b.kit.id]);
    expect(res.succeeded).toEqual([b.kit.id]);
    expect(res.errors).toEqual([]);

    const sa = await statuses(a.kit.id, [a.parent.id, ...a.children.map((c) => c.id)]);
    const sb = await statuses(b.kit.id, [b.parent.id, ...b.children.map((c) => c.id)]);
    expect(sb).toEqual(sa);
    expect(sb.kit).toBe("CHECKED_OUT");
    expect(sb.lines.every((s) => s === "CHECKED_OUT")).toBe(true);
  });

  it("batch return == the checkInKit loop", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const a = await buildKit(org.id, user.id, `KI-A-${createId().slice(0, 6)}`);
    await checkOutKit(a.project.id, a.kit.id);
    await checkInKit(a.project.id, a.kit.id, "GOOD");

    const b = await buildKit(org.id, user.id, `KI-B-${createId().slice(0, 6)}`);
    await checkOutKit(b.project.id, b.kit.id);
    const res = await checkInKitsBatch(b.project.id, [{ kitId: b.kit.id, returnCondition: "GOOD" }]);
    expect(res.succeeded).toEqual([b.kit.id]);
    expect(res.errors).toEqual([]);

    const sa = await statuses(a.kit.id, [a.parent.id, ...a.children.map((c) => c.id)]);
    const sb = await statuses(b.kit.id, [b.parent.id, ...b.children.map((c) => c.id)]);
    expect(sb).toEqual(sa);
  });

  it("partial success: an unknown kit id errors, the valid kit still deploys", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const good = await buildKit(org.id, user.id, `KP-${createId().slice(0, 6)}`);
    const bogus = createId();

    const res = await checkOutKitsBatch(good.project.id, [good.kit.id, bogus]);
    expect(res.succeeded).toEqual([good.kit.id]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].kitId).toBe(bogus);

    const s = await statuses(good.kit.id, [good.parent.id]);
    expect(s.kit).toBe("CHECKED_OUT");
  });
});
