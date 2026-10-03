// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const V1 = "v-p1";

const containerById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const lineById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const unitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());

async function seedProject(t: T, orgId = ORG, role = "member", projectId = "p1") {
  const versionId = orgId === ORG ? V1 : `v-${orgId}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${orgId}`, organizationId: orgId, userId: USER, role });
    await ctx.db.insert("projects", {
      id: projectId, organizationId: orgId, projectNumber: "P-1", name: "Test",
      total: 0, liveVersionId: versionId, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", {
      id: versionId, organizationId: orgId, projectId, number: 1, contentState: "ready", createdAt: NOW, createdById: USER,
    });
    await ctx.db.insert("models", { id: "mdl1", organizationId: orgId, name: "Road Case", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "case-asset", organizationId: orgId, modelId: "mdl1", assetTag: "CASE-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("bulkAssets", { id: "tub-bulk", organizationId: orgId, modelId: "mdl1", assetTag: "TUB", totalQuantity: 20, createdAt: NOW, updatedAt: NOW });
  });
}

describe("projectContainersWrites.createNative", () => {
  test("creates an ASSET container + its own line item, idempotent on retry", async () => {
    const t = makeT();
    await seedProject(t);

    const r1 = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c1", orgId: ORG, projectId: "p1", kind: "ASSET", assetId: "case-asset", modelId: "mdl1", label: "Road Case 12", now: NOW, actor: ACTOR, auditId: "a1",
    });
    expect(r1.id).toBe("c1");

    const container = await containerById(t, "c1");
    expect(container?.kind).toBe("ASSET");
    expect(container?.label).toBe("Road Case 12");
    const line = await lineById(t, r1.lineItemId);
    expect(line?.isContainerLineItem).toBe(true);
    expect(line?.containerId).toBe("c1");
    expect(line?.assetId).toBe("case-asset");
    expect(line?.unitPrice).toBeUndefined(); // D5 — never priced

    // Retry with the same cuid is idempotent (no duplicate line item minted).
    const r2 = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c1", orgId: ORG, projectId: "p1", kind: "ASSET", assetId: "case-asset", modelId: "mdl1", label: "Road Case 12", now: NOW, actor: ACTOR, auditId: "a1",
    });
    expect(r2).toEqual(r1);
  });

  test("creates a CUSTOM container with no underlying asset", async () => {
    const t = makeT();
    await seedProject(t);
    const r = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c-custom", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Client's own case", now: NOW, actor: ACTOR, auditId: "a1",
    });
    const container = await containerById(t, "c-custom");
    expect(container?.kind).toBe("CUSTOM");
    expect(container?.assetId).toBeUndefined();
    const line = await lineById(t, r.lineItemId);
    expect(line?.isCustomItem).toBe(true);
    expect(line?.description).toBe("Client's own case");
  });

  test("BULK_ASSET container requires a bulkAssetId", async () => {
    const t = makeT();
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
        id: "c-bulk", orgId: ORG, projectId: "p1", kind: "BULK_ASSET", label: "Tub 3", now: NOW, actor: ACTOR, auditId: "a1",
      }),
    ).rejects.toThrow(/bulk asset must be selected/i);
  });

  test("an asset belonging to another org is rejected", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "other-mdl", organizationId: OTHER, name: "Case", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "other-case", organizationId: OTHER, modelId: "other-mdl", assetTag: "X", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
        id: "c-cross", orgId: ORG, projectId: "p1", kind: "ASSET", assetId: "other-case", modelId: "mdl1", label: "X",
        now: NOW, actor: ACTOR, auditId: "a1",
      }),
    ).rejects.toThrow(/not found in your organization/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await seedProject(t, ORG, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
        id: "c1", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "X", now: NOW, actor: ACTOR, auditId: "a1",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectContainersWrites.updateNative — nesting + cycle guard", () => {
  async function createContainer(t: T, id: string, label: string) {
    return t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id, orgId: ORG, projectId: "p1", kind: "CUSTOM", label, now: NOW, actor: ACTOR, auditId: `audit-${id}`,
    });
  }

  test("packs a container inside another, then rejects a cycle", async () => {
    const t = makeT();
    await seedProject(t);
    await createContainer(t, "outer", "Case A");
    await createContainer(t, "inner", "Case B");

    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.updateNative, {
      id: "inner", orgId: ORG, parentContainerId: "outer", now: NOW, actor: ACTOR, auditId: "u1",
    });
    expect((await containerById(t, "inner"))?.parentContainerId).toBe("outer");

    // outer -> inner would make inner its own ancestor.
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.updateNative, {
        id: "outer", orgId: ORG, parentContainerId: "inner", now: NOW, actor: ACTOR, auditId: "u2",
      }),
    ).rejects.toThrow(/can't be packed inside itself/i);

    // A container can't be its own direct parent either.
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.updateNative, {
        id: "outer", orgId: ORG, parentContainerId: "outer", now: NOW, actor: ACTOR, auditId: "u3",
      }),
    ).rejects.toThrow(/can't be packed inside itself/i);
  });

  test("rename is not audited; re-nesting is", async () => {
    const t = makeT();
    await seedProject(t);
    await createContainer(t, "c1", "Case A");
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.updateNative, {
      id: "c1", orgId: ORG, label: "Case A (relabelled)", now: NOW, actor: ACTOR, auditId: "audit-rename",
    });
    const renameLog = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "audit-rename")).first());
    expect(renameLog).toBeNull();

    await createContainer(t, "c2", "Case B");
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.updateNative, {
      id: "c1", orgId: ORG, parentContainerId: "c2", now: NOW, actor: ACTOR, auditId: "audit-nest",
    });
    const nestLog = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "audit-nest")).first());
    expect(nestLog).not.toBeNull();
  });
});

