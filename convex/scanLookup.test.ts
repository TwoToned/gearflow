// @vitest-environment node
//
// scanLookup.resolve — the floor's `Look up` mode (spec §9c.3): navigation
// target plus the jobs a tag is on right now, and the kit/accessory guards.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof makeT>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m-1", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR Can", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Gala", status: "PREPPING", total: 0 });
    await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "2342", name: "Tour", status: "CHECKED_OUT", total: 0 });
    await ctx.db.insert("projects", { id: "pX", organizationId: OTHER, projectNumber: "9999", name: "Their gig", status: "CHECKED_OUT", total: 0 });
  });
}

const line = (id: string, projectId: string, extra: Record<string, unknown> = {}, orgId = ORG) => ({
  id, organizationId: orgId, projectId, type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CONFIRMED" as const, isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

describe("scanLookup.resolve", () => {
  test("an asset packed for one job and out on another reports both, by state", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "SK-0012", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", line("l1", "p1", { assetId: "a1", status: "PREPPED" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 0, assetId: "a1", quantity: 1, status: "PREPPED", prepStatus: "PACKED" });
      await ctx.db.insert("projectLineItems", line("l2", "p2", { assetId: "a1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l2", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.scanLookup.resolve, { orgId: ORG, value: "SK-0012" });
    expect(res.url).toBe("/assets/registry/a1");
    expect(res.guard).toBeNull();
    expect(res.activity.map((a) => [a.projectNumber, a.state]).sort()).toEqual([["2341", "packed"], ["2342", "out"]]);
  });

  test("cross-tenant: a unit whose line points at a foreign project is never reported", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "SK-1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      // Our unit row, our line row, but the line's projectId is someone else's job.
      await ctx.db.insert("projectLineItems", line("l1", "pX", { assetId: "a1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT" });
      // A foreign line under our unit id.
      await ctx.db.insert("projectLineItems", line("lF", "p2", { assetId: "a1", status: "CHECKED_OUT" }, OTHER));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "lF", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.scanLookup.resolve, { orgId: ORG, value: "SK-1" });
    expect(res.activity).toEqual([]);
    expect(JSON.stringify(res)).not.toContain("Their gig");
  });

  test("a kit member carries the kit guard; a foreign kit's tag is not disclosed", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Kit", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("kits", { id: "kX", organizationId: OTHER, assetTag: "K-X", name: "Theirs", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", kitId: "k1", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "A-2", status: "AVAILABLE", kitId: "kX", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a3", organizationId: ORG, modelId: "m1", assetTag: "A-3", status: "AVAILABLE", parentAssetId: "a1", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const q = (value: string) => t.withIdentity(asUser(ORG)).query(api.scanLookup.resolve, { orgId: ORG, value });
    expect((await q("A-1")).guard).toEqual({ kind: "kit_member", kitTag: "K-1" });
    expect((await q("A-2")).guard).toEqual({ kind: "kit_member", kitTag: null });
    expect((await q("A-3")).guard).toEqual({ kind: "accessory_child", parentTag: "A-1" });
  });

  test("a kit tag reports the job its parent line is on", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Kit", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", line("lk", "p2", { kitId: "k1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", line("lkm", "p2", { kitId: "k1", isKitChild: true, status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", line("lkF", "pX", { kitId: "k1", status: "CHECKED_OUT" }, OTHER));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.scanLookup.resolve, { orgId: ORG, value: "K-1" });
    expect(res.activity).toEqual([
      { projectId: "p2", projectNumber: "2342", projectName: "Tour", lineItemId: "lk", state: "out", quantity: 1 },
    ]);
  });

  test("a bulk bin out on two jobs reports the outstanding quantity per job", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BIN-1", totalQuantity: 50, availableQuantity: 10, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", line("l1", "p1", { bulkAssetId: "b1", status: "CHECKED_OUT", quantity: 10 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 0, bulkAssetId: "b1", quantity: 10, returnedQuantity: 4, status: "CHECKED_OUT" });
      await ctx.db.insert("projectLineItems", line("l2", "p2", { bulkAssetId: "b1", status: "CHECKED_OUT", quantity: 5 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l2", ordinal: 0, bulkAssetId: "b1", quantity: 5, status: "CHECKED_OUT" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.scanLookup.resolve, { orgId: ORG, value: "BIN-1" });
    expect(res.activity.map((a) => [a.projectNumber, a.quantity]).sort()).toEqual([["2341", 6], ["2342", 5]]);
  });

  test("unknown and unsafe tags resolve to nothing; a foreign org caller is rejected", async () => {
    const t = makeT();
    await seed(t);
    const q = (value: string) => t.withIdentity(asUser(ORG)).query(api.scanLookup.resolve, { orgId: ORG, value });
    expect(await q("nope")).toEqual({ url: null, label: null, activity: [], guard: null });
    expect(await q("<script>")).toEqual({ url: null, label: null, activity: [], guard: null });
    await expect(
      t.withIdentity(asUser(OTHER)).query(api.scanLookup.resolve, { orgId: ORG, value: "nope" }),
    ).rejects.toThrow();
  });
});

// ─── Phase 16: the Scan page's result card (checkCard / testCard) ────────────────
describe("scanLookup.checkCard / testCard", () => {
  async function seedCard(t: T) {
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
      await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "Warehouse A" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "AURA-01", serialNumber: "SN1", locationId: "loc1", condition: "FAIR", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", line("l2", "p2", { assetId: "a1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l2", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT" });
      const p2 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p2")).first();
      await ctx.db.patch(p2!._id, { projectEndDate: NOW + 3 * 86_400_000 });
      await ctx.db.insert("modelCheckItems", { id: "mci1", organizationId: ORG, modelId: "m1", checkItemId: "ci1" });
      await ctx.db.insert("modelCheckItems", { id: "mci2", organizationId: ORG, modelId: "m1", checkItemId: "ci2" });
      // Last check: two items saved together (one failed), an older one before.
      for (const [id, at, result] of [["c0", NOW - 9000, "PASS"], ["c1", NOW, "PASS"], ["c2", NOW, "FAIL"]] as const) {
        await ctx.db.insert("checkRecords", { id, organizationId: ORG, context: "AD_HOC", assetId: "a1", checkItemId: "ci1", checkItemLabelSnapshot: "V", checkItemTypeSnapshot: "PASS_FAIL", result, performedById: USER, performedAt: at });
      }
      await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, testTagId: "TT-0412", description: "Aura", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", assetId: "a1", status: "OVERDUE", nextDueDate: NOW - 86_400_000, testIntervalMonths: 3, isActive: true });
      await ctx.db.insert("testProfiles", { id: "prof1", organizationId: ORG, name: "Class I appliance", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", isDefault: true, isActive: true, visualChecks: [], electricalTests: [{ key: "earthContinuity", enabled: true }], thresholds: {} });
    });
  }
  const card = (t: T, value: string, orgId = ORG) => t.withIdentity(asUser(orgId)).query(api.scanLookup.checkCard, { orgId, value });

  test("an asset tag returns the identity and the four facts", async () => {
    const t = makeT(); await seedCard(t);
    const c = await card(t, "AURA-01");
    expect(c.kind).toBe("asset");
    expect(c.asset).toMatchObject({ id: "a1", assetTag: "AURA-01", serialNumber: "SN1", modelName: "PAR Can", status: "CHECKED_OUT", condition: "FAIR" });
    expect(c.location).toEqual({ id: "loc1", name: "Warehouse A" });
    expect(c.job).toEqual({ projectId: "p2", projectNumber: "2342", projectName: "Tour", lineItemId: "l2", state: "out", backAt: NOW + 3 * 86_400_000 });
    expect(c.lastCheck).toEqual({ at: NOW, byName: "Alice", total: 2, failed: 1, truncated: false });
    expect(c.checkItemCount).toBe(2);
    expect(c.tt).toMatchObject({ id: "tt1", testTagId: "TT-0412", status: "OVERDUE", testIntervalMonths: 3 });
  });

  test("a test tag reaches the same asset card", async () => {
    const t = makeT(); await seedCard(t);
    const byTag = await card(t, "AURA-01");
    const byTt = await card(t, "TT-0412");
    expect({ ...byTt, tag: "x" }).toEqual({ ...byTag, tag: "x" });
  });

  test("kit, bulk, T&T-only and unknown tags each report their kind", async () => {
    const t = makeT(); await seedCard(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Truss kit", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BIN-1", status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("testTagAssets", { id: "tt2", organizationId: ORG, testTagId: "TT-9", description: "Kettle", status: "CURRENT", isActive: true });
    });
    expect((await card(t, "K-1"))).toMatchObject({ kind: "kit", kit: { id: "k1", name: "Truss kit" }, asset: null });
    expect((await card(t, "BIN-1"))).toMatchObject({ kind: "bulk", bulk: { id: "b1", modelName: "PAR Can" } });
    expect((await card(t, "TT-9"))).toMatchObject({ kind: "ttOnly", asset: null, tt: { id: "tt2", description: "Kettle" } });
    expect((await card(t, "nope"))).toMatchObject({ kind: "unknown", tag: "nope", asset: null, tt: null });
    expect((await card(t, "<script>"))).toMatchObject({ kind: "unknown" });
  });

  test("org mismatch: foreign location, project, line, model and T&T row are never returned", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "locX", organizationId: OTHER, name: "Their shed" });
      await ctx.db.insert("models", { id: "mX", organizationId: OTHER, name: "Their model", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mX", assetTag: "A-1", locationId: "locX", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      // Our unit, but its line points at a foreign job; and a foreign line under our unit.
      await ctx.db.insert("projectLineItems", line("l1", "pX", { assetId: "a1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT" });
      // A foreign T&T row that names our asset, and our test tag linked to a foreign asset.
      await ctx.db.insert("testTagAssets", { id: "ttX", organizationId: OTHER, testTagId: "TT-X", description: "Theirs", assetId: "a1", isActive: true });
      await ctx.db.insert("assets", { id: "aX", organizationId: OTHER, modelId: "mX", assetTag: "THEIRS", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("testTagAssets", { id: "tt9", organizationId: ORG, testTagId: "TT-9", description: "Ours", assetId: "aX", isActive: true });
    });
    const c = await card(t, "A-1");
    expect(c.location).toBeNull();
    expect(c.job).toBeNull();
    expect(c.asset?.modelName).toBeNull();
    expect(c.tt).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/Their|TT-X/);
    // Our test tag linked to a foreign asset never discloses it.
    const tt = await card(t, "TT-9");
    expect(tt.kind).toBe("ttOnly");
    expect(JSON.stringify(tt)).not.toContain("THEIRS");
    // A caller from another org is rejected outright; another org's tag is unknown here.
    await expect(t.withIdentity(asUser(OTHER)).query(api.scanLookup.checkCard, { orgId: ORG, value: "A-1" })).rejects.toThrow();
    expect((await card(t, "THEIRS")).kind).toBe("unknown");
  });

  test("bounded last check: a group that fills the read window is flagged truncated", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("checkRecords", { id: `c${i}`, organizationId: ORG, context: "AD_HOC", assetId: "a1", checkItemId: `ci${i}`, checkItemLabelSnapshot: "V", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: USER, performedAt: NOW });
      }
    });
    expect((await card(t, "A-1")).lastCheck).toMatchObject({ total: 50, truncated: true });
  });

  // The two reads differ only in their resource (`warehouse` vs `testTag`), which is what
  // an API key's scopes are intersected against — so a testTag-only key reaches testCard
  // (Q12). For a member the resource-scoped read is the same org check.
  test("testCard adds the resolved profile; a viewer (testTag:read, no warehouse) can use it", async () => {
    const t = makeT(); await seedCard(t);
    const asViewer = { subject: "user_v", orgId: ORG };
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m-v", organizationId: ORG, userId: "user_v", role: "viewer" }); });
    const c = await t.withIdentity(asViewer).query(api.scanLookup.testCard, { orgId: ORG, value: "TT-0412" });
    expect(c.kind).toBe("asset");
    expect(c.profile).toMatchObject({ id: "prof1", name: "Class I appliance", requiresSubTests: false });
    // No T&T row → no profile.
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "NOTT", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    expect((await t.withIdentity(asViewer).query(api.scanLookup.testCard, { orgId: ORG, value: "NOTT" })).profile).toBeNull();
  });

  test("a testTag-only API key gets no project, location or check data from testCard", async () => {
    const t = makeT(); await seedCard(t);
    const key = (id: string, scopes: string[]) => t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id, organizationId: ORG, name: id, prefix: "gf_live_aaaaaa", tokenHash: "h" + id,
        scopes: JSON.stringify(scopes), isActive: true, actingUserId: USER, createdById: USER,
      });
    });
    await key("k-tt", ["testTag:read"]);
    await key("k-all", ["testTag:read", "warehouse:read", "project:read"]);
    const asKey = (akid: string) => ({ subject: USER, orgId: ORG, akid });

    const narrow = await t.withIdentity(asKey("k-tt")).query(api.scanLookup.testCard, { orgId: ORG, value: "TT-0412" });
    expect(narrow.kind).toBe("asset");
    expect(narrow.tt).toMatchObject({ id: "tt1" });
    expect(narrow.profile).toMatchObject({ id: "prof1" });
    expect(narrow.job).toBeNull();
    expect(narrow.location).toBeNull();
    expect(narrow.lastCheck).toBeNull();
    expect(narrow.checkItemCount).toBe(0);
    expect(JSON.stringify(narrow)).not.toMatch(/Tour|Warehouse A|2342/);

    const wide = await t.withIdentity(asKey("k-all")).query(api.scanLookup.testCard, { orgId: ORG, value: "TT-0412" });
    expect(wide.job).toMatchObject({ projectNumber: "2342" });
    expect(wide.location).toEqual({ id: "loc1", name: "Warehouse A" });
    expect(wide.lastCheck).toMatchObject({ total: 2 });
  });
});
