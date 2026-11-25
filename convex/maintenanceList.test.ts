// @vitest-environment node
//
// UX Phase 14 (14a-3): the Maintenance and Test and tag list reads, the cost redaction and sort fallback,
// and the bulk Reschedule / Assign verbs with their exact Undo.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: "key_1" };
const ACTOR = { userId: USER, userName: "Alice" };
// The list reads clamp a caller's `now` to ±48h of the server clock, so the fixture clock is the real one.
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("models", { id: "mod", organizationId: ORG, name: "Hazer" });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mod", assetTag: "HZ-1", status: "AVAILABLE", isActive: true });
    const rec = (id: string, over: Record<string, unknown>) =>
      ctx.db.insert("maintenanceRecords", { id, organizationId: ORG, type: "REPAIR", title: `Job ${id}`, createdAt: 1, updatedAt: 1, ...over } as never);
    await rec("late", { status: "SCHEDULED", scheduledDate: NOW - 3 * DAY, cost: 90 });
    await rec("soon", { status: "SCHEDULED", scheduledDate: NOW + 3 * DAY, cost: 10 });
    await rec("busy", { status: "IN_PROGRESS", scheduledDate: NOW + DAY, cost: 50 });
    await rec("held", { status: "AWAITING_PARTS", scheduledDate: NOW - DAY });
    await rec("done", { status: "COMPLETED", completedDate: NOW - DAY, result: "PASS", cost: 30 });
    await rec("gone", { status: "CANCELLED" });
    await ctx.db.insert("maintenanceRecordAssets", { id: "l1", maintenanceRecordId: "late", assetId: "a1", kind: "LINK" } as never);
    await ctx.db.insert("maintenanceRecords", { id: "foreign", organizationId: "org_2", type: "REPAIR", title: "Theirs", status: "SCHEDULED", scheduledDate: NOW - DAY } as never);
  });
}
const tags = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

describe("maintenanceList", () => {
  test("the strip words are the shared definitions; held work is open but not overdue; foreign rows never appear", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    const q = (segment: string) => as.query(api.maintenanceList.listPage, { orgId: ORG, segment, now: NOW });
    expect(tags(await q("open")).sort()).toEqual(["busy", "held", "late", "soon"]);
    expect(tags(await q("overdue"))).toEqual(["late"]);
    expect(tags(await q("scheduled")).sort()).toEqual(["late", "soon"]);
    expect(tags(await q("done"))).toEqual(["done"]);
    expect(tags(await q("all")).sort()).toEqual(["busy", "done", "gone", "held", "late", "soon"]);
    expect(await as.query(api.maintenanceList.segmentCounts, { orgId: ORG, now: NOW })).toEqual({ open: 4, overdue: 1, scheduled: 2, done: 1, all: 6, truncated: false });
  });

  test("search finds linked asset tags and model names", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    expect(tags(await as.query(api.maintenanceList.listPage, { orgId: ORG, segment: "all", search: "HZ-1", now: NOW }))).toEqual(["late"]);
    expect(tags(await as.query(api.maintenanceList.listPage, { orgId: ORG, segment: "all", search: "hazer", now: NOW }))).toEqual(["late"]);
  });

  test("a noFinancials key gets no cost, and ordering by cost is the same default order both ways", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true,
      });
    });
    const agent = t.withIdentity(asAgent);
    const run = (sortOrder: "asc" | "desc") => agent.query(api.maintenanceList.listPage, { orgId: ORG, segment: "all", sortBy: "cost", sortOrder, now: NOW });
    const asc = await run("asc");
    expect(tags(asc)).toEqual(tags(await run("desc")));
    expect(asc.items.every((i) => !("cost" in i))).toBe(true);
    // A human sees cost and can order by it.
    const human = await t.withIdentity(asUser).query(api.maintenanceList.listPage, { orgId: ORG, segment: "done", now: NOW });
    expect(human.items[0]).toMatchObject({ cost: 30 });
    expect(tags(await t.withIdentity(asUser).query(api.maintenanceList.listPage, { orgId: ORG, segment: "open", sortBy: "cost", sortOrder: "asc", now: NOW }))[0]).toBe("soon");
  });

  test("another org cannot read the list", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity({ subject: USER, orgId: "org_2" }).query(api.maintenanceList.listPage, { orgId: ORG })).rejects.toThrow();
  });
});

