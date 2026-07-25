// @vitest-environment node
//
// convex/crewDashboard.ts — the 6 crew-dashboard reads. Verifies org-scoping, the status/
// date selectors (active/pending/submitted filters), joins, and cross-tenant isolation.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: "u1", orgId: ORG };

const t = () => convexTest(schema, modules);

async function seed(x: T) {
  await x.run(async (ctx) => {
    await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Al", lastName: "Pha", status: "ACTIVE", isActive: true, email: "a@x.co" });
    await ctx.db.insert("crewMembers", { id: "cmArch", organizationId: ORG, firstName: "Old", lastName: "Z", status: "ARCHIVED", isActive: false });
    await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: T0, updatedAt: T0 });
    await ctx.db.insert("crewAssignments", { id: "asConf", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", crewRoleId: "r1", status: "CONFIRMED", startDate: T0, endDate: T0 + 5 * DAY, createdAt: T0 });
    await ctx.db.insert("crewAssignments", { id: "asOffer", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", status: "OFFERED", startDate: T0, endDate: T0 + DAY, createdAt: T0 + 100 });
    await ctx.db.insert("crewTimeEntries", { id: "teSub", organizationId: ORG, crewMemberId: "cm1", assignmentId: "asConf", status: "SUBMITTED", date: T0, startTime: "09:00", endTime: "17:00", totalHours: 8 });
    await ctx.db.insert("crewTimeEntries", { id: "teApp", organizationId: ORG, crewMemberId: "cm1", status: "APPROVED", date: T0, startTime: "09:00", endTime: "15:00", totalHours: 6 });
    await ctx.db.insert("crewShifts", { id: "sh1", assignmentId: "asConf", date: T0 + 2 * DAY, status: "SCHEDULED" });
  });
}

describe("crewDashboard", () => {
  test("stats: active members / confirmed assignments / pending offers / submitted / hours", async () => {
    const x = t(); await seed(x);
    const s = await x.withIdentity(asUser).query(api.crewDashboard.stats, { orgId: ORG, nowMs: T0 + DAY });
    expect(s).toEqual({ totalActive: 1, activeAssignments: 1, pendingOffers: 1, submittedTime: 1, hoursThisWeek: 6 });
  });

  test("pickerList: active members only, with assignment joins", async () => {
    const x = t(); await seed(x);
    const res = await x.withIdentity(asUser).query(api.crewDashboard.pickerList, { orgId: ORG });
    expect(res.map((m) => m.id)).toEqual(["cm1"]); // ARCHIVED excluded
    expect(res[0].assignments.length).toBe(2);
  });

  test("pendingTimeEntries: SUBMITTED only, with crewMember + assignment", async () => {
    const x = t(); await seed(x);
    const res = await x.withIdentity(asUser).query(api.crewDashboard.pendingTimeEntries, { orgId: ORG });
    expect(res.map((e) => e.id)).toEqual(["teSub"]);
    expect(res[0].crewMember).toEqual({ firstName: "Al", lastName: "Pha" });
  });

  test("activeAssignmentsSummary: CONFIRMED not-past; pendingOffers: OFFERED", async () => {
    const x = t(); await seed(x);
    const active = await x.withIdentity(asUser).query(api.crewDashboard.activeAssignmentsSummary, { orgId: ORG, nowMs: T0 + DAY });
    expect(active.map((a) => a.id)).toEqual(["asConf"]);
    expect(active[0].project?.projectNumber).toBe("P1");
    const offers = await x.withIdentity(asUser).query(api.crewDashboard.pendingOffers, { orgId: ORG });
    expect(offers.map((a) => a.id)).toEqual(["asOffer"]);
  });

  test("upcomingShifts: SCHEDULED, from today, joined via org assignments", async () => {
    const x = t(); await seed(x);
    const res = await x.withIdentity(asUser).query(api.crewDashboard.upcomingShifts, { orgId: ORG, nowMs: T0 });
    expect(res.map((s) => s.id)).toEqual(["sh1"]);
    expect(res[0].assignment?.project?.projectNumber).toBe("P1");
  });

  test("activeAssignmentsSummary: ACCEPTED counts as active alongside CONFIRMED (status-indexed read covers both)", async () => {
    const x = t(); await seed(x);
    await x.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "asAccepted", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", status: "ACCEPTED", startDate: T0, endDate: T0 + 5 * DAY, createdAt: T0 });
    });
    const active = await x.withIdentity(asUser).query(api.crewDashboard.activeAssignmentsSummary, { orgId: ORG, nowMs: T0 + DAY });
    expect(active.map((a) => a.id).sort()).toEqual(["asAccepted", "asConf"]);
    // stats.activeAssignments intentionally counts CONFIRMED only (existing behaviour) — ACCEPTED not included.
    const s = await x.withIdentity(asUser).query(api.crewDashboard.stats, { orgId: ORG, nowMs: T0 + DAY });
    expect(s.activeAssignments).toBe(1);
  });

  test("pendingTimeEntries: a submitted entry whose assignment belongs to another org is treated as unassigned (stale-FK guard)", async () => {
    const x = t(); await seed(x);
    await x.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "asOtherOrg", organizationId: OTHER, crewMemberId: "cmX", projectId: "pX", status: "CONFIRMED" });
      await ctx.db.insert("crewTimeEntries", { id: "teCrossOrg", organizationId: ORG, crewMemberId: "cm1", assignmentId: "asOtherOrg", status: "SUBMITTED", date: T0 + 1, startTime: "09:00", endTime: "17:00", totalHours: 4 });
    });
    const res = await x.withIdentity(asUser).query(api.crewDashboard.pendingTimeEntries, { orgId: ORG });
    const crossOrgEntry = res.find((e) => e.id === "teCrossOrg");
    expect(crossOrgEntry?.assignment).toBeNull();
  });

  test("cross-tenant: another org sees nothing / is rejected", async () => {
    const x = t(); await seed(x);
    await expect(x.withIdentity({ subject: "z", orgId: OTHER }).query(api.crewDashboard.stats, { orgId: ORG, nowMs: T0 })).rejects.toThrow(/Forbidden|organization/i);
  });
});
