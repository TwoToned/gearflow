// @vitest-environment node
//
// Off-inventory units (FEATUREDOCS/11, /12): converting an unassigned unit of a
// serialised model line to a "custom item" — counter on the line + one generic
// (asset-less) unit — and back.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { convertUnitToOffInventoryCore, convertUnitBackToInventoryCore, checkoutItemsCore, checkinItemsCore } from "./warehouseOps";

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
  registerShardedCounter(t, "shardedCounter");
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
  test("bumps the counter and adds one PACKED generic unit", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    const res = await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
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

  test("rejects when there is no free slot", async () => {
    const t = makeT();
    await seed(t, { quantity: 2 }, { assignedAssets: 2 });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow(/free/i);
  });

  test("a second conversion on the same line takes the next slot, a fourth is refused", async () => {
    const t = makeT();
    await seed(t);
    for (let i = 0; i < 3; i++) await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
    expect((await line(t))?.offInventoryQuantity).toBe(3);
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow(/free/i);
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
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow();
  });

  test("rejects a bulk-backed model line", async () => {
    const t = makeT();
    await seed(t, {}, { modelType: "BULK" });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow(/serialised|bulk/i);
  });

  test("rejects a line from another org or project (IDOR)", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, organizationId: OTHER_ORG })),
    ).rejects.toThrow();
    await expect(
      t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base, projectId: "P_other" })),
    ).rejects.toThrow();
  });
});

describe("convertUnitBackToInventoryCore", () => {
  test("removes the custom unit and decrements the counter", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
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
    const { unitId } = await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
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
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
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
    await t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, startPrep: true });
    expect((await line(t))?.offInventoryQuantity).toBe(1);
    const logs = await t.run((ctx) => ctx.db.query("activityLogs").collect());
    expect(logs.find((l) => l.id === "audit1")).toMatchObject({ organizationId: ORG, projectId: "P1", userId: USER });
    const project = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).unique());
    expect(project?.status).toBe("PREPPING");
  });

  test("a planning-time conversion (startPrep:false) is prepped but does not move the job to PREPPING", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, startPrep: false });
    const generic = (await units(t)).filter((u) => !u.assetId);
    expect(generic).toHaveLength(1);
    expect(generic[0].prepStatus).toBe("PACKED");
    const project = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).unique());
    expect(project?.status).toBe("CONFIRMED");
  });

  test("convert back through the wrapper restores the counter", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, startPrep: false });
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
      t.withIdentity(asUser).mutation(api.warehouseWrites.convertUnitToOffInventory, { ...args, startPrep: true }),
    ).rejects.toThrow();
  });

  test("a caller in another org cannot convert this org's line", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => ctx.db.insert("members", { id: "m2", organizationId: OTHER_ORG, userId: "user_2", role: "owner" }));
    await expect(
      t.withIdentity({ subject: "user_2", orgId: OTHER_ORG }).mutation(api.warehouseWrites.convertUnitToOffInventory, {
        ...args, orgId: OTHER_ORG, startPrep: true,
      }),
    ).rejects.toThrow();
    expect((await line(t))?.offInventoryQuantity).toBeUndefined();
  });
});

describe("custom unit through deploy and return (existing generic-unit flow)", () => {
  test("deploying the whole line deploys the custom unit too, and a whole-line return brings it back", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    const { unitId } = await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
    const common = { organizationId: ORG, projectId: "P1", userId: USER, now: NOW };

    await t.run((ctx) => checkoutItemsCore(ctx, { ...common, items: [{ lineItemId: "L1" }], includeAccessories: false }));
    let us = await units(t);
    expect(us).toHaveLength(3);
    expect(us.every((u) => u.status === "CHECKED_OUT")).toBe(true);
    expect((await line(t))?.status).toBe("CHECKED_OUT");

    await t.run((ctx) => checkinItemsCore(ctx, { ...common, items: [{ lineItemId: "L1", returnCondition: "GOOD" }] }));
    us = await units(t);
    expect(us.every((u) => u.status === "RETURNED")).toBe(true);

    // A returned custom unit is history: it can't be converted back.
    expect(us.find((u) => u.id === unitId)?.status).toBe("RETURNED");
    await expect(
      t.run((ctx) => convertUnitBackToInventoryCore(ctx, { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW })),
    ).rejects.toThrow(/deployed|return/i);
  });
});

