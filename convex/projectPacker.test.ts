// @vitest-environment node
//
// Phase 4 — projectWrites.setPackerNative (the floor's `Assign packer…`):
// org-checked jobs, member-checked packers, one activity row per changed job,
// and an Undo that replays the returned `previous` through the same mutation.
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
const SPOOF = { userId: "attacker", userName: "Mallory" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seed(t: T, role = "member") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "packer_a", role: "member" });
    await ctx.db.insert("members", { id: "m3", organizationId: ORG, userId: "packer_b", role: "member" });
    await ctx.db.insert("members", { id: "m4", organizationId: OTHER, userId: "outsider", role: "member" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "1", name: "Gala", status: "CONFIRMED", total: 0, packerUserId: "packer_a" });
    await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "2", name: "Tour", status: "CONFIRMED", total: 0 });
    await ctx.db.insert("projects", { id: "px", organizationId: OTHER, projectNumber: "9", name: "Theirs", status: "CONFIRMED", total: 0 });
  });
}

const setPacker = (t: T, assignments: Array<{ id: string; packerUserId: string | null }>, auditId = "a1") =>
  t.withIdentity({ subject: USER, orgId: ORG }).mutation(api.projectWrites.setPackerNative, { orgId: ORG, assignments, actor: SPOOF, auditId, now: NOW });

const packerOf = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.packerUserId ?? null);

describe("setPackerNative", () => {
  test("sets several jobs' packer, returns the previous ones, and audits each changed job", async () => {
    const t = makeT();
    await seed(t);
    const res = await setPacker(t, [{ id: "p1", packerUserId: "packer_b" }, { id: "p2", packerUserId: "packer_b" }]);
    expect(res.previous).toEqual([{ id: "p1", packerUserId: "packer_a" }, { id: "p2", packerUserId: null }]);
    expect(await packerOf(t, "p1")).toBe("packer_b");
    expect(await packerOf(t, "p2")).toBe("packer_b");
    const logs = await t.run((ctx) => ctx.db.query("activityLogs").collect());
    expect(logs.map((l) => l.entityId).sort()).toEqual(["p1", "p2"]);
    expect(logs.every((l) => l.userId === USER)).toBe(true); // the verified identity, never the supplied actor
  });

  test("Undo replays `previous` through the same mutation and restores every job exactly", async () => {
    const t = makeT();
    await seed(t);
    const res = await setPacker(t, [{ id: "p1", packerUserId: "packer_b" }, { id: "p2", packerUserId: "packer_b" }]);
    await setPacker(t, res.previous, "undo");
    expect(await packerOf(t, "p1")).toBe("packer_a");
    expect(await packerOf(t, "p2")).toBeNull();
  });

  test("a packer who is not a member of this org is rejected, and nothing changes", async () => {
    const t = makeT();
    await seed(t);
    await expect(setPacker(t, [{ id: "p1", packerUserId: "outsider" }])).rejects.toThrow(/not a member/i);
    expect(await packerOf(t, "p1")).toBe("packer_a");
  });

  test("another org's job is rejected (cross-tenant), and the batch writes nothing", async () => {
    const t = makeT();
    await seed(t);
    await expect(setPacker(t, [{ id: "p2", packerUserId: "packer_a" }, { id: "px", packerUserId: "packer_a" }])).rejects.toThrow(/not found/i);
    expect(await packerOf(t, "p2")).toBeNull();
    expect(await packerOf(t, "px")).toBeNull();
  });

  test("a viewer cannot assign packers", async () => {
    const t = makeT();
    await seed(t, "viewer");
    await expect(setPacker(t, [{ id: "p2", packerUserId: "packer_a" }])).rejects.toThrow(/insufficient permissions/i);
  });
});
