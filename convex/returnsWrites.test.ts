// @vitest-environment node
//
// Org-wide returns-station writes (issue #944 WS5). Verifies: server-derived
// projectId (no projectId argument exists anywhere in returnScanNative/
// returnBatchNative), cross-tenant line rejection, viewer RBAC denial, batch cap
// enforcement + partial-success labelled results, the last-unit-returned
// auto-advance-to-RETURNED side effect, and post-hoc condition correction.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const SPOOF = { userId: "attacker_id", userName: "Mallory" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function member(t: T, role: string, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${orgId}-${role}`, organizationId: orgId, userId: USER, role });
  });
}

async function seedProject(t: T, id: string, orgId = ORG, status: string = "CHECKED_OUT") {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: status as never,
      total: 0,
    });
  });
}

async function seedModelAsset(t: T, assetId = "a1", tag = "A-1", orgId = ORG) {
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
    if (!existing) await ctx.db.insert("models", { id: "m1", organizationId: orgId, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: assetId, organizationId: orgId, modelId: "m1", assetTag: tag, status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}

const baseLine = (id: string, projectId: string, extra: Record<string, unknown>, orgId = ORG) => ({
  id, organizationId: orgId, projectId, type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CHECKED_OUT" as const, checkedOutQuantity: 1, isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

const unitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const assetById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const projectById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const logById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("returnScanNative", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("returns a serialised unit, deriving projectId server-side (no projectId arg exists)", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.projectId).toBe("p1");
    expect(res.updatedLineIds).toEqual(["li1"]);
    expect((await unitById(t, "u1"))?.status).toBe("RETURNED");
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CHECK_IN");
    expect(log?.userId).toBe(USER); // spoofed actor overridden by verified token subject
    expect(log?.projectId).toBe("p1");
  });

  test("cross-org line item rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("liX", "pX", { modelId: "m1" }, OTHER));
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
        orgId: ORG, lineItemId: "liX", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
        orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("auto-advances the project to RETURNED when the last outstanding line comes back", async () => {
    const t = makeT();
    await seed(t); // only li1 is CHECKED_OUT on p1
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.autoAdvanced).toBe(true);
    expect((await projectById(t, "p1"))?.status).toBe("RETURNED");
  });

  test("does NOT auto-advance while another line on the project is still checked out", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li2", "p1", { modelId: "m1" }));
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.autoAdvanced).toBe(false);
    expect((await projectById(t, "p1"))?.status).toBe("CHECKED_OUT");
  });
});

describe("returnBatchNative", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t, "a1", "A-1");
    await seedModelAsset(t, "a2", "A-2");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li2", "p1", { modelId: "m1", assetId: "a2" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "li2", ordinal: 0, assetId: "a2", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("empty batch rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBatchNative, { orgId: ORG, items: [], batchAuditId: "b1", now: NOW, actor: SPOOF }),
    ).rejects.toThrow(/no items selected/i);
  });

  test("cap enforced — over 100 items rejected", async () => {
    const t = makeT();
    await member(t, "member");
    const items = Array.from({ length: 101 }, (_, i) => ({ lineItemId: `li${i}`, returnCondition: "GOOD" as const, auditId: `a${i}` }));
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBatchNative, { orgId: ORG, items, batchAuditId: "b1", now: NOW, actor: SPOOF }),
    ).rejects.toThrow(/maximum 100/i);
  });

  test("partial-batch results: one bad id doesn't fail the rest", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBatchNative, {
      orgId: ORG,
      items: [
        { lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1" },
        { lineItemId: "does-not-exist", returnCondition: "GOOD", auditId: "log2" },
        { lineItemId: "li2", assetId: "a2", returnCondition: "DAMAGED", auditId: "log3" },
      ],
      batchAuditId: "batch1", now: NOW, actor: SPOOF,
    });
    expect(res).toHaveLength(3);
    expect(res[0]).toMatchObject({ lineItemId: "li1", success: true, projectId: "p1" });
    expect(res[1]).toMatchObject({ lineItemId: "does-not-exist", success: false });
    expect(res[1].error).toMatch(/not found/i);
    expect(res[2]).toMatchObject({ lineItemId: "li2", success: true, projectId: "p1" });

    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    expect((await assetById(t, "a2"))?.status).toBe("IN_MAINTENANCE");
    // Both real returns succeeded → project's last outstanding line just returned.
    expect((await projectById(t, "p1"))?.status).toBe("RETURNED");
    const batchLog = await logById(t, "batch1");
    expect(batchLog?.summary).toMatch(/batch returned 2 of 3/i);
  });
});

describe("correctReturnConditionNative", () => {
  async function seedReturned(t: T) {
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { ...baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }), status: "RETURNED" });
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "RETURNED", returnCondition: "GOOD", createdAt: NOW, updatedAt: NOW });
      await ctx.db.patch((await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique())!._id, { status: "AVAILABLE" });
    });
  }

  test("marks an already-returned unit DAMAGED and flips the asset to IN_MAINTENANCE", async () => {
    const t = makeT();
    await seedReturned(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.correctReturnConditionNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "DAMAGED", notes: "Cracked housing", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.updated).toBe(true);
    expect((await unitById(t, "u1"))?.returnCondition).toBe("DAMAGED");
    expect((await assetById(t, "a1"))?.status).toBe("IN_MAINTENANCE");
  });

  test("rejects correcting an item that hasn't been returned yet", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.correctReturnConditionNative, {
        orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "DAMAGED", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/has not been returned/i);
  });
});
