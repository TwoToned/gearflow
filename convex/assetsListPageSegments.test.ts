// @vitest-environment node
//
// The Assets list's derived segments (Due for T&T, Needs attention), the On job /
// Next due row extras and bulkAssets.listPage's multi-value filters. Derived on
// read; cross-tenant rows must never appear.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const DAY = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T, now: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "Par" });
    const base = { organizationId: ORG, modelId: "mdl", isActive: true };
    await ctx.db.insert("assets", { ...base, id: "ok", assetTag: "A-OK", status: "AVAILABLE", condition: "GOOD" });
    await ctx.db.insert("assets", { ...base, id: "due", assetTag: "A-DUE", status: "AVAILABLE", condition: "GOOD" });
    await ctx.db.insert("assets", { ...base, id: "late", assetTag: "A-LATE", status: "AVAILABLE", condition: "GOOD" });
    await ctx.db.insert("assets", { ...base, id: "bad", assetTag: "A-BAD", status: "AVAILABLE", condition: "DAMAGED" });
    await ctx.db.insert("assets", { ...base, id: "out", assetTag: "A-OUT", status: "CHECKED_OUT", condition: "GOOD" });
    await ctx.db.insert("assets", { ...base, id: "gone", assetTag: "A-GONE", status: "RETIRED", isActive: false });
    const tt = { organizationId: ORG, description: "x", isActive: true };
    await ctx.db.insert("testTagAssets", { ...tt, id: "t1", testTagId: "T1", assetId: "due", nextDueDate: now + 10 * DAY });
    await ctx.db.insert("testTagAssets", { ...tt, id: "t2", testTagId: "T2", assetId: "late", nextDueDate: now - 5 * DAY });
    await ctx.db.insert("testTagAssets", { ...tt, id: "t3", testTagId: "T3", assetId: "ok", nextDueDate: now + 200 * DAY });
    // Another org's asset that is due: must never show up for ORG.
    await ctx.db.insert("assets", { organizationId: OTHER, modelId: "mdl-x", id: "foreign", assetTag: "X-1", status: "AVAILABLE", condition: "DAMAGED", isActive: true });
    await ctx.db.insert("testTagAssets", { organizationId: OTHER, description: "x", isActive: true, id: "t9", testTagId: "T9", assetId: "foreign", nextDueDate: now - DAY });
    // A job with one unit of "out" checked out.
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CHECKED_OUT", isTemplate: false, createdAt: now, updatedAt: now });
    await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Par", quantity: 1 } as never);
    await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 1, assetId: "out", status: "CHECKED_OUT" });
  });
}

const tagsOf = (r: { assets: { assetTag: string }[] }) => r.assets.map((a) => a.assetTag).sort();

describe("assets.listPage segments", () => {
  test("Due for T&T includes overdue and soon, excludes far-off and other orgs", async () => {
    const t = makeT();
    const now = Date.now();
    await seed(t, now);
    const r = await t.withIdentity(asUser).query(api.assets.listPage, { orgId: ORG, segment: "due", now });
    expect(tagsOf(r)).toEqual(["A-DUE", "A-LATE"]);
  });

  test("Needs attention = poor/damaged, in maintenance or overdue T&T", async () => {
    const t = makeT();
    const now = Date.now();
    await seed(t, now);
    const r = await t.withIdentity(asUser).query(api.assets.listPage, { orgId: ORG, segment: "attention", now });
    expect(tagsOf(r)).toEqual(["A-BAD", "A-LATE"]);
  });

  test("on-jobs and retired segments; retired reads inactive rows", async () => {
    const t = makeT();
    const now = Date.now();
    await seed(t, now);
    const q = t.withIdentity(asUser);
    expect(tagsOf(await q.query(api.assets.listPage, { orgId: ORG, segment: "on-jobs" }))).toEqual(["A-OUT"]);
    expect(tagsOf(await q.query(api.assets.listPage, { orgId: ORG, segment: "retired" }))).toEqual(["A-GONE"]);
  });

  test("an unknown segment reads as All; modelIdIn filters", async () => {
    const t = makeT();
    await seed(t, Date.now());
    const q = t.withIdentity(asUser);
    expect((await q.query(api.assets.listPage, { orgId: ORG, segment: "bogus" })).total).toBe(5);
    expect((await q.query(api.assets.listPage, { orgId: ORG, modelIdIn: ["nope"] })).total).toBe(0);
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seed(t, Date.now());
    await expect(t.withIdentity({ subject: USER, orgId: OTHER }).query(api.assets.listPage, { orgId: ORG })).rejects.toThrow();
  });
});

describe("assets.rowExtras", () => {
  test("returns next due and the job a unit is out on; skips foreign ids", async () => {
    const t = makeT();
    const now = Date.now();
    await seed(t, now);
    const r = await t.withIdentity(asUser).query(api.assets.rowExtras, { orgId: ORG, ids: ["due", "out", "foreign", "missing"] });
    expect(r.due.nextDue).toBe(now + 10 * DAY);
    expect(r.out.job).toEqual({ id: "p1", name: "Gig", number: "P-1" });
    expect(r.out.nextDue).toBeNull();
    expect(r.foreign).toBeUndefined();
    expect(r.missing).toBeUndefined();
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seed(t, Date.now());
    await expect(t.withIdentity({ subject: USER, orgId: OTHER }).query(api.assets.rowExtras, { orgId: ORG, ids: ["due"] })).rejects.toThrow();
  });
});

describe("bulkAssets.listPage multi-value filters", () => {
  test("statusIn / locationIdIn / tagsHasSome / modelIdIn narrow; foreign rows excluded", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("models", { id: "m-a", organizationId: ORG, name: "Cable" });
      const b = { organizationId: ORG, isActive: true, totalQuantity: 10, availableQuantity: 10 };
      await ctx.db.insert("bulkAssets", { ...b, id: "b1", modelId: "m-a", assetTag: "B1", status: "ACTIVE", locationId: "l1", tags: ["xlr"] });
      await ctx.db.insert("bulkAssets", { ...b, id: "b2", modelId: "m-a", assetTag: "B2", status: "ACTIVE", locationId: "l2", tags: ["dmx"] });
      await ctx.db.insert("bulkAssets", { ...b, id: "b3", modelId: "m-a", assetTag: "B3", status: "LOW_STOCK", locationId: "l1" });
      await ctx.db.insert("bulkAssets", { ...b, organizationId: OTHER, id: "bx", modelId: "m-a", assetTag: "BX", status: "ACTIVE", locationId: "l1", tags: ["xlr"] });
    });
    const q = t.withIdentity(asUser);
    const tagsOfBulk = async (extra: object) =>
      (await q.query(api.bulkAssets.listPage, { orgId: ORG, ...extra })).bulkAssets.map((x) => x.assetTag).sort();
    expect(await tagsOfBulk({ locationIdIn: ["l1"] })).toEqual(["B1", "B3"]);
    expect(await tagsOfBulk({ statusIn: ["LOW_STOCK", "ACTIVE"], locationIdIn: ["l1", "l2"] })).toEqual(["B1", "B2", "B3"]);
    expect(await tagsOfBulk({ tagsHasSome: ["xlr", "dmx"] })).toEqual(["B1", "B2"]);
    expect(await tagsOfBulk({ modelIdIn: ["other"] })).toEqual([]);
    expect(await tagsOfBulk({})).toEqual(["B1", "B2", "B3"]);
  });
});
