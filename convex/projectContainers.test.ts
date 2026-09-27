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

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const V1 = "v-p1";

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test",
      total: 0, liveVersionId: V1, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", {
      id: V1, organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER,
    });
    // The case's own line item.
    await ctx.db.insert("projectLineItems", {
      id: "case-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "case-li",
      type: "EQUIPMENT", quantity: 1, sortOrder: 0, isContainerLineItem: true, containerId: "c1",
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectContainers", {
      id: "c1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "c1",
      kind: "ASSET", assetId: "case-asset", label: "Road Case 12", lineItemId: "case-li",
      sortOrder: 0, createdAt: NOW, updatedAt: NOW,
    });
    // Two content units packed into it, one CANCELLED (excluded from the count).
    await ctx.db.insert("projectLineItems", {
      id: "content-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "content-li",
      type: "EQUIPMENT", quantity: 2, sortOrder: 1, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItemUnits", {
      id: "u1", organizationId: ORG, lineItemId: "content-li", ordinal: 1, containerId: "c1",
      status: "CONFIRMED", returnedQuantity: 0, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItemUnits", {
      id: "u2", organizationId: ORG, lineItemId: "content-li", ordinal: 2, containerId: "c1",
      status: "CANCELLED", returnedQuantity: 0, createdAt: NOW, updatedAt: NOW,
    });
    // A second, empty container.
    await ctx.db.insert("projectLineItems", {
      id: "tub-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "tub-li",
      type: "EQUIPMENT", quantity: 1, sortOrder: 2, isContainerLineItem: true, containerId: "c2",
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectContainers", {
      id: "c2", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "c2",
      kind: "CUSTOM", label: "Tub 3", lineItemId: "tub-li",
      sortOrder: 1, createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("projectContainers.listForProject", () => {
  test("returns each container with its live (non-cancelled) unit count, in sortOrder", async () => {
    const t = makeT();
    await seed(t);

    const res = await t.withIdentity(asUser(ORG)).query(api.projectContainers.listForProject, {
      orgId: ORG, projectId: "p1",
    });

    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ id: "c1", label: "Road Case 12", kind: "ASSET", unitCount: 1 });
    expect(res[1]).toMatchObject({ id: "c2", label: "Tub 3", kind: "CUSTOM", unitCount: 0 });
  });

  test("resolves each container's own asset/bulk-asset tag (scan-to-activate, #1296 phase 2) — null for CUSTOM or a stale reference", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "case-asset", organizationId: ORG, modelId: "mdl1", assetTag: "CASE-012", status: "AVAILABLE" });
      // A third, BULK_ASSET-kind container with a resolvable bulk-asset tag.
      await ctx.db.insert("projectLineItems", {
        id: "bulk-tub-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "bulk-tub-li",
        type: "EQUIPMENT", quantity: 1, sortOrder: 3, isContainerLineItem: true, containerId: "c3",
        createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectContainers", {
        id: "c3", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "c3",
        kind: "BULK_ASSET", bulkAssetId: "bulk-tub", label: "Tub Batch", lineItemId: "bulk-tub-li",
        sortOrder: 2, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("bulkAssets", { id: "bulk-tub", organizationId: ORG, modelId: "mdl2", assetTag: "TUB-BATCH-1" });
    });

    const res = await t.withIdentity(asUser(ORG)).query(api.projectContainers.listForProject, {
      orgId: ORG, projectId: "p1",
    });

    expect(res.find((c) => c.id === "c1")?.tag).toBe("CASE-012");
    // CUSTOM — no asset backing it.
    expect(res.find((c) => c.id === "c2")?.tag).toBeNull();
    expect(res.find((c) => c.id === "c3")?.tag).toBe("TUB-BATCH-1");
  });

  test("cross-org project returns empty rather than another org's containers", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m-other", organizationId: OTHER, userId: "user_2", role: "viewer" });
    });
    const res = await t.withIdentity({ subject: "user_2", orgId: OTHER }).query(api.projectContainers.listForProject, {
      orgId: OTHER, projectId: "p1",
    });
    expect(res).toEqual([]);
  });

  test("org mismatch between caller identity and requested orgId is rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).query(api.projectContainers.listForProject, {
        orgId: OTHER, projectId: "p1",
      }),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("unauthenticated call rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.query(api.projectContainers.listForProject, { orgId: ORG, projectId: "p1" }),
    ).rejects.toThrow(/Unauthorized/i);
  });
});
