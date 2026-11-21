/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * UX Phase 7: the `Unlock pricing` toast's Undo reverses EXACTLY that unlock
 * (the original lock's who/when restored from the unlock's own audit row), and
 * refuses, server-side, once the lock state has changed since.
 */
const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const LOCKED_AT = NOW - 86_400_000;
const asUser = () => ({ subject: USER, orgId: ORG });
const ACTOR = { userId: USER, userName: "Alice" };

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED", isTemplate: false,
      taxRate: 10, discountPercent: 0, revision: 1, createdAt: NOW, updatedAt: NOW, liveVersionId: "v1",
      pricingLocked: true, pricingLockedAt: LOCKED_AT, pricingLockedById: "u_bob", pricingLockedByName: "Bob",
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
  });
}

const unlock = (t: ReturnType<typeof makeT>, auditId: string, now = NOW) =>
  t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, { id: "p1", orgId: ORG, actor: ACTOR, auditId, now });
const undo = (t: ReturnType<typeof makeT>, unlockAuditId: string, auditId = "undo1", orgId = ORG) =>
  t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.undoUnlockPricingNative, {
    id: "p1", orgId, unlockAuditId, actor: ACTOR, auditId, now: NOW + 10,
  });
const projectRow = (t: ReturnType<typeof makeT>) =>
  t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());

describe("undoUnlockPricingNative", () => {
  test("restores exactly the lock that unlock removed, and logs the undo", async () => {
    const t = makeT();
    await seed(t);
    const r = await unlock(t, "unlock1");
    expect(r.undoToken).toBe("unlock1");
    expect((await projectRow(t))?.pricingLocked).toBe(false);

    await undo(t, "unlock1");
    const p = await projectRow(t);
    expect(p).toMatchObject({ pricingLocked: true, pricingLockedAt: LOCKED_AT, pricingLockedById: "u_bob", pricingLockedByName: "Bob" });
    const log = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "undo1")).first());
    expect(log?.action).toBe("PRICING_UNLOCK_UNDONE");
  });

  test("a no-op unlock (already open) hands back no undo token", async () => {
    const t = makeT();
    await seed(t);
    await unlock(t, "unlock1");
    const again = await unlock(t, "unlock2", NOW + 1);
    expect(again.undoToken).toBeUndefined();
  });

  test("refuses once pricing is locked again", async () => {
    const t = makeT();
    await seed(t);
    await unlock(t, "unlock1");
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.lockPricingNative, { id: "p1", orgId: ORG, actor: ACTOR, auditId: "lock2", now: NOW + 2 });
    await expect(undo(t, "unlock1")).rejects.toThrow(/locked again/);
    // The re-lock it found is left alone.
    expect((await projectRow(t))?.pricingLockedAt).toBe(NOW + 2);
  });

  test("refuses when the lock was raised and cleared again after that unlock", async () => {
    const t = makeT();
    await seed(t);
    await unlock(t, "unlock1");
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.lockPricingNative, { id: "p1", orgId: ORG, actor: ACTOR, auditId: "lock2", now: NOW + 2 });
    await unlock(t, "unlock3", NOW + 3);
    await expect(undo(t, "unlock1")).rejects.toThrow(/changed after that unlock/);
    expect((await projectRow(t))?.pricingLocked).toBe(false);
  });

  test("refuses when a quote recall cleared a lock after that unlock", async () => {
    const t = makeT();
    await seed(t);
    await unlock(t, "unlock1");
    await t.run((ctx) =>
      ctx.db.insert("activityLogs", {
        id: "recall1", organizationId: ORG, action: "QUOTE_RECALLED", entityType: "quote", entityId: "q1",
        entityName: "Q", userName: "Alice", summary: "Recalled — pricing unlocked", projectId: "p1",
        metadata: { reason: "x", pricingUnlocked: true }, createdAt: NOW + 5,
      }),
    );
    await expect(undo(t, "unlock1")).rejects.toThrow(/changed after that unlock/);
  });

  test("an ordinary edit after the unlock does not block the undo", async () => {
    const t = makeT();
    await seed(t);
    await unlock(t, "unlock1");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 25 }, clear: [], actor: ACTOR, auditId: "edit1", now: NOW + 4,
    });
    await undo(t, "unlock1");
    expect((await projectRow(t))?.pricingLocked).toBe(true);
  });

  test("refuses a token that is not this project's unlock, and a foreign org", async () => {
    const t = makeT();
    await seed(t);
    await unlock(t, "unlock1");
    await t.run((ctx) =>
      ctx.db.insert("activityLogs", {
        id: "other", organizationId: "org_2", action: "PRICING_UNLOCKED", entityType: "project", entityId: "p1",
        entityName: "P", userName: "Eve", summary: "x", projectId: "p1", details: { previous: { pricingLockedAt: 1 } }, createdAt: NOW,
      }),
    );
    await expect(undo(t, "other")).rejects.toThrow(/can't be undone/);
    await expect(undo(t, "missing")).rejects.toThrow(/can't be undone/);
    await expect(undo(t, "unlock1", "undo2", "org_2")).rejects.toThrow();
    expect((await projectRow(t))?.pricingLocked).toBe(false);
  });
});
