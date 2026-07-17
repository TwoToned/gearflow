// @vitest-environment node
//
// convex/assets.ts `listGallery` — the asset gallery's server-side replacement
// for the 4 whole-org client subscriptions it used to filter/join in the
// browser (Finding #1 "Option A", docs/designs/perf-convex-efficiency-2026-06.md).
// Verifies: inactive assets excluded, search matches tag/serial/customName/model
// name, model+category+location are resolved, and results sort by model name.
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
    await ctx.db.insert("categories", { id: "cat1", organizationId: ORG, name: "Microphones" });
    await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "Main Warehouse" });
    await ctx.db.insert("models", { id: "mdl-shure", organizationId: ORG, name: "Shure QLXD Receiver", categoryId: "cat1" });
    await ctx.db.insert("models", { id: "mdl-avid", organizationId: ORG, name: "Avid S6 Console" });
    await ctx.db.insert("assets", {
      id: "A1", organizationId: ORG, modelId: "mdl-shure", assetTag: "MIC-001", serialNumber: "SN-100",
      locationId: "loc1", isActive: true, status: "AVAILABLE",
    });
    await ctx.db.insert("assets", {
      id: "A2", organizationId: ORG, modelId: "mdl-avid", assetTag: "CON-001", customName: "Front of house desk",
      isActive: true, status: "AVAILABLE",
    });
    await ctx.db.insert("assets", {
      id: "A3", organizationId: ORG, modelId: "mdl-shure", assetTag: "MIC-002",
      isActive: false, status: "RETIRED",
    });
  });
}

describe("assets.listGallery", () => {
  test("excludes inactive assets", async () => {
    const t = makeT();
    await seed(t);
    const rows = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG });
    expect(rows.map((r) => r.id).sort()).toEqual(["A1", "A2"]);
  });

  test("resolves model, category, and location server-side", async () => {
    const t = makeT();
    await seed(t);
    const rows = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG });
    const a1 = rows.find((r) => r.id === "A1")!;
    expect(a1.model?.name).toBe("Shure QLXD Receiver");
    expect(a1.model?.category?.name).toBe("Microphones");
    expect(a1.location?.name).toBe("Main Warehouse");
    const a2 = rows.find((r) => r.id === "A2")!;
    expect(a2.model?.category).toBeNull();
    expect(a2.location).toBeNull();
  });

  test("sorts by model name, case-insensitively", async () => {
    const t = makeT();
    await seed(t);
    const rows = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG });
    expect(rows.map((r) => r.id)).toEqual(["A2", "A1"]); // Avid before Shure
  });

  test("search matches assetTag, serialNumber, customName, and model name", async () => {
    const t = makeT();
    await seed(t);
    const byTag = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG, search: "MIC-001" });
    expect(byTag.map((r) => r.id)).toEqual(["A1"]);

    const bySerial = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG, search: "SN-100" });
    expect(bySerial.map((r) => r.id)).toEqual(["A1"]);

    const byCustomName = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG, search: "front of house" });
    expect(byCustomName.map((r) => r.id)).toEqual(["A2"]);

    const byModelName = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG, search: "shure" });
    expect(byModelName.map((r) => r.id)).toEqual(["A1"]);

    const noMatch = await t.withIdentity(asUser).query(api.assets.listGallery, { orgId: ORG, search: "nonexistent" });
    expect(noMatch).toEqual([]);
  });

  test("cross-org isolation: org 2's identity never sees org 1's assets", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: "org_2", userId: "user_2", role: "owner" });
    });
    const rows = await t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.assets.listGallery, { orgId: "org_2" });
    expect(rows).toEqual([]);
  });
});
