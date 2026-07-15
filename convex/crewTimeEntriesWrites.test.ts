// @vitest-environment node
//
// convex/crewTimeEntriesWrites.ts + convex/crewTimeEntries.ts (allEntries/forMember).
// Verifies calculateTotalHours, the status machine (DRAFT→SUBMITTED→APPROVED/DISPUTED)
// with the from-status gate, the EXPORTED-lock, batch partial-success, cross-tenant +
// RBAC, and the read composites (joins + membership-gated approvedBy).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
  });
}
const te = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const base = { id: "t1", orgId: ORG, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:30", breakMinutes: 30, now: NOW, actor, auditId: "l1" };

describe("crewTimeEntriesWrites", () => {
  test("create computes totalHours (8.5h − 0.5 break = 8) + DRAFT + audit", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.createNative, base);
    const e = await te(t, "t1");
    expect(e?.totalHours).toBe(8); // (17:30 − 09:00) − 30min = 8h
    expect(e?.status).toBe("DRAFT");
    expect((await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "l1")).first()))?.action).toBe("CREATE");
  });

  test("createMany partial-success: unknown crew errors, valid ones written", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.createManyNative, {
      orgId: ORG, now: NOW, actor,
      shared: { date: NOW, startTime: "09:00", endTime: "17:00", breakMinutes: 0 },
      entries: [{ id: "t1", crewMemberId: "c1", auditId: "l1" }, { id: "t2", crewMemberId: "ghost", auditId: "l2" }],
    });
    expect(res.created).toEqual(["c1"]);
    expect(res.errors[0].crewMemberId).toBe("ghost");
  });

  test("createMany: same-org id is an idempotent skip; foreign-org id fails closed (no insert suppression)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewTimeEntries", { id: "dup1", organizationId: ORG, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00", status: "DRAFT" });
      await ctx.db.insert("crewTimeEntries", { id: "dupX", organizationId: OTHER, crewMemberId: "cX", date: NOW, startTime: "09:00", endTime: "17:00", status: "DRAFT" });
    });
    const res = await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.createManyNative, {
      orgId: ORG, now: NOW, actor,
      shared: { date: NOW, startTime: "09:00", endTime: "17:00", breakMinutes: 0 },
      entries: [{ id: "dup1", crewMemberId: "c1", auditId: "l1" }, { id: "dupX", crewMemberId: "c1", auditId: "l2" }],
    });
    expect(res.created).toEqual(["c1"]);        // same-org dup1 → idempotent skip, reported created
    expect(res.errors[0].crewMemberId).toBe("c1"); // foreign-org dupX → error, not silent suppression
    // the foreign row is untouched (still OTHER's), and no new row minted under its id
    const rows = await t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "dupX")).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(OTHER);
  });

  test("status machine: submit (DRAFT→SUBMITTED) then approve (→APPROVED w/ approver stamp); from-gate skips ineligible", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.createNative, base);
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.createNative, { ...base, id: "t2", auditId: "l2" });
    // t2 already APPROVED → not eligible for submit
    await t.run(async (ctx) => { const d = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "t2")).first(); if (d) await ctx.db.patch(d._id, { status: "APPROVED" }); });
    const sub = await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.submitNative, { orgId: ORG, ids: ["t1", "t2"], now: NOW + 1, actor, auditId: "l3" });
    expect(sub.count).toBe(1); // only t1 (DRAFT)
    expect((await te(t, "t1"))?.status).toBe("SUBMITTED");
    const app = await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.approveNative, { orgId: ORG, ids: ["t1"], now: NOW + 2, actor, auditId: "l4" });
    expect(app.count).toBe(1);
    const e = await te(t, "t1");
    expect(e?.status).toBe("APPROVED");
    expect(e?.approvedById).toBe(USER);
    expect(e?.approvedAt).toBe(NOW + 2);
  });

  test("dispute (SUBMITTED|APPROVED only); update/delete blocked on EXPORTED", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.createNative, base);
    // dispute a DRAFT → rejected
    await expect(t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.disputeNative, { id: "t1", orgId: ORG, now: NOW, actor, auditId: "l2" })).rejects.toThrow(/submitted or approved/i);
    await t.run(async (ctx) => { const d = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "t1")).first(); if (d) await ctx.db.patch(d._id, { status: "SUBMITTED" }); });
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.disputeNative, { id: "t1", orgId: ORG, reason: "wrong hours", now: NOW, actor, auditId: "l3" });
    expect((await te(t, "t1"))?.status).toBe("DISPUTED");
    // EXPORTED lock
    await t.run(async (ctx) => { const d = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "t1")).first(); if (d) await ctx.db.patch(d._id, { status: "EXPORTED" }); });
    await expect(t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.updateNative, { ...base, auditId: "l4" })).rejects.toThrow(/exported/i);
    await expect(t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.deleteNative, { id: "t1", orgId: ORG, now: NOW, actor, auditId: "l5" })).rejects.toThrow(/exported/i);
  });

  test("update resets to DRAFT + clears approval; cross-tenant + RBAC", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewTimeEntries", { id: "t1", organizationId: ORG, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00", status: "APPROVED", approvedById: USER, approvedAt: NOW }); });
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.updateNative, { ...base, id: "t1", startTime: "08:00", endTime: "16:00", auditId: "l2" });
    const e = await te(t, "t1");
    expect(e?.status).toBe("DRAFT");
    expect(e?.approvedById).toBeUndefined();
    expect(e?.approvedAt).toBeUndefined();
    // cross-tenant
    await t.run(async (ctx) => { await ctx.db.insert("crewTimeEntries", { id: "tX", organizationId: OTHER, crewMemberId: "cX", date: NOW, startTime: "09:00", endTime: "17:00", status: "DRAFT" }); });
    await expect(t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.deleteNative, { id: "tX", orgId: ORG, now: NOW, actor, auditId: "l3" })).rejects.toThrow(/not found/i);
    // viewer denied
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.crewTimeEntriesWrites.createNative, { ...base, id: "t9", auditId: "l9" })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("crewTimeEntries reads", () => {
  test("allEntries: filter/sort/paginate + joins + membership-gated approvedBy; forMember", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("crewAssignments", { id: "as1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", crewRoleId: "r1", status: "CONFIRMED" });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger" });
      await ctx.db.insert("crewTimeEntries", { id: "t1", organizationId: ORG, crewMemberId: "c1", assignmentId: "as1", date: NOW, startTime: "09:00", endTime: "17:00", totalHours: 8, status: "APPROVED", approvedById: USER });
      await ctx.db.insert("crewTimeEntries", { id: "t2", organizationId: ORG, crewMemberId: "c1", date: NOW + 1000, startTime: "10:00", endTime: "12:00", totalHours: 2, status: "DRAFT" });
      await ctx.db.insert("crewTimeEntries", { id: "tX", organizationId: OTHER, crewMemberId: "cX", date: NOW, startTime: "09:00", endTime: "17:00", status: "DRAFT" });
    });
    const res = await t.withIdentity(asUser).query(api.crewTimeEntries.allEntries, { orgId: ORG, pageSize: 50, filters: { status: ["APPROVED"] } });
    expect(res.total).toBe(1); // status filter → only t1
    expect(res.entries[0].id).toBe("t1");
    expect(res.entries[0].assignment?.project?.projectNumber).toBe("P1");
    expect(res.entries[0].approvedBy?.name).toBe("Alice"); // membership-gated users mirror
    const forMem = await t.withIdentity(asUser).query(api.crewTimeEntries.forMember, { crewMemberId: "c1", orgId: ORG });
    expect(forMem.map((e) => e.id)).toEqual(["t2", "t1"]); // date desc (t2 later)
  });
});
