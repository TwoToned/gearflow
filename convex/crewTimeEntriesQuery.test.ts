// @vitest-environment node
//
// UX Phase 15 (D47): Query… stores a reason on `queryReason` (never `notes`),
// bulk transitions write one activity row per entry, and `revertNative` — the
// one Undo for submit/approve/query — restores exactly what the forward write
// recorded, reading the prior state from its own activity rows.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", USER2 = "user_2", NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };
const asUser2 = { subject: USER2, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, rows: { id: string; status: string; org?: string; notes?: string; approvedById?: string; approvedAt?: number }[]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: USER2, role: "admin" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("users", { id: USER2, name: "Ben", email: "b@x.com" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true });
    for (const r of rows) {
      await ctx.db.insert("crewTimeEntries", {
        id: r.id, organizationId: r.org ?? ORG, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00", totalHours: 8,
        status: r.status as "DRAFT", updatedAt: NOW - 1000,
        ...(r.notes ? { notes: r.notes } : {}), ...(r.approvedById ? { approvedById: r.approvedById, approvedAt: r.approvedAt } : {}),
      });
    }
  });
}
const te = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const logsFor = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", ORG).eq("entityType", "crew_time_entry").eq("entityId", id)).collect());
const query = (t: T, ids: string[], reason: string, now = NOW) =>
  t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.queryNative, { orgId: ORG, ids, reason, now, actor, auditId: "q1" });

describe("queryNative (D47)", () => {
  test("stores the reason on queryReason, leaves notes alone, moves only SUBMITTED/APPROVED", async () => {
    const t = makeT();
    await seed(t, [
      { id: "s1", status: "SUBMITTED", notes: "my own note" },
      { id: "a1", status: "APPROVED", approvedById: USER, approvedAt: NOW - 5 },
      { id: "d1", status: "DRAFT" },
    ]);
    const res = await query(t, ["s1", "a1", "d1"], "  Break looks wrong  ");
    expect(res.changed.sort()).toEqual(["a1", "s1"]);
    const s1 = await te(t, "s1");
    expect(s1?.status).toBe("DISPUTED");
    expect(s1?.queryReason).toBe("Break looks wrong"); // trimmed
    expect(s1?.notes).toBe("my own note"); // the crew member's own text is untouched
    expect((await te(t, "d1"))?.status).toBe("DRAFT");
  });

  test("the reason is required and bounded server-side (mirrors the Zod bound)", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }]);
    await expect(query(t, ["s1"], "   ")).rejects.toThrow(/queryReason/);
    await expect(query(t, ["s1"], "x".repeat(501))).rejects.toThrow(/queryReason/);
    await query(t, ["s1"], "x".repeat(500));
    expect((await te(t, "s1"))?.status).toBe("DISPUTED");
  });

  test("writes one activity row per changed entry, recording the prior state", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "s2", status: "SUBMITTED" }, { id: "s3", status: "APPROVED" }]);
    await query(t, ["s1", "s2", "s3"], "Check times");
    for (const id of ["s1", "s2", "s3"]) {
      const logs = await logsFor(t, id);
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe(`q1:${id}`);
      expect(logs[0].metadata).toMatchObject({ kind: "time_entry_transition", transition: "query" });
    }
    expect((await logsFor(t, "s3"))[0].metadata).toMatchObject({ prevStatus: "APPROVED" });
  });

  test("a foreign-org id is skipped, never touched", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "x1", status: "SUBMITTED", org: OTHER }]);
    const res = await query(t, ["s1", "x1"], "Check");
    expect(res.changed).toEqual(["s1"]);
    expect((await te(t, "x1"))?.status).toBe("SUBMITTED");
    expect((await te(t, "x1"))?.queryReason).toBeUndefined();
  });

  test("submit and approve clear queryReason", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "s2", status: "SUBMITTED" }]);
    await query(t, ["s1", "s2"], "Check");
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.submitNative, { orgId: ORG, ids: ["s1"], now: NOW + 1, actor, auditId: "sub" });
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.approveNative, { orgId: ORG, ids: ["s2"], now: NOW + 2, actor, auditId: "app" });
    expect((await te(t, "s1"))?.queryReason).toBeUndefined();
    expect((await te(t, "s1"))?.status).toBe("SUBMITTED");
    expect((await te(t, "s2"))?.queryReason).toBeUndefined();
    expect((await te(t, "s2"))?.status).toBe("APPROVED");
  });
});

