// @vitest-environment node
//
// UX Phase 14 (final verify, 14a-3): one test per guard that a mutation run showed could be deleted alone without
// any test noticing. Written so that removing THAT guard, and only it, makes the test fail: the forward author
// stays the author (so the author check cannot be what refuses), and a seeded row is shaped so the neighbouring
// guard passes.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const DAY = 86_400_000;

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
    await ctx.db.insert("maintenanceRecords", { id: "r1", organizationId: ORG, type: "REPAIR", title: "Lamp", status: "SCHEDULED", scheduledDate: NOW + DAY } as never);
  });
}
const demote = (t: T) =>
  t.run(async (ctx) => {
    const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
    await ctx.db.patch(m!._id, { role: "viewer" });
  });
const as = (t: T) => t.withIdentity(asUser);

describe("maintenance bulk mutations: size cap, permission, input checks", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);
  const resched = (t: T, over: Record<string, unknown> = {}) =>
    as(t).mutation(api.maintenanceBulkWrites.bulkRescheduleNative, { orgId: ORG, ids: ["r1"], scheduledDate: NOW + 2 * DAY, now: NOW, actor: ACTOR, auditId: `a${Math.random()}`, ...over } as never);
  const assign = (t: T, over: Record<string, unknown> = {}) =>
    as(t).mutation(api.maintenanceBulkWrites.bulkAssignNative, { orgId: ORG, ids: ["r1"], assignedToId: "user_2", now: NOW, actor: ACTOR, auditId: `a${Math.random()}`, ...over } as never);
  const undo = (t: T, auditIds: string[]) => as(t).mutation(api.maintenanceBulkWrites.undoBulkEditNative, { orgId: ORG, auditIds, now: NOW + 1, actor: ACTOR });

  test("all three refuse more than the bulk cap", async () => {
    const t = makeT();
    await seed(t);
    await expect(resched(t, { ids: ids(501) })).rejects.toThrow(/BULK_TOO_LARGE|limit/);
    await expect(assign(t, { ids: ids(501) })).rejects.toThrow(/BULK_TOO_LARGE|limit/);
    await expect(undo(t, ids(501))).rejects.toThrow(/BULK_TOO_LARGE|limit/);
  });

  test("all three need maintenance:update (the undo's author is demoted, so only the permission refuses)", async () => {
    const t = makeT();
    await seed(t);
    const r = await resched(t);
    await demote(t);
    await expect(resched(t)).rejects.toThrow(/Forbidden|permission/i);
    await expect(assign(t)).rejects.toThrow(/Forbidden|permission/i);
    await expect(undo(t, r.auditIds)).rejects.toThrow(/Forbidden|permission/i);
  });

  test("an invalid date, an empty selection and an empty undo are refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(resched(t, { scheduledDate: 0 })).rejects.toThrow(/valid date/);
    await expect(resched(t, { scheduledDate: -5 })).rejects.toThrow(/valid date/);
    await expect(resched(t, { ids: [] })).rejects.toThrow(/Nothing selected/);
    await expect(assign(t, { ids: [] })).rejects.toThrow(/Nothing selected/);
    await expect(undo(t, [])).rejects.toThrow(/Nothing to undo/);
  });

  test("Undo refuses a forged audit row that names a field the bulk verbs never write", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", {
        id: "forged", organizationId: ORG, action: "UPDATE", entityType: "maintenance", entityId: "r1", entityName: "Lamp",
        userId: USER, userName: "Alice", summary: "x", createdAt: NOW,
        details: { fieldEdit: { before: { title: "Hacked" }, after: { title: "Lamp" }, serverSavedAt: Date.now(), authorId: USER } },
      } as never);
    });
    await expect(undo(t, ["forged"])).rejects.toThrow(/can't be undone/);
    const title = await t.run(async (ctx) => (await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first())!.title);
    expect(title).toBe("Lamp");
  });

  test("Undo refuses a record that was completed since (an old date back on a finished job rewrites its history)", async () => {
    const t = makeT();
    await seed(t);
    const r = await resched(t);
    await t.run(async (ctx) => {
      const rec = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(rec!._id, { status: "COMPLETED" });
    });
    await expect(undo(t, r.auditIds)).rejects.toThrow(/completed or closed since/);
  });
});

