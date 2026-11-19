// @vitest-environment node
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const tc = convexTest(schema, modules);
  registerRateLimiter(tc, "rateLimiter");
  registerShardedCounter(tc, "shardedCounter");
  return tc;
}
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function seed(t: ReturnType<typeof makeT>, projects: Array<{ id: string; org?: string; tags?: string[] }>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
    for (const p of projects) {
      await ctx.db.insert("projects", {
        id: p.id, organizationId: p.org ?? ORG, projectNumber: p.id.toUpperCase(), name: p.id, status: "CONFIRMED",
        isTemplate: false, liveVersionId: `v-${p.id}`, tags: p.tags, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectVersions", { id: `v-${p.id}`, organizationId: p.org ?? ORG, projectId: p.id, number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    }
  });
}
type T = ReturnType<typeof makeT>;
const tagsOf = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.tags);

describe("projectWrites.addTagNative / removeTagNative", () => {
  const a = (ids: string[], tag = "vip") => ({ orgId: ORG, ids, tag, actor: ACTOR, auditId: "log-t", now: NOW });
  const user = (t: T) => t.withIdentity(asUser(ORG));

  test("add reads current tags inside the mutation, keeping the other tags", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1", tags: ["a"] }, { id: "p2" }]);
    // a concurrent edit lands between the client's list read and the click
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { tags: ["a", "late"] });
    });
    const r = await user(t).mutation(api.projectWrites.addTagNative, a(["p1", "p2"]));
    expect(r.changed).toEqual(["p1", "p2"]);
    expect(await tagsOf(t, "p1")).toEqual(["a", "late", "vip"]);
    expect(await tagsOf(t, "p2")).toEqual(["vip"]);
  });

  test("undo removes the tag only from the rows it was newly added to", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1", tags: ["vip"] }, { id: "p2" }]);
    const r = await user(t).mutation(api.projectWrites.addTagNative, a(["p1", "p2"]));
    expect(r.changed).toEqual(["p2"]);
    await user(t).mutation(api.projectWrites.removeTagNative, { ...a(r.changed), auditId: "log-u" });
    expect(await tagsOf(t, "p1")).toEqual(["vip"]);
    expect(await tagsOf(t, "p2")).toEqual([]);
  });

  test("a job already at MAX_TAGS is reported in `full`, not silently dropped", async () => {
    const t = makeT();
    const maxed = Array.from({ length: 25 }, (_, i) => `t${i}`);
    await seed(t, [{ id: "p1", tags: maxed }, { id: "p2", tags: maxed }, { id: "p3" }, { id: "p4", tags: [...maxed.slice(1), "vip"] }]);
    const r = await user(t).mutation(api.projectWrites.addTagNative, a(["p1", "p2", "p3", "p4"]));
    expect(r.changed).toEqual(["p3"]);
    expect(r.full.sort()).toEqual(["p1", "p2"]); // p4 is full but already HAS the tag: not "full"
    expect(await tagsOf(t, "p1")).toEqual(maxed);
  });

  test("a foreign-org id is rejected and nothing is written", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1" }, { id: "px", org: OTHER }]);
    await expect(user(t).mutation(api.projectWrites.addTagNative, a(["p1", "px"]))).rejects.toThrow();
    expect(await tagsOf(t, "px")).toBeNull();
    expect(await tagsOf(t, "p1")).toBeNull();
  });

  test("rejects an invalid tag", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1" }]);
    await expect(user(t).mutation(api.projectWrites.addTagNative, a(["p1"], "x".repeat(41)))).rejects.toThrow();
    await expect(user(t).mutation(api.projectWrites.addTagNative, a(["p1"], "  "))).rejects.toThrow();
  });
});

describe("projectWrites.updateNative tag guard", () => {
  const base = { id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW, clear: [] as string[] };
  const upd = (t: T, tags: unknown) =>
    t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...base, set: { tags, updatedAt: NOW } });

  test("trims and dedupes a valid list", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1" }]);
    await upd(t, [" a ", "a", "b"]);
    expect(await tagsOf(t, "p1")).toEqual(["a", "b"]);
  });
  test("rejects more than 25 tags", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1" }]);
    await expect(upd(t, Array.from({ length: 26 }, (_, i) => `t${i}`))).rejects.toThrow();
  });
  test("rejects an over-long, blank or non-string tag, and a non-array", async () => {
    const t = makeT();
    await seed(t, [{ id: "p1" }]);
    await expect(upd(t, ["x".repeat(41)])).rejects.toThrow();
    await expect(upd(t, ["   "])).rejects.toThrow();
    await expect(upd(t, [5])).rejects.toThrow();
    await expect(upd(t, "a")).rejects.toThrow();
    expect(await tagsOf(t, "p1")).toBeNull();
  });
});