describe("revertNative — the exact Undo", () => {
  // Q-I4: the Undo takes ONLY the ids and the forward stamp. Which transition
  // ran, and the prior state, come from the forward write's activity rows.
  const revert = (t: T, ids: string[], stamp: number, who = asUser) =>
    t.withIdentity(who).mutation(api.crewTimeEntriesWrites.revertNative, { orgId: ORG, ids, stamp, now: stamp + 100, actor, auditId: "u1" });

  test("its args carry no transition and no prior status (Q-I4)", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }]);
    await query(t, ["s1"], "Check");
    const smuggled = { orgId: ORG, ids: ["s1"], stamp: NOW, now: NOW + 100, actor, auditId: "u1", prevStatus: "APPROVED" };
    await expect(t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.revertNative, smuggled as never)).rejects.toThrow();
    const withTransition = { orgId: ORG, ids: ["s1"], stamp: NOW, now: NOW + 100, actor, auditId: "u1", transition: "approve" };
    await expect(t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.revertNative, withTransition as never)).rejects.toThrow();
    expect((await te(t, "s1"))?.status).toBe("DISPUTED");
  });

  test("reverses the transition the record names, even when one stamp saw several", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }]);
    // approve then query in the same ms by the same user: the record that produced
    // the CURRENT status (DISPUTED ⇐ query) is the one replayed, prior = APPROVED.
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.approveNative, { orgId: ORG, ids: ["s1"], now: NOW, actor, auditId: "app" });
    await query(t, ["s1"], "Check", NOW);
    await revert(t, ["s1"], NOW);
    expect(await te(t, "s1")).toMatchObject({ status: "APPROVED", approvedById: USER, approvedAt: NOW });
    expect((await te(t, "s1"))?.queryReason).toBeUndefined();
  });

  test("a second Undo of the same write refuses (updatedAt moved)", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }]);
    await query(t, ["s1"], "Check");
    await revert(t, ["s1"], NOW);
    await expect(revert(t, ["s1"], NOW)).rejects.toThrow(/changed after/);
    expect((await te(t, "s1"))?.status).toBe("SUBMITTED");
  });

  test("query Undo restores the prior status and clears the reason", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "a1", status: "APPROVED", approvedById: USER2, approvedAt: NOW - 5 }]);
    await query(t, ["s1", "a1"], "Check");
    await revert(t, ["s1", "a1"], NOW);
    expect(await te(t, "s1")).toMatchObject({ status: "SUBMITTED" });
    expect((await te(t, "s1"))?.queryReason).toBeUndefined();
    expect(await te(t, "a1")).toMatchObject({ status: "APPROVED", approvedById: USER2, approvedAt: NOW - 5 });
  });

  test("approve Undo puts back the earlier query reason and approver exactly", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "d1", status: "SUBMITTED" }]);
    await query(t, ["d1"], "Was 7h?", NOW);
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.approveNative, { orgId: ORG, ids: ["s1", "d1"], now: NOW + 10, actor, auditId: "app" });
    await revert(t, ["s1", "d1"], NOW + 10);
    const s1 = await te(t, "s1");
    expect(s1?.status).toBe("SUBMITTED");
    expect(s1?.approvedById).toBeUndefined();
    expect(s1?.approvedAt).toBeUndefined();
    expect(await te(t, "d1")).toMatchObject({ status: "DISPUTED", queryReason: "Was 7h?" });
  });

  test("refuses when an entry changed after the forward write (updatedAt moved)", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "s2", status: "SUBMITTED" }]);
    await query(t, ["s1", "s2"], "Check");
    // s2 is touched again by someone else after the query
    await t.run(async (ctx) => { const d = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "s2")).first(); await ctx.db.patch(d!._id, { updatedAt: NOW + 50 }); });
    await expect(revert(t, ["s1", "s2"], NOW)).rejects.toThrow(/changed after/);
    // all-or-nothing: s1 was not reverted either
    expect((await te(t, "s1"))?.status).toBe("DISPUTED");
  });

  test("an entry the forward write never changed cannot be reverted by naming it", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }, { id: "other", status: "DISPUTED" }]);
    await query(t, ["s1"], "Check");
    await t.run(async (ctx) => { const d = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "other")).first(); await ctx.db.patch(d!._id, { updatedAt: NOW }); });
    await expect(revert(t, ["other"], NOW)).rejects.toThrow(/Nothing to undo/);
    expect((await te(t, "other"))?.status).toBe("DISPUTED");
  });

  test("another user cannot undo someone else's write", async () => {
    const t = makeT();
    await seed(t, [{ id: "s1", status: "SUBMITTED" }]);
    await query(t, ["s1"], "Check");
    await expect(revert(t, ["s1"], NOW, asUser2)).rejects.toThrow(/Nothing to undo/);
  });

  test("a foreign-org id is refused", async () => {
    const t = makeT();
    await seed(t, [{ id: "x1", status: "DISPUTED", org: OTHER }]);
    await expect(revert(t, ["x1"], NOW)).rejects.toThrow(/not found/);
  });

  test("submit Undo returns DRAFT entries to DRAFT, one activity row per entry", async () => {
    const t = makeT();
    await seed(t, [{ id: "d1", status: "DRAFT" }, { id: "d2", status: "DRAFT" }]);
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.submitNative, { orgId: ORG, ids: ["d1", "d2"], now: NOW, actor, auditId: "sub" });
    expect(await logsFor(t, "d1")).toHaveLength(1);
    await revert(t, ["d1", "d2"], NOW);
    expect((await te(t, "d1"))?.status).toBe("DRAFT");
    expect((await te(t, "d2"))?.status).toBe("DRAFT");
    expect(await logsFor(t, "d2")).toHaveLength(2); // forward + undo
  });
});
