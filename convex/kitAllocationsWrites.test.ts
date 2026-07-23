// @vitest-environment node
//
// convex/kitAllocationsWrites.ts — browser-direct kit revenue-allocation writes.
// Verifies the money guards (sum-to-100, model-in-kit, dup, range) hold at the mutation
// boundary, wholesale replace, clear, RBAC (kit:update), cross-tenant kit rejection, and
// audit. (getKitAllocation view assembly stays in convex/kitAllocations.test.ts.)
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/** A kit with a $2000 receiver (rx) and a $15 belt, one unit each, + an owner member. */
async function seedKit(t: T, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("kits", { id: "k1", organizationId: orgId, assetTag: "KIT-1", name: "RF Kit" });
    await ctx.db.insert("models", { id: "rx", organizationId: orgId, name: "Receiver", replacementCost: 2000 });
    await ctx.db.insert("models", { id: "belt", organizationId: orgId, name: "Mic belt", replacementCost: 15 });
    await ctx.db.insert("assets", { id: "a_rx", organizationId: orgId, modelId: "rx", assetTag: "A-RX" });
    await ctx.db.insert("assets", { id: "a_belt", organizationId: orgId, modelId: "belt", assetTag: "A-BELT" });
    await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: orgId, kitId: "k1", assetId: "a_rx", addedById: "u1" });
    await ctx.db.insert("kitSerializedItems", { id: "ks2", organizationId: orgId, kitId: "k1", assetId: "a_belt", addedById: "u1" });
  });
}

const row = (modelId: string, pct: number, id = `r_${modelId}`) => ({ id, modelId, allocationPercent: pct });
const replace = (t: T, rows: ReturnType<typeof row>[], id = asUser) =>
  t.withIdentity(id).mutation(api.kitAllocationsWrites.replaceNative, {
    kitId: "k1", orgId: ORG, now: NOW, rows, actor, auditId: `a_${Math.abs(rows.length)}` + rows.map((r) => r.modelId).join(""),
  });

describe("replaceNative — money guards", () => {
  test("rejects a split that does not sum to 100", async () => {
    const t = makeT(); await seedKit(t);
    await expect(replace(t, [row("rx", 70), row("belt", 20)])).rejects.toThrow(/sum to 100/);
  });
  test("rejects a model not in the kit", async () => {
    const t = makeT(); await seedKit(t);
    await expect(replace(t, [row("rx", 50), row("ghost", 50)])).rejects.toThrow(/not in kit/);
  });
  test("rejects a duplicate model", async () => {
    const t = makeT(); await seedKit(t);
    await expect(replace(t, [row("rx", 50, "a"), row("rx", 50, "b")])).rejects.toThrow(/duplicate model/);
  });
  test("rejects an out-of-range percent", async () => {
    const t = makeT(); await seedKit(t);
    await expect(replace(t, [row("rx", 150), row("belt", -50)])).rejects.toThrow(/out of range/);
  });
  test("rejects a non-finite percent (NaN would slip past range + sum guards)", async () => {
    const t = makeT(); await seedKit(t);
    await expect(replace(t, [row("rx", NaN), row("belt", NaN)])).rejects.toThrow(/out of range/);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing kitAllocationSchema's 2-decimal
  // refine in the browser hook) must still hit the same precision bound server-side.
  test("rejects a percent with more than 2 decimal places", async () => {
    const t = makeT(); await seedKit(t);
    await expect(replace(t, [row("rx", 33.333), row("belt", 66.667)])).rejects.toThrow(/2 decimal places/);
  });

  test("wholesale replace never deletes another org's rows on a shared kitId", async () => {
    const t = makeT(); await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "theirs", organizationId: OTHER, kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    await replace(t, [row("rx", 60), row("belt", 40)]);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(rows.some((r) => r.id === "theirs" && r.organizationId === OTHER)).toBe(true);
    expect(rows.filter((r) => r.organizationId === ORG).map((r) => r.modelId).sort()).toEqual(["belt", "rx"]);
  });

  test("persists a valid split (wholesale replace) + writes an audit row", async () => {
    const t = makeT(); await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "old1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    const res = await replace(t, [row("rx", 60), row("belt", 40)]);
    expect(res).toEqual({ ok: true, count: 2 });
    const saved = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(new Map(saved.map((r) => [r.modelId, r.allocationPercent]))).toEqual(new Map([["rx", 60], ["belt", 40]]));
    const audit = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    expect(audit.some((l) => /revenue allocation across 2/.test(l.summary ?? ""))).toBe(true);
  });

  test("empty rows clears the split and skips the sum-to-100 guard", async () => {
    const t = makeT(); await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "old1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    const res = await replace(t, []);
    expect(res).toEqual({ ok: true, count: 0 });
    const saved = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(saved).toHaveLength(0);
  });
});

describe("replaceNative / clearNative — auth + cross-tenant", () => {
  test("rejects a member without kit:update permission", async () => {
    const t = makeT();
    await seedKit(t);
    // Downgrade the member's role to viewer (no kit:update).
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.kitAllocationsWrites.replaceNative, {
        kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 60), row("belt", 40)], actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  test("cannot write allocation to a kit in another org", async () => {
    const t = makeT();
    await seedKit(t, OTHER); // kit + contents live in OTHER; caller's token is ORG
    await expect(
      t.withIdentity(asUser).mutation(api.kitAllocationsWrites.replaceNative, {
        kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 100)], actor, auditId: "a1",
      }),
    ).rejects.toThrow(/kit not found/i);
  });

  test("clearNative drops the org's rows, never another org's on a shared kitId", async () => {
    const t = makeT();
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "mine", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
      await ctx.db.insert("kitRevenueAllocations", { id: "theirs", organizationId: OTHER, kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    const res = await t.withIdentity(asUser).mutation(api.kitAllocationsWrites.clearNative, {
      kitId: "k1", orgId: ORG, now: NOW, actor, auditId: "c1",
    });
    expect(res).toEqual({ ok: true, count: 1 });
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(remaining.map((r) => r.id)).toEqual(["theirs"]);
  });
});
