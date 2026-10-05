// @vitest-environment node
//
// Regression — prepping an accessory parent must roll the PACKED state up onto
// each accessory CHILD LINE, not just its units. The warehouse UI reads
// `prepStatus` off the child line row, so a child whose units were packed but
// whose line was never re-synced stays "unprepped": the parent never leaves
// Pick/Prep for Deploy cleanly and Deploy flags every accessory as missing.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Handheld", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "HH1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, modelId: "m1", assetTag: "BAT", isActive: true });
    await ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: ORG, modelId: "m1", bulkAssetId: "ba1", quantity: 1, addedById: USER });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "m1", assetId: "a1",
      quantity: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("prep cascades PACKED onto accessory child lines", () => {
  test("after prepping the parent asset, every accessory child line is PACKED", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", items: [{ lineItemId: "L1", assetId: "a1" }], now: NOW,
      actor: { userId: USER, userName: "Alice" },
    });
    const children = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect())
        .filter((c) => c.childKind === "ACCESSORY"),
    );
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) expect(c.prepStatus).toBe("PACKED");
  });
  test("prep with includeAccessoryIds [] packs the parent only; a later prep packs the accessories", async () => {
    const t = makeT();
    await seed(t);
    const prep = (includeAccessoryIds?: string[]) =>
      t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
        organizationId: ORG, projectId: "p1",
        items: [{ lineItemId: "L1", assetId: "a1", ...(includeAccessoryIds ? { includeAccessoryIds } : {}) }],
        now: NOW, actor: { userId: USER, userName: "Alice" },
      });
    const accessoryUnits = () =>
      t.run(async (ctx) => {
        const kids = (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect())
          .filter((c) => c.childKind === "ACCESSORY");
        const units = [];
        for (const k of kids) units.push(...(await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect()));
        return units;
      });
    const parentPacked = () =>
      t.run(async (ctx) => (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect()).map((u) => u.prepStatus));

    await prep([]);
    expect(await parentPacked()).toEqual(["PACKED"]);
    expect((await accessoryUnits()).filter((u) => u.prepStatus === "PACKED")).toHaveLength(0);

    await prep();
    const after = await accessoryUnits();
    expect(after.length).toBeGreaterThan(0);
    for (const u of after) expect(u.prepStatus).toBe("PACKED");
  });
  test("accessoriesOnly packs accessories into their own container without touching the parent", async () => {
    const t = makeT();
    await seed(t);
    const run = (item: Record<string, unknown>) =>
      t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
        organizationId: ORG, projectId: "p1", items: [{ lineItemId: "L1", assetId: "a1", ...item }] as never,
        now: NOW, actor: { userId: USER, userName: "Alice" },
      });
    const units = (lineId: string) => t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineId)).collect());

    // Not prepped yet → refused.
    await expect(run({ accessoriesOnly: true })).rejects.toThrow(/Prep the item/);

    await run({ includeAccessoryIds: [], containerId: "pelican" });
    const [parentBefore] = await units("L1");
    expect(parentBefore.containerId).toBe("pelican");

    await run({ accessoriesOnly: true, containerId: "battery-box" });
    const [parentAfter] = await units("L1");
    expect(parentAfter.containerId).toBe("pelican");
    expect(parentAfter.updatedAt).toBe(parentBefore.updatedAt);
    const kids = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect()).filter((c) => c.childKind === "ACCESSORY"));
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) for (const u of await units(k.id)) {
      expect(u.prepStatus).toBe("PACKED");
      expect(u.containerId).toBe("battery-box");
    }
  });
  test("deploy-all: the parent ships with its own box; accessories in another box ship with THAT box, and each container flips", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (const [id, li] of [["pelican", "CL1"], ["battery-box", "CL2"]] as const) {
        await ctx.db.insert("projectLineItems", { id: li, organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, status: "CONFIRMED", isContainerLineItem: true, createdAt: NOW, updatedAt: NOW });
        await ctx.db.insert("projectContainers", { id, organizationId: ORG, projectId: "p1", kind: "CUSTOM", label: id, lineItemId: li, createdAt: NOW, updatedAt: NOW } as never);
      }
    });
    const prep = (item: Record<string, unknown>) =>
      t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
        organizationId: ORG, projectId: "p1", items: [{ lineItemId: "L1", assetId: "a1", ...item }] as never,
        now: NOW, actor: { userId: USER, userName: "Alice" },
      });
    await prep({ includeAccessoryIds: [], containerId: "pelican" });
    await prep({ accessoriesOnly: true, containerId: "battery-box" });

    await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, items: [{ lineItemId: "L1", assetId: "a1" }], includeAccessories: true, now: NOW,
    });
    const readState = () => t.run(async (ctx) => {
      const kids = (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect()).filter((c) => c.childKind === "ACCESSORY");
      const kidUnits = [];
      for (const k of kids) kidUnits.push(...(await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect()));
      const lines = await ctx.db.query("projectLineItems").collect();
      return {
        parent: (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect()).map((u) => u.status),
        kidIds: kidUnits.map((u) => u.id),
        kids: kidUnits.map((u) => u.status),
        pelican: lines.find((l) => l.id === "CL1")?.status,
        batteryBox: lines.find((l) => l.id === "CL2")?.status,
      };
    });

    // The parent's deploy leaves accessories packed in a DIFFERENT box alone
    // (accessoryRelocation.ts) — they ship with their own box.
    let state = await readState();
    expect(state.parent).toEqual(["CHECKED_OUT"]);
    expect(state.kids.length).toBeGreaterThan(0);
    for (const s of state.kids) expect(s).not.toBe("CHECKED_OUT");
    expect(state.pelican).toBe("CHECKED_OUT");
    expect(state.batteryBox).not.toBe("CHECKED_OUT");

    // "Deploy all" = the parent's row plus the relocated accessory row.
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.stageAccessoryUnits, {
      organizationId: ORG, projectId: "p1", userId: USER, unitIds: state.kidIds, to: "DEPLOY", now: NOW,
    });
    state = await readState();
    for (const s of state.kids) expect(s).toBe("CHECKED_OUT");
    expect(state.batteryBox).toBe("CHECKED_OUT");
  });
});
