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
