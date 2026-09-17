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
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "P2", status: "PREPPING", isTemplate: false, rentalStartDate: NOW + 2 * DAY,
        liveVersionId: "v-p2",
      });
      await ctx.db.insert("projectVersions", { id: "v-p2", organizationId: ORG, projectId: "p2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "P1", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW + DAY, clientId: "cl1",
        liveVersionId: "v-p1",
      });
      await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pPast", organizationId: ORG, projectNumber: "PP", name: "PP", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW - DAY,
        liveVersionId: "v-pPast",
      });
      await ctx.db.insert("projectVersions", { id: "v-pPast", organizationId: ORG, projectId: "pPast", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pTpl", organizationId: ORG, projectNumber: "PT", name: "PT", status: "CONFIRMED", isTemplate: true, rentalStartDate: NOW + DAY,
        liveVersionId: "v-pTpl",
      });
      await ctx.db.insert("projectVersions", { id: "v-pTpl", organizationId: ORG, projectId: "pTpl", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pDone", organizationId: ORG, projectNumber: "PD", name: "PD", status: "COMPLETED", isTemplate: false, rentalStartDate: NOW + DAY,
        liveVersionId: "v-pDone",
      });
      await ctx.db.insert("projectVersions", { id: "v-pDone", organizationId: ORG, projectId: "pDone", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT",
        versionId: "v-p1",
        lineageId: "li1",
      });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", type: "SERVICE",
        versionId: "v-p1",
        lineageId: "li2",
      }); // not counted
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
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "PM1", status: "CONFIRMED", isTemplate: false, projectManagerId: USER, rentalStartDate: NOW + DAY,
        liveVersionId: "v-pm1",
      });
      await ctx.db.insert("projectVersions", { id: "v-pm1", organizationId: ORG, projectId: "pm1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pm2", organizationId: ORG, projectNumber: "PM2", name: "PM2", status: "ON_SITE", isTemplate: false, rentalStartDate: NOW + 2 * DAY,
        liveVersionId: "v-pm2",
      });
      await ctx.db.insert("projectVersions", { id: "v-pm2", organizationId: ORG, projectId: "pm2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pOther", organizationId: ORG, projectNumber: "PO", name: "PO", status: "CONFIRMED", isTemplate: false,
        liveVersionId: "v-pOther",
      });
      await ctx.db.insert("projectVersions", { id: "v-pOther", organizationId: ORG, projectId: "pOther", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pDone", organizationId: ORG, projectNumber: "PD", name: "PD", status: "INVOICED", isTemplate: false, projectManagerId: USER,
        liveVersionId: "v-pDone-2",
      });
      await ctx.db.insert("projectVersions", { id: "v-pDone-2", organizationId: ORG, projectId: "pDone", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectManagers", { id: "pmj", organizationId: ORG, projectId: "pm2", userId: USER });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.home, { orgId: ORG });
    expect(res.userName).toBe("Alice");
    expect(res.userId).toBe(USER);
    expect(res.myProjects.map((p) => p.id).sort()).toEqual(["pm1", "pm2"]); // managed + active only
  });
});