describe("bulk Reschedule and Assign with exact Undo", () => {
  afterEach(() => vi.useRealTimers());
  const resched = (t: T, ids: string[], auditId = "b1", id = asUser) =>
    t.withIdentity(id).mutation(api.maintenanceBulkWrites.bulkRescheduleNative, { orgId: ORG, ids, scheduledDate: NOW + 10 * DAY, now: NOW, actor: ACTOR, auditId });
  const undo = (t: T, ids: string[], id = asUser) =>
    t.withIdentity(id).mutation(api.maintenanceBulkWrites.undoBulkEditNative, { orgId: ORG, auditIds: ids, now: NOW + 1, actor: ACTOR });
  const field = (t: T, id: string, f: "scheduledDate" | "assignedToId") =>
    t.run(async (ctx) => (await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first())![f]);

  test("moves open records, skips finished ones and says so, and Undo puts the dates back once", async () => {
    const t = makeT();
    await seed(t);
    const r = await resched(t, ["late", "soon", "done"]);
    expect(r).toMatchObject({ count: 2, skipped: 1 });
    expect(await field(t, "late", "scheduledDate")).toBe(NOW + 10 * DAY);
    expect(await undo(t, r.auditIds)).toEqual({ restored: 2 });
    expect(await field(t, "late", "scheduledDate")).toBe(NOW - 3 * DAY);
    await expect(undo(t, r.auditIds)).rejects.toThrow(/already undone/);
  });

  test("Undo refuses the whole batch when one record changed since", async () => {
    const t = makeT();
    await seed(t);
    const r = await resched(t, ["late", "soon"]);
    await t.run(async (ctx) => {
      const s = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "soon")).first();
      await ctx.db.patch(s!._id, { scheduledDate: NOW + 99 * DAY });
    });
    await expect(undo(t, r.auditIds)).rejects.toThrow(/changed since/);
    expect(await field(t, "late", "scheduledDate")).toBe(NOW + 10 * DAY);
  });

  test("Assign needs a member of this org, unassign clears, and a foreign record is refused", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    const assign = (assignedToId: string | null, ids = ["late"], auditId = "as1") =>
      as.mutation(api.maintenanceBulkWrites.bulkAssignNative, { orgId: ORG, ids, assignedToId, now: NOW, actor: ACTOR, auditId });
    await expect(assign("stranger")).rejects.toThrow(/not a member/);
    const r = await assign("user_2");
    expect(await field(t, "late", "assignedToId")).toBe("user_2");
    await undo(t, r.auditIds);
    expect(await field(t, "late", "assignedToId")).toBeFalsy();
    await assign("user_2", ["late"], "as2");
    const cleared = await assign(null, ["late"], "as3");
    expect(cleared.count).toBe(1);
    expect(await field(t, "late", "assignedToId")).toBeFalsy();
    await expect(assign("user_2", ["foreign"], "as4")).rejects.toThrow(/not found/);
  });

  test("Undo is the author's and inside the 10-minute window", async () => {
    const t = makeT();
    await seed(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
    const r = await resched(t, ["late"]);
    await expect(undo(t, r.auditIds, { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    vi.setSystemTime(new Date("2026-11-25T10:11:00Z"));
    await expect(undo(t, r.auditIds)).rejects.toThrow(/10 minutes/);
  });
});

describe("testTagList", () => {
  test("states and strip counts come from the dates, not the stored word", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      const item = (id: string, over: Record<string, unknown>) =>
        ctx.db.insert("testTagAssets", { id, organizationId: ORG, testTagId: `TT-${id}`, description: `Lead ${id}`, isActive: true, ...over } as never);
      await item("over", { status: "CURRENT", nextDueDate: NOW - DAY, lastTestDate: NOW - 300 * DAY }); // stored lags: Overdue
      await item("soon", { status: "CURRENT", nextDueDate: NOW + 5 * DAY, lastTestDate: NOW - 300 * DAY });
      await item("ok", { status: "OVERDUE", nextDueDate: NOW + 60 * DAY, lastTestDate: NOW }); // stored lags: Passed
      await item("bad", { status: "FAILED", lastTestDate: NOW });
      await item("new", {});
      await item("old", { status: "RETIRED", isActive: false });
    });
    const as = t.withIdentity(asUser);
    const ids = async (segment: string) => (await as.query(api.testTagList.listPage, { orgId: ORG, segment, now: NOW })).items.map((i) => i.id).sort();
    expect(await ids("due")).toEqual(["new", "soon"]);
    expect(await ids("overdue")).toEqual(["over"]);
    expect(await ids("passed")).toEqual(["ok"]);
    expect(await ids("failed")).toEqual(["bad"]);
    expect(await ids("all")).toEqual(["bad", "new", "ok", "over", "soon"]);
    expect(await ids("retired")).toEqual(["old"]);
    expect(await as.query(api.testTagList.segmentCounts, { orgId: ORG, now: NOW })).toEqual({ due: 2, overdue: 1, passed: 1, failed: 1, all: 5, retired: 1, truncated: false });
    // A wider horizon pulls more into Due.
    const wide = await as.query(api.testTagList.listPage, { orgId: ORG, segment: "due", now: NOW, dueSoonDays: 90 });
    expect(wide.items.map((i) => i.id).sort()).toEqual(["new", "ok", "soon"]);
    await expect(t.withIdentity({ subject: USER, orgId: "org_2" }).query(api.testTagList.listPage, { orgId: ORG })).rejects.toThrow();
  });
});
