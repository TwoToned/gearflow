// @vitest-environment node
//
// convex/kits.ts `listPage` — the kits page's server-side replacement for the
// 3 whole-org client subscriptions (useKits/useCategories/useLocations) it
// used to filter/join/sort in the browser (Finding #1,
// docs/designs/perf-convex-efficiency-2026-06.md).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("categories", { id: "cat1", organizationId: ORG, name: "Backline" });
    await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "Main Warehouse" });
    await ctx.db.insert("kits", {
      id: "K1", organizationId: ORG, assetTag: "KIT-001", name: "Drum Kit A",
      categoryId: "cat1", locationId: "loc1", status: "AVAILABLE", isActive: true, isPrep: false,
    });
    await ctx.db.insert("kits", {
      id: "K2", organizationId: ORG, assetTag: "KIT-002", name: "Backline B",
      status: "CHECKED_OUT", isActive: true, isPrep: false,
    });
    await ctx.db.insert("kits", {
      id: "K3", organizationId: ORG, assetTag: "KIT-003", name: "Archived kit",
      status: "AVAILABLE", isActive: false, isPrep: false,
    });
    await ctx.db.insert("kits", {
      id: "K4", organizationId: ORG, assetTag: "KIT-004", name: "Prep kit",
      status: "AVAILABLE", isActive: true, isPrep: true,
    });
  });
}

describe("kits.listPage", () => {
  test("excludes archived (isActive:false) and prep (isPrep:true) kits", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.kits.listPage, { orgId: ORG });
    expect(result.items.map((k) => k.id).sort()).toEqual(["K1", "K2"]);
  });

  test("resolves category and location server-side", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.kits.listPage, { orgId: ORG });
    const k1 = result.items.find((k) => k.id === "K1")!;
    expect(k1.category?.name).toBe("Backline");
    expect(k1.location?.name).toBe("Main Warehouse");
    const k2 = result.items.find((k) => k.id === "K2")!;
    expect(k2.category).toBeNull();
    expect(k2.location).toBeNull();
  });

  test("filters by status", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.kits.listPage, { orgId: ORG, status: "CHECKED_OUT" });
    expect(result.items.map((k) => k.id)).toEqual(["K2"]);
  });

  test("search matches assetTag and name", async () => {
    const t = makeT();
    await seed(t);
    const byTag = await t.withIdentity(asUser).query(api.kits.listPage, { orgId: ORG, search: "KIT-001" });
    expect(byTag.items.map((k) => k.id)).toEqual(["K1"]);
    const byName = await t.withIdentity(asUser).query(api.kits.listPage, { orgId: ORG, search: "backline" });
    expect(byName.items.map((k) => k.id)).toEqual(["K2"]);
  });

  test("sorts by the joined category name", async () => {
    const t = makeT();
    await seed(t);
    const asc = await t.withIdentity(asUser).query(api.kits.listPage, { orgId: ORG, sortBy: "category", sortOrder: "asc" });
    expect(asc.items.map((k) => k.id)).toEqual(["K1", "K2"]); // K1 has a category, K2 null (sorts last)
  });

  test("cross-org isolation", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: "org_2", userId: "user_2", role: "owner" });
    });
    const result = await t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.kits.listPage, { orgId: "org_2" });
    expect(result.items).toEqual([]);
  });
});