describe("dashboardLists.needsYou", () => {
  test("surfaces declined/stale crew and expiring quotes ONLY for projects the caller manages", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    const STALE = 49 * 60 * 60 * 1000; // > the 48h threshold
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "PM Job", status: "CONFIRMED", isTemplate: false, projectManagerId: USER });
      await ctx.db.insert("projects", { id: "pOther", organizationId: ORG, projectNumber: "PO", name: "Other Job", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Sam", lastName: "Smith" });
      await ctx.db.insert("crewMembers", { id: "cm2", organizationId: ORG, firstName: "Rita", lastName: "Rivera" });
      // On MY project: one declined, one stale-offered, one recently-offered (excluded), one confirmed (excluded).
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "pm1", crewMemberId: "cm1", status: "DECLINED", respondedAt: NOW - DAY });
      await ctx.db.insert("crewAssignments", { id: "a2", organizationId: ORG, projectId: "pm1", crewMemberId: "cm2", status: "OFFERED", offeredAt: NOW - STALE });
      await ctx.db.insert("crewAssignments", { id: "a3", organizationId: ORG, projectId: "pm1", crewMemberId: "cm1", status: "OFFERED", offeredAt: NOW - 60_000 });
      await ctx.db.insert("crewAssignments", { id: "a4", organizationId: ORG, projectId: "pm1", crewMemberId: "cm2", status: "CONFIRMED" });
      // On someone else's project: declined too, but must not surface.
      await ctx.db.insert("crewAssignments", { id: "aOther", organizationId: ORG, projectId: "pOther", crewMemberId: "cm1", status: "DECLINED", respondedAt: NOW });
      // Quotes: MY project's SENT quote expires in 3 days (surfaces); the other project's expiring quote must not.
      await ctx.db.insert("quotes", { id: "q1", organizationId: ORG, projectId: "pm1", version: 1, status: "SENT", snapshot: null, validUntil: NOW + 3 * DAY });
      await ctx.db.insert("quotes", { id: "qOther", organizationId: ORG, projectId: "pOther", version: 1, status: "SENT", snapshot: null, validUntil: NOW + 3 * DAY });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.needsYou, { orgId: ORG, now: NOW });

    expect(res.declinedCrew).toEqual([
      { assignmentId: "a1", projectId: "pm1", projectName: "PM Job", projectNumber: "PM1", crewMemberName: "Sam Smith", at: NOW - DAY },
    ]);
    expect(res.staleOffers).toEqual([
      { assignmentId: "a2", projectId: "pm1", projectName: "PM Job", projectNumber: "PM1", crewMemberName: "Rita Rivera", at: NOW - STALE },
    ]);
    expect(res.expiringQuotes.map((q) => q.quoteId)).toEqual(["q1"]);
  });

  test("a project with nothing outstanding returns empty buckets, not an error", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "Quiet Job", status: "CONFIRMED", isTemplate: false, projectManagerId: USER });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.needsYou, { orgId: ORG, now: NOW });
    expect(res).toEqual({ declinedCrew: [], staleOffers: [], expiringQuotes: [] });
  });

  test("a quote expiring far in the future does not count as 'expiring soon'", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "Job", status: "CONFIRMED", isTemplate: false, projectManagerId: USER });
      await ctx.db.insert("quotes", { id: "qFar", organizationId: ORG, projectId: "pm1", version: 1, status: "SENT", snapshot: null, validUntil: NOW + 60 * DAY });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.needsYou, { orgId: ORG, now: NOW });
    expect(res.expiringQuotes).toEqual([]);
  });
});

describe("dashboardLists.blocking", () => {
  test("surfaces open blocking threads where the user is PM or mentioned", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pm1", organizationId: ORG, projectNumber: "PM1", name: "PM Job", status: "CONFIRMED", isTemplate: false, projectManagerId: USER,
        liveVersionId: "v-pm1-2",
      });
      await ctx.db.insert("projectVersions", { id: "v-pm1-2", organizationId: ORG, projectId: "pm1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pMent", organizationId: ORG, projectNumber: "PMN", name: "Mention Job", status: "CONFIRMED", isTemplate: false,
        liveVersionId: "v-pMent",
      });
      await ctx.db.insert("projectVersions", { id: "v-pMent", organizationId: ORG, projectId: "pMent", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pNone", organizationId: ORG, projectNumber: "PN", name: "Other Job", status: "CONFIRMED", isTemplate: false,
        liveVersionId: "v-pNone",
      });
      await ctx.db.insert("projectVersions", { id: "v-pNone", organizationId: ORG, projectId: "pNone", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      const baseT = { orgId: ORG, entityType: "project", status: "open" as const, isBlocking: true, createdBy: "u9", createdByName: "Bob", updatedAt: NOW };
      const th1 = await ctx.db.insert("commentThreads", { ...baseT, entityId: "pm1", projectId: "pm1", createdAt: NOW + 2, mentionUserIds: [] });
      const th2 = await ctx.db.insert("commentThreads", { ...baseT, entityId: "pMent", projectId: "pMent", createdAt: NOW + 1, mentionUserIds: [USER] });
      await ctx.db.insert("commentThreads", { ...baseT, entityId: "pNone", projectId: "pNone", createdAt: NOW, mentionUserIds: [] }); // not PM, not mentioned → excluded
      await ctx.db.insert("comments", { orgId: ORG, threadId: th1 as unknown as string, body: "blocked on X", authorId: "u9", authorName: "Bob", authorColor: "#000", createdAt: NOW });
      void th2;
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.blocking, { orgId: ORG, now: NOW });
    expect(res.map((b) => b.projectId)).toEqual(["pm1", "pMent"]); // createdAt desc; pNone excluded
    expect(res[0].reason).toBe("pm");
    expect(res[0].snippet).toBe("blocked on X");
    expect(res[1].reason).toBe("mention");
  });

  test("excludes threads on a cancelled/completed/invoiced or past-dated project", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pLive", organizationId: ORG, projectNumber: "PL", name: "Live Job", status: "CONFIRMED", isTemplate: false, projectManagerId: USER,
        liveVersionId: "v-pLive",
      });
      await ctx.db.insert("projectVersions", { id: "v-pLive", organizationId: ORG, projectId: "pLive", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pCancelled", organizationId: ORG, projectNumber: "PC", name: "Cancelled Job", status: "CANCELLED", isTemplate: false, projectManagerId: USER,
        liveVersionId: "v-pCancelled",
      });
      await ctx.db.insert("projectVersions", { id: "v-pCancelled", organizationId: ORG, projectId: "pCancelled", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pInvoiced", organizationId: ORG, projectNumber: "PI", name: "Invoiced Job", status: "INVOICED", isTemplate: false, projectManagerId: USER,
        liveVersionId: "v-pInvoiced",
      });
      await ctx.db.insert("projectVersions", { id: "v-pInvoiced", organizationId: ORG, projectId: "pInvoiced", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pPast", organizationId: ORG, projectNumber: "PP", name: "Past Job", status: "ON_SITE", isTemplate: false, projectManagerId: USER, rentalEndDate: NOW - DAY,
        liveVersionId: "v-pPast-2",
      });
      await ctx.db.insert("projectVersions", { id: "v-pPast-2", organizationId: ORG, projectId: "pPast", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      const baseT = { orgId: ORG, entityType: "project", status: "open" as const, isBlocking: true, createdBy: "u9", createdByName: "Bob", updatedAt: NOW, mentionUserIds: [] };
      await ctx.db.insert("commentThreads", { ...baseT, entityId: "pLive", projectId: "pLive", createdAt: NOW });
      await ctx.db.insert("commentThreads", { ...baseT, entityId: "pCancelled", projectId: "pCancelled", createdAt: NOW });
      await ctx.db.insert("commentThreads", { ...baseT, entityId: "pInvoiced", projectId: "pInvoiced", createdAt: NOW });
      await ctx.db.insert("commentThreads", { ...baseT, entityId: "pPast", projectId: "pPast", createdAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.blocking, { orgId: ORG, now: NOW });
    expect(res.map((b) => b.projectId)).toEqual(["pLive"]);
  });
});

