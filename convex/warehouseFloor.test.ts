// @vitest-environment node
//
// warehouseFloor — the floor's Returning mode reads (spec §9c.4).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof makeT>;

async function job(t: T, id: string, status: string, orgId = ORG, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `#${id}`, name: `Job ${id}`, status: status as "CHECKED_OUT",
      isTemplate: false, total: 0, liveVersionId: `v-${id}`, ...extra,
    });
    await ctx.db.insert("projectVersions", { id: `v-${id}`, organizationId: orgId, projectId: id, number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
  });
}

const line = (id: string, projectId: string, extra: Record<string, unknown> = {}, orgId = ORG) => ({
  id, organizationId: orgId, projectId, type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CHECKED_OUT" as const, isKitChild: false, versionId: `v-${projectId}`, lineageId: id, createdAt: NOW, updatedAt: NOW, ...extra,
});

describe("warehouseFloor.returning", () => {
  test("groups by job with per-line outcomes, nests accessories, and counts late-back units", async () => {
    const t = makeT();
    await job(t, "p1", "CHECKED_OUT", ORG, { projectEndDate: NOW });
    await job(t, "p2", "RETURNED", ORG, { projectEndDate: NOW + 10 * DAY });
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR Can", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", line("l1", "p1", { modelId: "m1", quantity: 4, checkedOutQuantity: 2, returnedQuantity: 2, damagedQuantity: 1 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 0, quantity: 1, status: "RETURNED", returnedAt: NOW + 3 * DAY });
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l1", ordinal: 1, quantity: 1, status: "RETURNED", returnedAt: NOW + 3600_000 });
      await ctx.db.insert("projectLineItems", line("acc", "p1", { isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "l1", description: "Clamp", quantity: 4, checkedOutQuantity: 4 }));
      await ctx.db.insert("projectLineItems", line("svc", "p1", { type: "LABOUR", status: "CONFIRMED" }));
      await ctx.db.insert("projectLineItems", line("notOut", "p1", { status: "CONFIRMED" }));
      await ctx.db.insert("projectLineItems", line("r1", "p2", { status: "RETURNED", description: "Cable", quantity: 3, returnedQuantity: 3 }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseFloor.returning, { orgId: ORG });
    expect(res.truncated).toBe(false);
    expect(res.groups.map((g) => g.projectId)).toEqual(["p1", "p2"]); // earliest end first
    const g1 = res.groups[0];
    expect(g1.lines.map((l) => l.lineItemId)).toEqual(["l1"]);
    expect(g1.lines[0]).toMatchObject({ description: "PAR Can", quantity: 4, out: 2, back: 2, damaged: 1, lateBack: 1 });
    expect(g1.lines[0].accessories).toEqual([{ lineItemId: "acc", description: "Clamp", quantity: 4, out: 4, back: 0 }]);
    expect(res.totals).toEqual({ out: 2, back: 5, damaged: 1, missing: 0, lateBack: 1 });
  });

  test("cross-tenant: a foreign org's jobs and lines never appear, even on our version id", async () => {
    const t = makeT();
    await job(t, "p1", "CHECKED_OUT");
    await job(t, "pX", "CHECKED_OUT", OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", line("l1", "p1", { checkedOutQuantity: 1 }));
      await ctx.db.insert("projectLineItems", line("lX", "pX", { checkedOutQuantity: 1 }, OTHER));
      // A foreign row stamped with OUR version id, and one of ours pointing at THEIR job.
      await ctx.db.insert("projectLineItems", line("lY", "p1", { checkedOutQuantity: 9, description: "Theirs" }, OTHER));
      await ctx.db.insert("projectLineItems", line("lZ", "pX", { checkedOutQuantity: 1, versionId: "v-pX" }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseFloor.returning, { orgId: ORG });
    expect(res.groups.map((g) => g.projectId)).toEqual(["p1"]);
    expect(res.groups[0].lines.map((l) => l.lineItemId)).toEqual(["l1"]);
    expect(JSON.stringify(res)).not.toContain("Theirs");
  });

  test("excludes templates and rejects a caller from another org", async () => {
    const t = makeT();
    await job(t, "pT", "CHECKED_OUT", ORG, { isTemplate: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", line("l1", "pT", { checkedOutQuantity: 1 }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseFloor.returning, { orgId: ORG });
    expect(res.groups).toEqual([]);
    await expect(t.withIdentity(asUser(OTHER)).query(api.warehouseFloor.returning, { orgId: ORG })).rejects.toThrow();
  });
});

describe("warehouseFloor.lineUnits", () => {
  test("returns every unit with its outcome and late-back", async () => {
    const t = makeT();
    await job(t, "p1", "CHECKED_OUT", ORG, { projectEndDate: NOW });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "SK-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", line("l1", "p1", { quantity: 2 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l1", ordinal: 1, quantity: 1, status: "RETURNED", returnCondition: "DAMAGED", returnedAt: NOW + 2 * DAY });
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT" });
      await ctx.db.insert("projectLineItemUnits", { id: "uX", organizationId: OTHER, lineItemId: "l1", ordinal: 2, quantity: 1, status: "CHECKED_OUT" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseFloor.lineUnits, { orgId: ORG, lineItemId: "l1" });
    expect(res?.windowEnd).toBe(NOW);
    expect(res?.units.map((u) => [u.unitId, u.assetTag, u.status, u.returnCondition, u.lateBack])).toEqual([
      ["u1", "SK-1", "CHECKED_OUT", null, false],
      ["u2", null, "RETURNED", "DAMAGED", true],
    ]);
  });

  test("cross-tenant: a foreign line, or our line on a foreign job, returns nothing", async () => {
    const t = makeT();
    await job(t, "pX", "CHECKED_OUT", OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", line("lX", "pX", {}, OTHER));
      await ctx.db.insert("projectLineItems", line("lMine", "pX", { versionId: "v-pX" }));
    });
    const q = (lineItemId: string) => t.withIdentity(asUser(ORG)).query(api.warehouseFloor.lineUnits, { orgId: ORG, lineItemId });
    expect(await q("lX")).toBeNull();
    expect(await q("lMine")).toBeNull();
  });
});