// ─── Review findings (whole-branch review, 2026-10-28) ────────────────────────

const SERVICE = { subject: "gearflow-service", svc: true };

describe("de-prep keeps the counter in step with the unit rows (review #1)", () => {
  test("removing the custom unit from prep returns it to inventory (counter decremented)", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base })); // custom unit is the NEWEST unit
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepItem, { organizationId: ORG, projectId: "P1", lineItemId: "L1", quantity: 1, now: NOW });
    expect((await units(t)).filter((u) => !u.assetId)).toHaveLength(0);
    expect((await line(t))?.offInventoryQuantity ?? 0).toBe(0);
    // ...so the slot is a plain free slot again and can be re-converted.
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).resolves.toMatchObject({ offInventoryQuantity: 1 });
  });

  test("a fully custom line de-prepped one at a time loses one custom unit each time", async () => {
    const t = makeT();
    await seed(t);
    for (let i = 0; i < 3; i++) await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepItem, { organizationId: ORG, projectId: "P1", lineItemId: "L1", quantity: 2, now: NOW });
    expect((await units(t)).filter((u) => !u.assetId)).toHaveLength(1);
    expect((await line(t))?.offInventoryQuantity).toBe(1);
  });

  test("de-prepping serials leaves the custom unit and counter alone", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
    // Only the 2 serial units + 1 custom exist; ask to remove 1: LIFO removes the custom unit (newest),
    // never a serial while a custom one is newer — the counter must follow whichever went.
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepItem, { organizationId: ORG, projectId: "P1", lineItemId: "L1", quantity: 1, now: NOW });
    const l = await line(t);
    const generic = (await units(t)).filter((u) => !u.assetId).length;
    expect(l?.offInventoryQuantity ?? 0).toBe(generic);
  });
});

describe("convert preconditions added by review (#4, #9)", () => {
  test("a line pinned to a specific asset (line.assetId) is not convertible", async () => {
    const t = makeT();
    await seed(t, { quantity: 1, assetId: "A0" });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow(/specific|asset/i);
  });

  test.each(["COMPLETED", "INVOICED", "CANCELLED"])("a %s project is not convertible", async (status) => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).unique();
      await ctx.db.patch(p!._id, { status: status as never });
    });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow(/project|status/i);
  });

  test("a line on a non-live version is not convertible", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: "v-P1-b", organizationId: ORG, projectId: "P1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1" });
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique();
      await ctx.db.patch(l!._id, { versionId: "v-P1-b" });
    });
    await expect(t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }))).rejects.toThrow(/live|version/i);
  });
});

describe("patchNative keeps custom units coherent (review #6, #7)", () => {
  const patch = (t: T, set: Record<string, unknown>, clear: string[] = [], auditId = "audit-p") =>
    t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, {
      id: "L1", orgId: ORG, set, clear, entityName: "Line item", allowOverbook: true, actor: ACTOR, auditId, now: NOW,
    });

  test("lowering quantity below custom + serial units is refused, not silently dropping a serial", async () => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 2 });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base })); // 2 serials + 1 custom of 3
    await expect(patch(t, { quantity: 2 })).rejects.toThrow(/custom|assigned|remove/i);
    await patch(t, { quantity: 3, notes: "ok" }); // unchanged quantity is fine
  });

  test.each([
    ["model", { modelId: "mdl2" }, [] as string[]],
    ["clearing the model", {}, ["modelId"]],
    ["pinning an asset", { assetId: "A0" }, []],
    ["type", { type: "SALE" }, []],
  ])("changing the %s of a line with custom units is refused", async (_n, set, clear) => {
    const t = makeT();
    await seed(t, {}, { assignedAssets: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "mdl2", organizationId: ORG, name: "4099e", assetType: "SERIALIZED" });
    });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, { ...base }));
    await expect(patch(t, set, clear)).rejects.toThrow(/custom|convert/i);
  });
});