describe("projectContainersWrites.deleteNative", () => {
  test("refuses to delete a container with contents, succeeds once empty", async () => {
    const t = makeT();
    await seedProject(t);
    const created = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c1", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Case A", now: NOW, actor: ACTOR, auditId: "a1",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "content-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "content-li",
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "content-li", ordinal: 1, containerId: "c1",
        status: "CONFIRMED", returnedQuantity: 0, createdAt: NOW, updatedAt: NOW,
      });
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.deleteNative, {
        id: "c1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "d1",
      }),
    ).rejects.toThrow(/still has items packed inside/i);

    // Move the content out, then delete succeeds and cascades the line item.
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.moveUnitsNative, {
      orgId: ORG, unitIds: ["u1"], toContainerId: null, now: NOW, actor: ACTOR, auditId: "m1",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.deleteNative, {
      id: "c1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "d2",
    });
    expect(await containerById(t, "c1")).toBeNull();
    expect(await lineById(t, created.lineItemId)).toBeNull();
  });

  test("refuses to delete a container that still holds a nested container", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "outer", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Outer", now: NOW, actor: ACTOR, auditId: "a1",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "inner", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Inner", parentContainerId: "outer", now: NOW, actor: ACTOR, auditId: "a2",
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.deleteNative, {
        id: "outer", orgId: ORG, now: NOW, actor: ACTOR, auditId: "d1",
      }),
    ).rejects.toThrow(/another container packed inside/i);
  });

  test("cross-org container rejected", async () => {
    const t = makeT();
    await seedProject(t);
    await seedProject(t, OTHER, "member", "p-other");
    await t.withIdentity(asUser(OTHER)).mutation(api.projectContainersWrites.createNative, {
      id: "other-c1", orgId: OTHER, projectId: "p-other", kind: "CUSTOM", label: "Other org's box", now: NOW, actor: ACTOR, auditId: "a1",
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.deleteNative, {
        id: "other-c1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "d1",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("projectContainersWrites.moveUnitsNative + unpackNative", () => {
  async function seedTwoContainersWithOneUnit(t: T) {
    await seedProject(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c1", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Case A", now: NOW, actor: ACTOR, auditId: "a1",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c2", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Case B", now: NOW, actor: ACTOR, auditId: "a2",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "content-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "content-li",
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "content-li", ordinal: 1, containerId: "c1",
        status: "CONFIRMED", returnedQuantity: 0, createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("moves a unit from one container to another", async () => {
    const t = makeT();
    await seedTwoContainersWithOneUnit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.moveUnitsNative, {
      orgId: ORG, unitIds: ["u1"], toContainerId: "c2", now: NOW, actor: ACTOR, auditId: "m1",
    });
    expect(res.moved).toBe(1);
    expect((await unitById(t, "u1"))?.containerId).toBe("c2");
  });

  test("unpacks a container's contents to Loose", async () => {
    const t = makeT();
    await seedTwoContainersWithOneUnit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.unpackNative, {
      id: "c1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "u1",
    });
    expect(res.unpacked).toBe(1);
    expect((await unitById(t, "u1"))?.containerId).toBeUndefined();
  });

  test("a missing/cross-org unit id is skipped, not thrown", async () => {
    const t = makeT();
    await seedTwoContainersWithOneUnit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.moveUnitsNative, {
      orgId: ORG, unitIds: ["u1", "ghost-unit"], toContainerId: "c2", now: NOW, actor: ACTOR, auditId: "m1",
    });
    expect(res.moved).toBe(1);
  });
});

describe("projectContainersWrites.setPlannedContainerNative", () => {
  test("sets and clears a batch of lines' planned container", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.createNative, {
      id: "c1", orgId: ORG, projectId: "p1", kind: "CUSTOM", label: "Case A", now: NOW, actor: ACTOR, auditId: "a1",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "li1",
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
    });

    const r1 = await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.setPlannedContainerNative, {
      orgId: ORG, lineItemIds: ["li1"], containerId: "c1", now: NOW,
    });
    expect(r1.updated).toBe(1);
    expect((await lineById(t, "li1"))?.plannedContainerId).toBe("c1");

    await t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.setPlannedContainerNative, {
      orgId: ORG, lineItemIds: ["li1"], containerId: null, now: NOW,
    });
    expect((await lineById(t, "li1"))?.plannedContainerId).toBeUndefined();
  });
});
