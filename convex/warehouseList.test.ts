// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });
const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

describe("warehouseList.bundle", () => {
  test("returns pipeline-status projects (sorted, with client + thin line items)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "cl1", organizationId: ORG, name: "Acme" });
      // In pipeline: pB CONFIRMED (later start), pA RETURNED (earlier start, has client + items).
      await ctx.db.insert("projects", { id: "pB", organizationId: ORG, projectNumber: "PB", name: "PB", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW + 2 * DAY });
      await ctx.db.insert("projects", { id: "pA", organizationId: ORG, projectNumber: "PA", name: "PA", status: "RETURNED", isTemplate: false, rentalStartDate: NOW + DAY, clientId: "cl1" });
      // Excluded: non-pipeline status, template, other org.
      await ctx.db.insert("projects", { id: "pEnq", organizationId: ORG, projectNumber: "PE", name: "PE", status: "ENQUIRY", isTemplate: false, rentalStartDate: NOW });
      await ctx.db.insert("projects", { id: "pTpl", organizationId: ORG, projectNumber: "PT", name: "PT", status: "CONFIRMED", isTemplate: true, rentalStartDate: NOW });
      await ctx.db.insert("projects", { id: "pX", organizationId: "org_other", projectNumber: "PX", name: "PX", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "pA", status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: false });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "pA", status: "CONFIRMED", type: "SERVICE", isKitChild: false });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseList.bundle, { orgId: ORG });
    // Sorted by rentalStartDate asc; ENQUIRY / template / other-org excluded.
    expect(res.projects.map((p) => p.id)).toEqual(["pA", "pB"]);
    expect(res.projects[0].client?.name).toBe("Acme");
    expect(res.projects[0].lineItems).toHaveLength(2); // all line items, thin shape
    expect(res.projects[0].lineItems[0]).toEqual({ status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: false });
    expect(res.projects[1].client).toBeNull();
  });

  test("rejects a user token from a different org (org-scoping)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser("org_other")).query(api.warehouseList.bundle, { orgId: ORG }),
    ).rejects.toThrow(/organization mismatch/i);
  });
});