describe("dashboardLists.pendingCrewOffers", () => {
  test("counts only offers on current/future gigs, not closed/cancelled/past ones", async () => {
    const t = convexTest(schema, modules);
    await member(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pLive", organizationId: ORG, projectNumber: "PL", name: "Live Job", status: "CONFIRMED", isTemplate: false,
        liveVersionId: "v-pLive-2",
      });
      await ctx.db.insert("projectVersions", { id: "v-pLive-2", organizationId: ORG, projectId: "pLive", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pFuture", organizationId: ORG, projectNumber: "PF", name: "Future Job", status: "QUOTED", isTemplate: false, rentalEndDate: NOW + DAY,
        liveVersionId: "v-pFuture",
      });
      await ctx.db.insert("projectVersions", { id: "v-pFuture", organizationId: ORG, projectId: "pFuture", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pCancelled", organizationId: ORG, projectNumber: "PC", name: "Cancelled Job", status: "CANCELLED", isTemplate: false,
        liveVersionId: "v-pCancelled-2",
      });
      await ctx.db.insert("projectVersions", { id: "v-pCancelled-2", organizationId: ORG, projectId: "pCancelled", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projects", { id: "pPast", organizationId: ORG, projectNumber: "PP", name: "Past Job", status: "ON_SITE", isTemplate: false, rentalEndDate: NOW - DAY,
        liveVersionId: "v-pPast-3",
      });
      await ctx.db.insert("projectVersions", { id: "v-pPast-3", organizationId: ORG, projectId: "pPast", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      const assign = (id: string, status: "OFFERED" | "PENDING" | "ACCEPTED", projectId: string) =>
        ctx.db.insert("crewAssignments", { id, organizationId: ORG, projectId, crewMemberId: "c1", status });
      await assign("ca1", "OFFERED", "pLive");
      await assign("ca2", "PENDING", "pFuture");
      await assign("ca3", "OFFERED", "pCancelled");
      await assign("ca4", "PENDING", "pPast");
      await assign("ca5", "ACCEPTED", "pLive"); // not pending → excluded regardless
    });
    const count = await t.withIdentity(asUser(ORG)).query(api.dashboardLists.pendingCrewOffers, { orgId: ORG, now: NOW });
    expect(count).toBe(2); // ca1 (pLive) + ca2 (pFuture)
  });
});