describe("list reads: truncated flags and unknown sort keys", () => {
  test("an unknown or prototype sort key falls back to the default order instead of throwing (maintenance and Test & tag)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, testTagId: "TT-1", description: "Lead", isActive: true } as never);
    });
    for (const sortBy of ["toString", "constructor", "__proto__", "notAField"]) {
      await expect(as(t).query(api.maintenanceList.listPage, { orgId: ORG, segment: "all", sortBy })).resolves.toBeTruthy();
      await expect(as(t).query(api.testTagList.listPage, { orgId: ORG, segment: "all", sortBy })).resolves.toBeTruthy();
    }
  });

  test("the maintenance list and its counts say `truncated` when the org read hit its cap", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 10_001; i++) await ctx.db.insert("maintenanceRecords", { id: `bulk${i}`, organizationId: ORG, type: "REPAIR", title: `J${i}`, status: "COMPLETED" } as never);
    });
    expect((await as(t).query(api.maintenanceList.listPage, { orgId: ORG, segment: "done" })).truncated).toBe(true);
    expect((await as(t).query(api.maintenanceList.segmentCounts, { orgId: ORG })).truncated).toBe(true);
  }, 120_000);

  test("the Test & tag list and its counts say `truncated` when the org read hit its cap", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 10_001; i++) await ctx.db.insert("testTagAssets", { id: `tt${i}`, organizationId: ORG, testTagId: `T${i}`, description: "x", isActive: true } as never);
    });
    expect((await as(t).query(api.testTagList.listPage, { orgId: ORG, segment: "all" })).truncated).toBe(true);
    expect((await as(t).query(api.testTagList.segmentCounts, { orgId: ORG })).truncated).toBe(true);
  }, 120_000);
});

describe("Test & tag overdue: one derivation, strict boundary", () => {
  const count = (t: T) => as(t).query(api.navCounts.get, { orgId: ORG, source: "testTagOverdue", now: NOW });
  const item = (t: T, id: string, over: Record<string, unknown>) =>
    t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id, organizationId: ORG, testTagId: id, description: id, isActive: true, ...over } as never);
    });

  test("the nav count uses deriveTestTagState: a failed or retired item with a past date is not Overdue, and a due date of exactly now is not either", async () => {
    const t = makeT();
    await seed(t);
    await item(t, "late", { status: "CURRENT", nextDueDate: NOW - DAY, lastTestDate: NOW - 400 * DAY });
    await item(t, "failed", { status: "FAILED", nextDueDate: NOW - DAY });
    await item(t, "retired", { status: "RETIRED", nextDueDate: NOW - DAY });
    await item(t, "edge", { status: "CURRENT", nextDueDate: NOW, lastTestDate: NOW - 300 * DAY });
    expect(await count(t)).toEqual({ value: 1, truncated: false });
    const list = await as(t).query(api.testTagList.listPage, { orgId: ORG, segment: "overdue", now: NOW });
    expect(list.items.map((i) => i.id)).toEqual(["late"]); // the list and the nav agree
  });
});

describe("kitWrites.createNative cannot create a kit reported missing", () => {
  test("status INCOMPLETE on create is refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      as(t).mutation(api.kitWrites.createNative, { id: "kx", organizationId: ORG, assetTag: "K-X", name: "X", status: "INCOMPLETE", createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "kx1" } as never),
    ).rejects.toThrow(/returned missing/);
  });
});

describe("Test & tag Reactivate and its Undo", () => {
  const retired = (t: T) =>
    t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "old", organizationId: ORG, testTagId: "TT-OLD", description: "Kettle", status: "RETIRED", isActive: false, updatedAt: 5 } as never);
      await ctx.db.insert("testTagAssets", { id: "live", organizationId: ORG, testTagId: "TT-LIVE", description: "Lead", status: "CURRENT", isActive: true } as never);
    });
  const react = (t: T, id = "old", auditId = `r${Math.random()}`) => as(t).mutation(api.testTagAssetsWrites.reactivateNative, { id, orgId: ORG, now: NOW, actor: ACTOR, auditId });
  const undo = (t: T, id = "old", auditId = "re1") => as(t).mutation(api.testTagAssetsWrites.undoReactivateNative, { orgId: ORG, id, auditId, now: NOW + 1, actor: ACTOR });

  test("Reactivate needs testTag:update and only a retired item can be reactivated", async () => {
    const t = makeT();
    await seed(t);
    await retired(t);
    await expect(react(t, "live")).rejects.toThrow(/Only retired items/);
    await demote(t);
    await expect(react(t)).rejects.toThrow(/Forbidden|permission/i);
  });

  test("its Undo needs testTag:update (the author is demoted), and refuses once the item changed or was tested since", async () => {
    const t = makeT();
    await seed(t);
    await retired(t);
    await react(t, "old", "re1");
    await demote(t);
    await expect(undo(t)).rejects.toThrow(/Forbidden|permission/i);

    const t2 = makeT();
    await seed(t2);
    await retired(t2);
    await react(t2, "old", "re1");
    await t2.run(async (ctx) => {
      const i = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "old")).first();
      await ctx.db.patch(i!._id, { description: "Renamed", updatedAt: NOW + 50 });
    });
    await expect(undo(t2)).rejects.toThrow(/changed since/);

    const t3 = makeT();
    await seed(t3);
    await retired(t3);
    await react(t3, "old", "re1");
    await t3.run(async (ctx) => {
      await ctx.db.insert("testTagRecords", { id: "rec", organizationId: ORG, testTagAssetId: "old", testedById: USER, testerName: "Alice", result: "PASS", testDate: NOW, nextDueDate: NOW + 100 * DAY } as never);
    });
    await expect(undo(t3)).rejects.toThrow(/tested since/);
  });
});
