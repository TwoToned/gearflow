// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

async function member(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
  });
}

describe("dashboardLists.upcoming", () => {
  test("upcoming projects (filtered/sorted/≤8) with client + equipment count", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "cl1", organizationId: ORG, name: "Acme" });
      // p1 CONFIRMED future, p2 PREPPING further future, pPast (excluded), pTpl (excluded), pDone (excluded status)
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "P2", status: "PREPPING", isTemplate: false, rentalStartDate: NOW + 2 * DAY });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "P1", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW + DAY, clientId: "cl1" });
      await ctx.db.insert("projects", { id: "pPast", organizationId: ORG, projectNumber: "PP", name: "PP", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW - DAY });
      await ctx.db.insert("projects", { id: "pTpl", organizationId: ORG, projectNumber: "PT", name: "PT", status: "CONFIRMED", isTemplate: true, rentalStartDate: NOW + DAY });
      await ctx.db.insert("projects", { id: "pDone", organizationId: ORG, projectNumber: "PD", name: "PD", status: "COMPLETED", isTemplate: false, rentalStartDate: NOW + DAY });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT" });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", type: "SERVICE" }); // not counted
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.upcoming, { orgId: ORG, now: NOW });
    expect(res.map((p) => p.id)).toEqual(["p1", "p2"]); // sorted by start asc; past/template/done excluded
    expect(res[0].client?.name).toBe("Acme");
    expect(res[0]._count.lineItems).toBe(1); // only EQUIPMENT
    expect(res[1].client).toBeNull();
  });
});

describe("dashboardLists.home", () => {
  test("returns the user's managed projects + userName", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      // pm1 directly managed; pm2 via projectManagers join; pOther not managed; pDone excluded.
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "PM1", status: "CONFIRMED", isTemplate: false, projectManagerId: USER, rentalStartDate: NOW + DAY });
      await ctx.db.insert("projects", { id: "pm2", organizationId: ORG, projectNumber: "PM2", name: "PM2", status: "ON_SITE", isTemplate: false, rentalStartDate: NOW + 2 * DAY });
      await ctx.db.insert("projects", { id: "pOther", organizationId: ORG, projectNumber: "PO", name: "PO", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("projects", { id: "pDone", organizationId: ORG, projectNumber: "PD", name: "PD", status: "INVOICED", isTemplate: false, projectManagerId: USER });
      await ctx.db.insert("projectManagers", { id: "pmj", organizationId: ORG, projectId: "pm2", userId: USER });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.home, { orgId: ORG });
    expect(res.userName).toBe("Alice");
    expect(res.userId).toBe(USER);
    expect(res.myProjects.map((p) => p.id).sort()).toEqual(["pm1", "pm2"]); // managed + active only
  });
});

describe("dashboardLists.blocking", () => {
  test("surfaces open blocking threads where the user is PM or mentioned", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "PM Job", status: "CONFIRMED", isTemplate: false, projectManagerId: USER });
      await ctx.db.insert("projects", { id: "pMent", organizationId: ORG, projectNumber: "PMN", name: "Mention Job", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("projects", { id: "pNone", organizationId: ORG, projectNumber: "PN", name: "Other Job", status: "CONFIRMED", isTemplate: false });
      const baseT = { orgId: ORG, entityType: "project", status: "open" as const, isBlocking: true, createdBy: "u9", createdByName: "Bob", updatedAt: NOW };
      const th1 = await ctx.db.insert("commentThreads", { ...baseT, entityId: "pm1", projectId: "pm1", createdAt: NOW + 2, mentionUserIds: [] });
      const th2 = await ctx.db.insert("commentThreads", { ...baseT, entityId: "pMent", projectId: "pMent", createdAt: NOW + 1, mentionUserIds: [USER] });
      await ctx.db.insert("commentThreads", { ...baseT, entityId: "pNone", projectId: "pNone", createdAt: NOW, mentionUserIds: [] }); // not PM, not mentioned → excluded
      await ctx.db.insert("comments", { orgId: ORG, threadId: th1 as unknown as string, body: "blocked on X", authorId: "u9", authorName: "Bob", authorColor: "#000", createdAt: NOW });
      void th2;
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.blocking, { orgId: ORG });
    expect(res.map((b) => b.projectId)).toEqual(["pm1", "pMent"]); // createdAt desc; pNone excluded
    expect(res[0].reason).toBe("pm");
    expect(res[0].snippet).toBe("blocked on X");
    expect(res[1].reason).toBe("mention");
  });
});
