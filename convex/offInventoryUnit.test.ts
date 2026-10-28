// @vitest-environment node
//
// Off-inventory units (FEATUREDOCS/11, /12): converting an unassigned unit of a
// serialised model line to a "custom item" — counter on the line + one generic
// (asset-less) unit — and back.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { convertUnitToOffInventoryCore, convertUnitBackToInventoryCore } from "./warehouseOps";
import { prepUnit } from "./lib/fulfillment";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const ACTOR = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

type LineOver = Record<string, unknown>;

async function seed(t: T, line: LineOver = {}, opts: { assets?: number; assignedAssets?: number; modelType?: "SERIALIZED" | "BULK" } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "4099", assetType: opts.modelType ?? "SERIALIZED" });
    for (let i = 0; i < (opts.assets ?? 2); i++) {
      await ctx.db.insert("assets", { id: `A${i}`, organizationId: ORG, modelId: "mdl", assetTag: `A-${i}`, status: "AVAILABLE" });
    }
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P1", name: "Job", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-P1",
    });
    await ctx.db.insert("projectVersions", { id: "v-P1", organizationId: ORG, projectId: "P1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT",
      versionId: "v-P1", lineageId: "L1", isKitChild: false, createdAt: NOW, updatedAt: NOW, ...line,
    });
    for (let i = 0; i < (opts.assignedAssets ?? 0); i++) {
      await ctx.db.insert("projectLineItemUnits", {
        id: `U${i}`, organizationId: ORG, lineItemId: "L1", ordinal: i + 1, assetId: `A${i}`,
        quantity: 1, returnedQuantity: 0, status: "CONFIRMED", prepStatus: "PACKED",
      });
    }
  });
}

const base = { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW };

async function line(t: T) {
  return t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique());
}
async function units(t: T) {
  return t.run((ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect());
}

describe("convertUnitToOffInventoryCore", () => {
  test("prep:true bumps the counter and adds one PACKED generic unit", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    const res = await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }));
    expect(res.offInventoryQuantity).toBe(1);
    const l = await line(t);
    expect(l?.offInventoryQuantity).toBe(1);
    const us = (await units(t)).filter((u) => !u.assetId && !u.bulkAssetId);
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ quantity: 1, status: "CONFIRMED", prepStatus: "PACKED", ordinal: 3 });
    expect(us[0].id).toBe(res.unitId);
    expect(l?.assignedQuantity).toBe(3);
    expect(l?.packedQuantity).toBe(3);
  });

  test("prep:false creates the generic unit PENDING", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: false }));
    const us = await units(t);
    expect(us).toHaveLength(1);
    expect(us[0].prepStatus).toBe("PENDING");
  });

  test("rejects when there is no free slot", async () => {
    const t = makeT();
    await seed(t, { quantity: 2 }, { assignedAssets: 2 });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }))).rejects.toThrow(/free/i);
  });

  test("a second conversion on the same line takes the next slot, a fourth is refused", async () => {
    const t = makeT();
    await seed(t);
    for (let i = 0; i < 3; i++) await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }));
    expect((await line(t))?.offInventoryQuantity).toBe(3);
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }))).rejects.toThrow(/free/i);
  });

  test.each([
    ["a kit child", { isKitChild: true }],
    ["a kit parent", { kitId: "K1" }],
    ["a sale line", { type: "SALE" }],
    ["a sub-hire line", { subHireId: "SH1" }],
    ["an existing custom item", { isCustomItem: true }],
    ["a container line", { isContainerLineItem: true }],
    ["a cancelled line", { status: "CANCELLED" }],
    ["a line with no model", { modelId: undefined }],
  ])("rejects %s", async (_n, over) => {
    const t = makeT();
    await seed(t, over as LineOver);
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }))).rejects.toThrow();
  });

  test("rejects a bulk-backed model line", async () => {
    const t = makeT();
    await seed(t, {}, { modelType: "BULK" });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }))).rejects.toThrow(/serialised|bulk/i);
  });

  test("rejects a line from another org or project (IDOR)", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, organizationId: OTHER_ORG, prep: true })),
    ).rejects.toThrow();
    await expect(
      t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, projectId: "P_other", prep: true })),
    ).rejects.toThrow();
  });
});

