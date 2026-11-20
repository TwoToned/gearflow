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
      await ctx.db.insert("projects", { id: "pB", organizationId: ORG, projectNumber: "PB", name: "PB", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW + 2 * DAY,
        liveVersionId: "v-pB",
      });
      await ctx.db.insert("projectVersions", { id: "v-pB", organizationId: ORG, projectId: "pB", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pA", organizationId: ORG, projectNumber: "PA", name: "PA", status: "RETURNED", isTemplate: false, rentalStartDate: NOW + DAY, clientId: "cl1",
        liveVersionId: "v-pA",
      });
      await ctx.db.insert("projectVersions", { id: "v-pA", organizationId: ORG, projectId: "pA", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      // Excluded: non-pipeline status, template, other org.
      await ctx.db.insert("projects", { id: "pEnq", organizationId: ORG, projectNumber: "PE", name: "PE", status: "ENQUIRY", isTemplate: false, rentalStartDate: NOW,
        liveVersionId: "v-pEnq",
      });
      await ctx.db.insert("projectVersions", { id: "v-pEnq", organizationId: ORG, projectId: "pEnq", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pTpl", organizationId: ORG, projectNumber: "PT", name: "PT", status: "CONFIRMED", isTemplate: true, rentalStartDate: NOW,
        liveVersionId: "v-pTpl",
      });
      await ctx.db.insert("projectVersions", { id: "v-pTpl", organizationId: ORG, projectId: "pTpl", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pX", organizationId: "org_other", projectNumber: "PX", name: "PX", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW,
        liveVersionId: "v-pX",
      });
      await ctx.db.insert("projectVersions", { id: "v-pX", organizationId: "org_other", projectId: "pX", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "pA", status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: false,
        versionId: "v-pA",
        lineageId: "li1",
      });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "pA", status: "CONFIRMED", type: "SERVICE", isKitChild: false,
        versionId: "v-pA",
        lineageId: "li2",
      });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseList.bundle, { orgId: ORG });
    // Sorted by rentalStartDate asc; ENQUIRY / template / other-org excluded.
    expect(res.projects.map((p) => p.id)).toEqual(["pA", "pB"]);
    expect(res.projects[0].client?.name).toBe("Acme");
    expect(res.projects[0].lineItems).toHaveLength(2); // all line items, thin shape
    expect(res.projects[0].lineItems[0]).toEqual({ status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: false });
    expect(res.projects[1].client).toBeNull();
  });

  test("Phase 4 floor fields: derived counts + stage, PM, earliest outbound truck; foreign rows excluded", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pF", organizationId: ORG, projectNumber: "2341", name: "Gala", status: "CHECKED_OUT", isTemplate: false,
        projectStartDate: NOW, projectManagerId: "pm_1", liveVersionId: "v-pF" });
      await ctx.db.insert("projectVersions", { id: "v-pF", organizationId: ORG, projectId: "pF", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      // A half-returned line: the live card read it as Out; the floor says Returning.
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "pF", status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: false,
        quantity: 4, checkedOutQuantity: 2, returnedQuantity: 2, damagedQuantity: 1, versionId: "v-pF", lineageId: "l1" });
      await ctx.db.insert("projectLineItems", { id: "l2", organizationId: ORG, projectId: "pF", status: "CONFIRMED", type: "LABOUR", isKitChild: false,
        quantity: 1, versionId: "v-pF", lineageId: "l2" });
      // A foreign-org row stamped with this version id must not count (global index).
      await ctx.db.insert("projectLineItems", { id: "lX", organizationId: "org_other", projectId: "pF", status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: false,
        quantity: 50, checkedOutQuantity: 50, versionId: "v-pF", lineageId: "lX" });
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "pF", type: "DELIVERY", title: "Drop", date: NOW + DAY,
        scheduledTime: "09:00", vehicleDescription: "Van 3", versionId: "v-pF", lineageId: "s1" });
      await ctx.db.insert("projectServices", { id: "s2", organizationId: ORG, projectId: "pF", type: "DELIVERY", title: "Drop", date: NOW,
        scheduledTime: "06:30", vehicleDescription: "Van 2", versionId: "v-pF", lineageId: "s2" });
      await ctx.db.insert("projectServices", { id: "sX", organizationId: "org_other", projectId: "pF", type: "DELIVERY", title: "x", date: NOW - DAY,
        scheduledTime: "01:00", vehicleDescription: "Theirs", versionId: "v-pF", lineageId: "sX" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseList.bundle, { orgId: ORG });
    const p = res.projects.find((x) => x.id === "pF")!;
    expect(p.counts).toEqual({ lines: 1, linesToPick: 0, items: 4, packed: 0, out: 2, back: 2, damaged: 1, missing: 0 });
    expect(p.stage).toBe("returning");
    expect(p.projectManagerId).toBe("pm_1");
    expect(p.outbound).toEqual({ kind: "truck", date: NOW, time: "06:30", vehicle: "Van 2" });
    expect(p.lineItems).toHaveLength(2);
  });

  test("the earliest outbound is found among many services; undated and cancelled rows never win or end the scan", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pM", organizationId: ORG, projectNumber: "1", name: "M", status: "CONFIRMED", isTemplate: false, liveVersionId: "v-pM" });
      await ctx.db.insert("projectVersions", { id: "v-pM", organizationId: ORG, projectId: "pM", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      // 120 later deliveries inserted FIRST (an unordered capped read would see only these).
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("projectServices", { id: `late${i}`, organizationId: ORG, projectId: "pM", type: "DELIVERY", title: "d",
          date: NOW + (i + 5) * DAY, scheduledTime: "05:00", versionId: "v-pM", lineageId: `late${i}` });
      }
      await ctx.db.insert("projectServices", { id: "undated", organizationId: ORG, projectId: "pM", type: "DELIVERY", title: "d", scheduledTime: "01:00", versionId: "v-pM", lineageId: "undated" });
      await ctx.db.insert("projectServices", { id: "cancel", organizationId: ORG, projectId: "pM", type: "DELIVERY", title: "d", date: NOW, scheduledTime: "04:00", status: "CANCELLED", versionId: "v-pM", lineageId: "cancel" });
      await ctx.db.insert("projectServices", { id: "labour", organizationId: ORG, projectId: "pM", type: "LABOUR", title: "l", date: NOW, versionId: "v-pM", lineageId: "labour" });
      await ctx.db.insert("projectServices", { id: "early", organizationId: ORG, projectId: "pM", type: "CLIENT_PICKUP", title: "c", date: NOW + DAY, scheduledTime: "10:00", versionId: "v-pM", lineageId: "early" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseList.bundle, { orgId: ORG });
    expect(res.projects[0].outbound).toEqual({ kind: "client", date: NOW + DAY, time: "10:00", vehicle: null });
    expect(res.projects[0].outboundTruncated).toBe(false);
  });

  test("a pathological job past the scan cap flags outboundTruncated rather than guessing silently", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pP", organizationId: ORG, projectNumber: "1", name: "P", status: "CONFIRMED", isTemplate: false, liveVersionId: "v-pP" });
      await ctx.db.insert("projectVersions", { id: "v-pP", organizationId: ORG, projectId: "pP", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      for (let i = 0; i < 205; i++) {
        await ctx.db.insert("projectServices", { id: `l${i}`, organizationId: ORG, projectId: "pP", type: "LABOUR", title: "l", date: NOW + i, versionId: "v-pP", lineageId: `l${i}` });
      }
      await ctx.db.insert("projectServices", { id: "d", organizationId: ORG, projectId: "pP", type: "DELIVERY", title: "d", date: NOW + 300 * DAY, versionId: "v-pP", lineageId: "d" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseList.bundle, { orgId: ORG });
    expect(res.projects[0].outboundTruncated).toBe(true);
  });

  test("a job with no outbound service has outbound null", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pN", organizationId: ORG, projectNumber: "1", name: "N", status: "CONFIRMED", isTemplate: false, liveVersionId: "v-pN" });
      await ctx.db.insert("projectVersions", { id: "v-pN", organizationId: ORG, projectId: "pN", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseList.bundle, { orgId: ORG });
    expect(res.projects[0].outbound).toBeNull();
    expect(res.projects[0].stage).toBe("ready");
    expect(res.projects[0].projectManagerId).toBeNull();
  });

  test("rejects a user token from a different org (org-scoping)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser("org_other")).query(api.warehouseList.bundle, { orgId: ORG }),
    ).rejects.toThrow(/organization mismatch/i);
  });
});
