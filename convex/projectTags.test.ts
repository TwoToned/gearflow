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

async function seed(t: ReturnType<typeof convexTest>, projects: Array<{ id: string; org?: string; tags?: string[] }>) {
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
const tagsOf = (t: ReturnType<typeof convexTest>, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.tags);

describe("projectWrites.updateNative tag guard", () => {
  const base = { id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW, clear: [] as string[] };
  const upd = (t: ReturnType<typeof convexTest>, tags: unknown) =>
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