describe("convertUnitBackToInventoryCore", () => {
  test("removes the custom unit and decrements the counter", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }));
    const res = await t.run((ctx) => convertUnitBackToInventoryCore(ctx, { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW }));
    expect(res.offInventoryQuantity).toBe(0);
    expect((await line(t))?.offInventoryQuantity ?? 0).toBe(0);
    expect((await units(t)).filter((u) => !u.assetId)).toHaveLength(0);
    expect((await line(t))?.assignedQuantity).toBe(2);
  });

  test("rejects when nothing is off-inventory", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.run((ctx) => convertUnitBackToInventoryCore(ctx, { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW })),
    ).rejects.toThrow();
  });

  test("rejects when the custom unit is already deployed", async () => {
    const t = makeT();
    await seed(t);
    const { unitId } = await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }));
    await t.run(async (ctx) => {
      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", unitId)).unique();
      await ctx.db.patch(u!._id, { status: "CHECKED_OUT" });
    });
    await expect(
      t.run((ctx) => convertUnitBackToInventoryCore(ctx, { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW })),
    ).rejects.toThrow(/deployed|out/i);
    expect((await line(t))?.offInventoryQuantity).toBe(1);
  });
});

describe("prepUnit on a PENDING custom unit", () => {
  test("flips it to PACKED without creating another unit", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: false }));
    await t.run((ctx) => prepUnit(ctx, { organizationId: ORG, lineItemId: "L1" }));
    const generic = (await units(t)).filter((u) => !u.assetId);
    expect(generic).toHaveLength(1);
    expect(generic[0].prepStatus).toBe("PACKED");
  });
});

describe("the counter is server-owned", () => {
  test("patchNative cannot set offInventoryQuantity", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, {
      id: "L1", orgId: ORG, set: { offInventoryQuantity: 3, notes: "x" }, clear: [], entityName: "Line item",
      allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect((await line(t))?.offInventoryQuantity).toBeUndefined();
  });

  test("patchNative refuses a quantity below the off-inventory count", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 1 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }));
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, prep: true }));
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, {
        id: "L1", orgId: ORG, set: { quantity: 1 }, clear: [], entityName: "Line item",
        allowOverbook: false, actor: ACTOR, auditId: "log2", now: NOW,
      }),
    ).rejects.toThrow(/convert/i);
  });
});

describe("warehouseWrites wrappers", () => {
  const args = { orgId: ORG, projectId: "P1", lineItemId: "L1", auditId: "audit1", now: NOW, actor: ACTOR };

  test("convert writes the unit, an audit row, and moves the job to PREPPING when prepping", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, prep: true });
    expect((await line(t))?.offInventoryQuantity).toBe(1);
    const logs = await t.run((ctx) => ctx.db.query("activityLogs").collect());
    expect(logs.find((l) => l.id === "audit1")).toMatchObject({ organizationId: ORG, projectId: "P1", userId: USER });
    const project = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).unique());
    expect(project?.status).toBe("PREPPING");
  });

  test("convert back through the wrapper restores the counter", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, prep: false });
    await t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitBackToInventory, {
      orgId: ORG, projectId: "P1", lineItemId: "L1", auditId: "audit2", now: NOW, actor: ACTOR,
    });
    expect((await line(t))?.offInventoryQuantity ?? 0).toBe(0);
  });

  test("a viewer (no warehouse:check_out) is refused", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").first();
      await ctx.db.patch(m!._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, prep: true }),
    ).rejects.toThrow();
  });

  test("a caller in another org cannot convert this org's line", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => ctx.db.insert("members", { id: "m2", organizationId: OTHER_ORG, userId: "user_2", role: "owner" }));
    await expect(
      t.withIdentity({ subject: "user_2", orgId: OTHER_ORG }).mutation(api.warehouseWrites.convertUnitToOffInventory, {
        ...args, orgId: OTHER_ORG, prep: true,
      }),
    ).rejects.toThrow();
    expect((await line(t))?.offInventoryQuantity).toBeUndefined();
  });
});
