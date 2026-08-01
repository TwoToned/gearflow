// @vitest-environment node
//
// convex/orgAdminStats.ts's getBatchOrgStats (#1078, A8) — the two Convex-side
// legs of the "never activated" predicate (design doc §5.4): last-activity
// timestamp and whether the org has ever had a model, asset, or real project.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SERVICE = { subject: "gearflow-service", svc: true };
const ORG_ACTIVE = "org_active";
const ORG_NEVER = "org_never";
const ORG_TEMPLATE_ONLY = "org_template_only";

function makeT() {
  return convexTest(schema, modules);
}

describe("getBatchOrgStats", () => {
  test("an org with a model, an asset, and activity reports both legs", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG_ACTIVE, name: "Light", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", {
        id: "a1", organizationId: ORG_ACTIVE, assetTag: "TAG-1", modelId: "m1",
        status: "AVAILABLE", isActive: true, createdAt: 1000, updatedAt: 1000,
      });
      await ctx.db.insert("activityLogs", {
        id: "log1", organizationId: ORG_ACTIVE, action: "CREATE", entityType: "asset",
        entityId: "a1", entityName: "TAG-1", userName: "Ada", summary: "Created asset", createdAt: 5000,
      });
    });

    const [stats] = await t
      .withIdentity(SERVICE)
      .query(api.orgAdminStats.getBatchOrgStats, { organizationIds: [ORG_ACTIVE] });

    expect(stats.hasAnyMilestone).toBe(true);
    expect(stats.lastActivityAt).toBe(5000);
  });

  test("an org with nothing at all reports the never-activated legs", async () => {
    const t = makeT();
    const [stats] = await t
      .withIdentity(SERVICE)
      .query(api.orgAdminStats.getBatchOrgStats, { organizationIds: [ORG_NEVER] });

    expect(stats).toEqual({ organizationId: ORG_NEVER, lastActivityAt: null, hasAnyMilestone: false });
  });

  test("a template-only project does NOT count as a milestone", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG_TEMPLATE_ONLY, projectNumber: "TPL-1", name: "Template",
        isTemplate: true, createdAt: 1000, updatedAt: 1000,
      });
    });

    const [stats] = await t
      .withIdentity(SERVICE)
      .query(api.orgAdminStats.getBatchOrgStats, { organizationIds: [ORG_TEMPLATE_ONLY] });

    expect(stats.hasAnyMilestone).toBe(false);
  });

  test("a real (non-template) project DOES count as a milestone", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG_TEMPLATE_ONLY, projectNumber: "P-1", name: "Real Project",
        isTemplate: false, createdAt: 1000, updatedAt: 1000,
      });
    });

    const [stats] = await t
      .withIdentity(SERVICE)
      .query(api.orgAdminStats.getBatchOrgStats, { organizationIds: [ORG_TEMPLATE_ONLY] });

    expect(stats.hasAnyMilestone).toBe(true);
  });

  test("batches multiple orgs in one call, each independently correct", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG_ACTIVE, name: "Light", assetType: "SERIALIZED" });
    });

    const results = await t
      .withIdentity(SERVICE)
      .query(api.orgAdminStats.getBatchOrgStats, { organizationIds: [ORG_ACTIVE, ORG_NEVER] });

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.organizationId === ORG_ACTIVE)?.hasAnyMilestone).toBe(true);
    expect(results.find((r) => r.organizationId === ORG_NEVER)?.hasAnyMilestone).toBe(false);
  });

  test("rejects a non-service caller", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG_ACTIVE }).query(api.orgAdminStats.getBatchOrgStats, {
        organizationIds: [ORG_ACTIVE],
      }),
    ).rejects.toThrow();
  });
});
