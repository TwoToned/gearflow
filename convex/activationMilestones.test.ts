// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });

describe("activationMilestones.state", () => {
  test("all four milestones false for an org with nothing yet", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    });
    const state = await t.withIdentity(asUser(ORG)).query(api.activationMilestones.state, { orgId: ORG });
    expect(state).toEqual({
      firstModelId: null,
      firstModelName: null,
      hasModel: false,
      hasAssetOnFirstModel: false,
      firstProjectId: null,
      firstProjectName: null,
      hasProject: false,
      hasModelLineItemOnFirstProject: false,
    });
  });

  test("derives all four milestones from real rows, oldest-first, org-scoped", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });

      // Two models — the OLDER one (inserted first) must win as "first model".
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "MAC Aura XB" });
      await ctx.db.insert("models", { id: "mdl2", organizationId: ORG, name: "SM58" });
      // An asset on the second (newer) model shouldn't satisfy milestone 2.
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mdl2", assetTag: "a1", status: "AVAILABLE" });

      // A template project inserted before the real one must be skipped.
      await ctx.db.insert("projects", { id: "pt", organizationId: ORG, projectNumber: "PT", name: "Template", status: "CONFIRMED", isTemplate: true });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Corporate Gala", status: "ENQUIRY", isTemplate: false });
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Later Job", status: "ENQUIRY", isTemplate: false });

      // A line item with no modelId shouldn't satisfy milestone 4 on its own.
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "QUOTED", quantity: 1 });

      // Cross-tenant rows that must never leak into this org's read.
      await ctx.db.insert("members", { id: "m2", organizationId: OTHER_ORG, userId: "user_2", role: "viewer" });
      await ctx.db.insert("models", { id: "mdl_other", organizationId: OTHER_ORG, name: "Other org model" });
      await ctx.db.insert("projects", { id: "p_other", organizationId: OTHER_ORG, projectNumber: "PO", name: "Other org project", status: "ENQUIRY", isTemplate: false });
    });

    let state = await t.withIdentity(asUser(ORG)).query(api.activationMilestones.state, { orgId: ORG });
    expect(state.firstModelId).toBe("mdl1");
    expect(state.firstModelName).toBe("MAC Aura XB");
    expect(state.hasModel).toBe(true);
    expect(state.hasAssetOnFirstModel).toBe(false); // the only asset is on mdl2, not the first model
    expect(state.firstProjectId).toBe("p1"); // template pt skipped, p1 is the oldest real project
    expect(state.firstProjectName).toBe("Corporate Gala");
    expect(state.hasProject).toBe(true);
    expect(state.hasModelLineItemOnFirstProject).toBe(false); // li1 has no modelId

    // Add an asset on the FIRST model and a modelId-bearing line item on the FIRST project.
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "mdl1", assetTag: "a2", status: "AVAILABLE" });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", status: "QUOTED", quantity: 1, modelId: "mdl1" });
    });
    state = await t.withIdentity(asUser(ORG)).query(api.activationMilestones.state, { orgId: ORG });
    expect(state.hasAssetOnFirstModel).toBe(true);
    expect(state.hasModelLineItemOnFirstProject).toBe(true);

    // The other org's read must never see this org's rows.
    const otherState = await t.withIdentity(asUser(OTHER_ORG)).query(api.activationMilestones.state, { orgId: OTHER_ORG });
    expect(otherState.firstModelId).toBe("mdl_other");
    expect(otherState.firstProjectId).toBe("p_other");
  });

  test("a bulk asset (not just a serialized one) satisfies the asset milestone", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Cable pack" });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "mdl1", assetTag: "b1", totalQuantity: 10 });
    });
    const state = await t.withIdentity(asUser(ORG)).query(api.activationMilestones.state, { orgId: ORG });
    expect(state.hasAssetOnFirstModel).toBe(true);
  });

  test("rejects a caller whose own org doesn't match the requested orgId", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).query(api.activationMilestones.state, { orgId: OTHER_ORG }),
    ).rejects.toThrow();
  });
});
