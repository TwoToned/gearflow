// @vitest-environment node
//
// UX Phase 9 follow-up: the edit sheet's exact Undo (`projectEditUndo.undoUpdateNative`). It reads the
// audit row `updateNative` wrote (ids only) and refuses as a whole unless every changed field still holds
// what the save left, in the window, once, for the author, and (for a locked money field) while unlocked.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const OTHER = "user_2";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: USER, userName: "Alice" };
const asUser = (subject = USER) => ({ subject, orgId: ORG });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, liveVersionId: "v1",
      createdAt: NOW, updatedAt: NOW, description: "Old", discountPercent: 10,
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: OTHER, role: "member" });
  });
}

const save = (t: T, set: Record<string, unknown>, auditId: string, who = USER) =>
  t.withIdentity(asUser(who)).mutation(api.projectWrites.updateNative, {
    id: "p1", orgId: ORG, set: { ...set, updatedAt: NOW }, clear: [], actor: { userId: who, userName: "x" }, auditId, now: NOW,
  });
const undo = (t: T, auditId: string, who = USER) =>
  t.withIdentity(asUser(who)).mutation(api.projectEditUndo.undoUpdateNative, {
    orgId: ORG, projectId: "p1", auditId, actor: { userId: who, userName: "x" }, now: NOW,
  });
const row = (t: T) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());

describe("projectEditUndo.undoUpdateNative", () => {
  test("restores exactly the fields the save changed and leaves the rest", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { name: "Renamed", description: "New" }, "a1");
    // An unrelated field changed later is not part of this edit's snapshot.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { crewNotes: "later" });
    });
    const r = await undo(t, "a1");
    expect(r.restored.sort()).toEqual(["description", "name"]);
    const p = await row(t);
    expect(p?.name).toBe("Gig");
    expect(p?.description).toBe("Old");
    expect(p?.crewNotes).toBe("later");
  });

  test("refuses, changing nothing, when a changed field was edited again since", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { name: "Renamed", description: "New" }, "a1");
    await save(t, { name: "Third" }, "a2");
    await expect(undo(t, "a1")).rejects.toThrow(/changed since/);
    const p = await row(t);
    expect(p?.name).toBe("Third");
    expect(p?.description).toBe("New");
  });

  test("refuses outside the server-clock window", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { name: "Renamed" }, "a1");
    vi.setSystemTime(NOW + 11 * 60 * 1000);
    await expect(undo(t, "a1")).rejects.toThrow();
    expect((await row(t))?.name).toBe("Renamed");
  });

  test("refuses a second Undo of the same edit", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { name: "Renamed" }, "a1");
    await undo(t, "a1");
    await expect(undo(t, "a1")).rejects.toThrow(/already undone/);
  });

  test("refuses another user", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { name: "Renamed" }, "a1");
    await expect(undo(t, "a1", OTHER)).rejects.toThrow(/Only the person/);
    expect((await row(t))?.name).toBe("Renamed");
  });

  test("a locked money field cannot be restored on a pricing-locked job; an unlocked field still can", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { discountPercent: 20 }, "a1");
    await save(t, { name: "Renamed" }, "a2");
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { pricingLocked: true });
    });
    await expect(undo(t, "a1")).rejects.toThrow();
    expect((await row(t))?.discountPercent).toBe(20);
    await undo(t, "a2");
    expect((await row(t))?.name).toBe("Gig");
  });

  test("restoring a discount puts the previous percentage back", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { discountPercent: 25 }, "a1");
    expect((await row(t))?.discountPercent).toBe(25);
    await undo(t, "a1");
    expect((await row(t))?.discountPercent).toBe(10);
  });

  test("another org cannot undo this org's edit", async () => {
    const t = makeT();
    await seed(t);
    await save(t, { name: "Renamed" }, "a1");
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m3", organizationId: "org_2", userId: USER, role: "member" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: "org_2" }).mutation(api.projectEditUndo.undoUpdateNative, {
        orgId: "org_2", projectId: "p1", auditId: "a1", actor: ACTOR, now: NOW,
      }),
    ).rejects.toThrow();
    expect((await row(t))?.name).toBe("Renamed");
  });
});
