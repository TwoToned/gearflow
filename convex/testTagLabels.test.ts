// @vitest-environment node
//
// UX Phase 14 (14a-3b): `testTagList.labelsFor`, the data of the printed tags for `Print tags`. It is what the single
// `Print label` prints: the LATEST test's result, date and tester and the item's next due. A never-tested item has no label
// and is named as skipped; another org's item is ignored; at most 100 ids; read permission is required.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const D = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    const item = (id: string, org: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("testTagAssets", { id, organizationId: org, testTagId: `TT-${id}`, description: id, status: "CURRENT", isActive: true, ...extra } as never);
    await item("t1", ORG, { nextDueDate: 5000 * D, lastTestDate: 2000 * D });
    await item("t2", ORG); // never tested
    await item("tx", "org_2", { nextDueDate: 1 });
    const rec = (id: string, itemId: string, org: string, testDate: number, result: string, tester: string) =>
      ctx.db.insert("testTagRecords", { id, organizationId: org, testTagAssetId: itemId, testDate, testedById: "u", testerName: tester, result, nextDueDate: testDate + 90 * D } as never);
    await rec("r_old", "t1", ORG, 1000 * D, "FAIL", "Old tester");
    await rec("r_new", "t1", ORG, 2000 * D, "PASS", "Ada");
    await rec("r_x", "tx", "org_2", 3000 * D, "PASS", "Theirs");
  });
}
const labels = (t: T, ids: string[]) => t.withIdentity(asUser).query(api.testTagList.labelsFor, { orgId: ORG, ids });

describe("testTagList.labelsFor", () => {
  test("a tested item's label is its LATEST test's result, date and tester with the item's next due", async () => {
    const t = makeT();
    await seed(t);
    const r = await labels(t, ["t1"]);
    expect(r.skipped).toEqual([]);
    expect(r.labels).toEqual([{ id: "t1", testTagId: "TT-t1", result: "PASS", testDate: 2000 * D, nextDueDate: 5000 * D, testerName: "Ada" }]);
  });

  test("a never-tested item is named as skipped, not printed blank; a failed latest test prints FAIL; a missing next due falls back to the test date", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "t3", organizationId: ORG, testTagId: "TT-t3", description: "t3", status: "FAILED", isActive: true, lastTestDate: 100 * D } as never);
      await ctx.db.insert("testTagRecords", { id: "r3", organizationId: ORG, testTagAssetId: "t3", testDate: 100 * D, testedById: "u", testerName: "", result: "FAIL", nextDueDate: 999 * D } as never);
    });
    const r = await labels(t, ["t2", "t3"]);
    expect(r.skipped).toEqual([{ id: "t2", testTagId: "TT-t2" }]);
    expect(r.labels).toEqual([{ id: "t3", testTagId: "TT-t3", result: "FAIL", testDate: 100 * D, nextDueDate: 100 * D, testerName: "—" }]);
  });

  test("another org's item is ignored (by_cuid is global), duplicates print once, and more than 100 ids is refused", async () => {
    const t = makeT();
    await seed(t);
    const r = await labels(t, ["tx", "t1", "t1", "nope"]);
    expect(r.labels.map((l) => l.id)).toEqual(["t1"]);
    expect(r.skipped).toEqual([]);
    await expect(labels(t, Array.from({ length: 101 }, (_, i) => `x${i}`))).rejects.toMatchObject({ data: { code: "TOO_MANY" } });
  });

  test("another org's caller cannot read this org's labels", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity({ subject: "x", orgId: "org_2" }).query(api.testTagList.labelsFor, { orgId: ORG, ids: ["t1"] })).rejects.toThrow(/Forbidden|organization/i);
  });
});

describe("testTagList.labelsFor — reads only the newest few records per item", () => {
  const insertRecord = (t: T, id: string, itemId: string, testDate: number, tester: string) =>
    t.run(async (ctx) => {
      await ctx.db.insert("testTagRecords", { id, organizationId: ORG, testTagAssetId: itemId, testDate, testedById: "u", testerName: tester, result: "PASS", nextDueDate: testDate + 90 * D } as never);
    });

  test("the newest test wins even when the item has more records than the old 500 cap", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "big", organizationId: ORG, testTagId: "TT-big", description: "big", status: "CURRENT", isActive: true, nextDueDate: 9000 * D, lastTestDate: 604 * D } as never);
      for (let i = 0; i < 505; i++) {
        await ctx.db.insert("testTagRecords", { id: `b${i}`, organizationId: ORG, testTagAssetId: "big", testDate: (100 + i) * D, testedById: "u", testerName: `Tester ${i}`, result: i === 504 ? "FAIL" : "PASS", nextDueDate: 1 } as never);
      }
    });
    const r = await labels(t, ["big"]);
    expect(r.labels).toEqual([{ id: "big", testTagId: "TT-big", result: "FAIL", testDate: 604 * D, nextDueDate: 9000 * D, testerName: "Tester 504" }]);
  });

  test("a test entered late for an earlier date does not displace the truly latest one", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => { const i = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "t2")).first(); await ctx.db.patch(i!._id, { lastTestDate: 300 * D }); });
    await insertRecord(t, "e1", "t2", 100 * D, "First");
    await insertRecord(t, "e2", "t2", 300 * D, "Latest");
    await insertRecord(t, "e3", "t2", 200 * D, "Entered last");
    const r = await labels(t, ["t2"]);
    expect(r.labels[0]).toMatchObject({ testDate: 300 * D, testerName: "Latest" });
  });

  test("6+ older historic tests imported AFTER the current one do not change the label: it still shows the test at lastTestDate", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "imp", organizationId: ORG, testTagId: "TT-imp", description: "imp", status: "CURRENT", isActive: true, nextDueDate: 8000 * D, lastTestDate: 700 * D } as never);
    });
    await insertRecord(t, "cur", "imp", 700 * D, "Current tester");
    for (let i = 0; i < 8; i++) await insertRecord(t, `old${i}`, "imp", (100 + i) * D, `Historic ${i}`);
    const r = await labels(t, ["imp"]);
    expect(r.unresolved).toEqual([]);
    expect(r.labels).toEqual([{ id: "imp", testTagId: "TT-imp", result: "PASS", testDate: 700 * D, nextDueDate: 8000 * D, testerName: "Current tester" }]);
  });

  test("when no scanned record matches the item's lastTestDate the item is NOT printed and is named as unresolved (never a guess)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "lost", organizationId: ORG, testTagId: "TT-lost", description: "lost", status: "CURRENT", isActive: true, nextDueDate: 8000 * D, lastTestDate: 700 * D } as never);
    });
    for (let i = 0; i < 3; i++) await insertRecord(t, `l${i}`, "lost", (100 + i) * D, `Other ${i}`);
    const r = await labels(t, ["lost"]);
    expect(r.labels).toEqual([]);
    expect(r.unresolved).toEqual([{ id: "lost", testTagId: "TT-lost" }]);
    // The latest test is outside the 50-record scan: unresolved too, not the newest-looking row.
    await t.run(async (ctx) => { await ctx.db.insert("testTagRecords", { id: "deep", organizationId: ORG, testTagAssetId: "lost", testDate: 700 * D, testedById: "u", testerName: "Deep", result: "PASS", nextDueDate: 1 } as never); });
    for (let i = 0; i < 55; i++) await insertRecord(t, `p${i}`, "lost", (200 + i) * D, `Post ${i}`);
    expect((await labels(t, ["lost"])).unresolved).toEqual([{ id: "lost", testTagId: "TT-lost" }]);
  });
});
