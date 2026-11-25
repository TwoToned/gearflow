// @vitest-environment node
//
// "Mark complete" clears the stored INCOMPLETE (reported missing) marker, with an exact field-edit Undo.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const asUser = { subject: "user_1", orgId: ORG };
const ACTOR = { userId: "user_1", userName: "Alice" };
const NOW = 1_800_000_000_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, status: "INCOMPLETE" | "AVAILABLE" = "INCOMPLETE") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: "user_1", role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Cables", status, isActive: true });
  });
}
const status = (t: T) => t.run(async (ctx) => (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first())!.status);
const status_ = status; // for tests whose own loop variable is called `status`
const complete = (t: T, auditId = "mc1", who = asUser) =>
  t.withIdentity(who).mutation(api.kitWrites.markCompleteNative, { orgId: ORG, id: "k1", auditId, now: NOW, actor: ACTOR });
const undo = (t: T, auditId = "mc1", who = asUser) =>
  t.withIdentity(who).mutation(api.kitWrites.undoMarkCompleteNative, { orgId: ORG, id: "k1", auditId, now: NOW + 1, actor: ACTOR });

describe("kit Mark complete", () => {
  test("clears the marker, and its Undo puts it back exactly, once, for the author only", async () => {
    const t = makeT();
    await seed(t);
    expect(await complete(t)).toEqual({ id: "k1", changed: true });
    expect(await status(t)).toBe("AVAILABLE");
    await expect(undo(t, "mc1", { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    await undo(t);
    expect(await status(t)).toBe("INCOMPLETE");
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("a kit that is not reported missing is left alone (no audit row, no Undo)", async () => {
    const t = makeT();
    await seed(t, "AVAILABLE");
    expect(await complete(t)).toEqual({ id: "k1", changed: false });
    await expect(undo(t)).rejects.toThrow();
  });

  test("Undo refuses once the status changed again since", async () => {
    const t = makeT();
    await seed(t);
    await complete(t);
    await t.run(async (ctx) => {
      const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      await ctx.db.patch(k!._id, { status: "CHECKED_OUT" });
    });
    await expect(undo(t)).rejects.toThrow(/changed since/);
    expect(await status(t)).toBe("CHECKED_OUT");
  });

  // The guard that makes Mark complete the ONLY way the marker clears: without it, any kit editor could flip a
  // CHECKED_OUT or IN_MAINTENANCE kit to AVAILABLE through this mutation, or set the marker by hand.
  test("Mark complete refuses a kit that is not reported missing, whatever its status: it never sets AVAILABLE on a CHECKED_OUT or IN_MAINTENANCE kit", async () => {
    for (const status of ["CHECKED_OUT", "IN_MAINTENANCE", "RETIRED"] as const) {
      const t = makeT();
      await seed(t, "AVAILABLE");
      await t.run(async (ctx) => {
        const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
        await ctx.db.patch(k!._id, { status });
      });
      expect(await complete(t)).toEqual({ id: "k1", changed: false });
      expect(await status_(t)).toBe(status);
    }
  });

  test("a kit edit can neither set nor clear the marker; re-saving it unchanged is fine", async () => {
    const t = makeT();
    await seed(t, "INCOMPLETE");
    const edit = (patch: Record<string, unknown>, id = "k1") =>
      t.withIdentity(asUser).mutation(api.kitWrites.updateNative, { id, orgId: ORG, patch, actor: ACTOR, auditId: `u${Math.random()}`, now: NOW } as never);
    await expect(edit({ status: "AVAILABLE" })).rejects.toThrow(/Mark complete/);
    await edit({ status: "INCOMPLETE", name: "Cables 2" });
    expect(await status_(t)).toBe("INCOMPLETE");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k2", organizationId: ORG, assetTag: "K-2", name: "Other", status: "AVAILABLE", isActive: true });
    });
    await expect(edit({ status: "INCOMPLETE" }, "k2")).rejects.toThrow(/returned missing/);
  });

  test("the kit's undo needs kit:update, not just a session", async () => {
    const t = makeT();
    await seed(t);
    await complete(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m3", organizationId: ORG, userId: "viewer_1", role: "viewer" });
    });
    await expect(undo(t, "mc1", { subject: "viewer_1", orgId: ORG })).rejects.toThrow(/Forbidden|permission/);
    expect(await status_(t)).toBe("AVAILABLE");
  });

  test("another org cannot mark it complete", async () => {
    const t = makeT();
    await seed(t);
    await expect(complete(t, "x", { subject: "user_1", orgId: "org_2" })).rejects.toThrow();
  });
});
