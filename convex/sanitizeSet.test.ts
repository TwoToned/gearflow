// @vitest-environment node
//
// H1 security fix: a user-callable `set: v.any()` (or `patch` that includes
// organizationId) must NOT let a caller reassign a row into another org. sanitizeSet
// strips organizationId/id; the mutation applies the sanitized set.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { sanitizeClientSet } from "./lib/sanitizeSet";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

describe("sanitizeClientSet (unit)", () => {
  test("strips organizationId + id + extras, keeps other fields", () => {
    expect(sanitizeClientSet({ organizationId: "B", id: "x", projectId: "p", name: "ok" }, ["projectId"]))
      .toEqual({ name: "ok" });
    expect(sanitizeClientSet(null)).toEqual({});
    expect(sanitizeClientSet({ notes: "n" })).toEqual({ notes: "n" });
  });
});

describe("projectWrites.updateNative — no cross-tenant reassign via set:v.any (H1)", () => {
  test("set:{organizationId:'org_other'} does NOT move the project; other fields still apply", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Old", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, {
      id: "p1",
      orgId: ORG,
      set: { organizationId: OTHER, id: "hacked", name: "New" }, // hostile fields
      clear: [],
      actor: { userId: USER, userName: "U" },
      auditId: "a1",
      now: NOW,
    });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).unique());
    expect(p?.organizationId).toBe(ORG); // NOT reassigned to org_other
    expect(p?.id).toBe("p1"); // id not rewritten
    expect(p?.name).toBe("New"); // legitimate field still applied
  });
});
