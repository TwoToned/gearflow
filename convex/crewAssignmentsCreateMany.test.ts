// @vitest-environment node
//
// crewAssignmentsWrites.createManyNative (UX Phase 13, the Crew list's `Assign n to job…`):
// unsent PENDING calls in ONE transaction, per-member gates, and an Undo
// (`bulkDeleteNative(createdIds)`) that removes exactly the created rows.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", NOW = 1_700_000_000_000;
const DAY = 86400000;
const actor = { userId: USER, userName: "Alice" };
const asAdmin = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, liveVersionId: "v-p1" });
    await ctx.db.insert("projects", { id: "px", organizationId: OTHER, projectNumber: "PX", name: "Foreign", status: "QUOTED" });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", defaultDayRate: 500, isActive: true });
    await ctx.db.insert("crewMembers", { id: "c2", organizationId: ORG, firstName: "Cy", lastName: "Dee", isActive: true });
    await ctx.db.insert("crewMembers", { id: "c3", organizationId: ORG, firstName: "Off", lastName: "Duty", status: "INACTIVE" });
    await ctx.db.insert("crewMembers", { id: "cf", organizationId: OTHER, firstName: "For", lastName: "Eign" });
    await ctx.db.insert("crewAssignments", { id: "live", organizationId: ORG, projectId: "p1", crewMemberId: "c2", status: "CONFIRMED" });
  });
}
const rows = (t: T) => t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
const base = { orgId: ORG, projectId: "p1", startDate: NOW, endDate: NOW + DAY, now: NOW, actor, auditId: "log1" };

describe("createManyNative", () => {
  test("creates unsent PENDING calls, skips and names the rest, one audit row", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asAdmin).mutation(api.crewAssignmentsWrites.createManyNative, {
      ...base,
      items: [
        { id: "n1", crewMemberId: "c1" },
        { id: "n2", crewMemberId: "c2" }, // already holds a live call on this job
        { id: "n3", crewMemberId: "c3" }, // inactive
        { id: "n4", crewMemberId: "cf" }, // another org's member
        { id: "n5", crewMemberId: "c1" }, // repeated: never a second call
      ],
    });
    expect(res.created).toEqual([{ id: "n1", crewMemberId: "c1" }]);
    expect(res.skipped.sort((a, b) => a.crewMemberId.localeCompare(b.crewMemberId))).toEqual([
      { crewMemberId: "c2", reason: "already on this job" },
      { crewMemberId: "c3", reason: "inactive" },
      { crewMemberId: "cf", reason: "not found" },
    ]);
    const n1 = (await rows(t)).find((r) => r.id === "n1")!;
    expect(n1).toMatchObject({ status: "PENDING", startDate: NOW });
    expect(n1.offeredAt).toBeUndefined(); // nothing was offered or mailed
    const logs = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
    expect(logs.filter((l) => l.id === "log1")).toHaveLength(1);
  });

  test("Undo (bulkDeleteNative on the created ids) removes exactly those rows", async () => {
    const t = makeT(); await seed(t);
    const as = t.withIdentity(asAdmin);
    const { created } = await as.mutation(api.crewAssignmentsWrites.createManyNative, { ...base, items: [{ id: "n1", crewMemberId: "c1" }] });
    expect((await rows(t)).map((r) => r.id).sort()).toEqual(["live", "n1"]);
    await as.mutation(api.crewAssignmentsWrites.bulkDeleteNative, { orgId: ORG, ids: created.map((c) => c.id), now: NOW, actor, auditId: "log2" });
    expect((await rows(t)).map((r) => r.id)).toEqual(["live"]);
  });

  test("another org's project and a role without crew:create are refused; nothing is written", async () => {
    const t = makeT(); await seed(t, "viewer");
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.crewAssignmentsWrites.createManyNative, { ...base, items: [{ id: "n1", crewMemberId: "c1" }] })).rejects.toThrow();
    const t2 = makeT(); await seed(t2);
    await expect(t2.withIdentity(asAdmin).mutation(api.crewAssignmentsWrites.createManyNative, { ...base, projectId: "px", items: [{ id: "n1", crewMemberId: "c1" }] })).rejects.toThrow();
    expect((await rows(t2)).map((r) => r.id)).toEqual(["live"]);
  });

  test("an end date before the start is refused", async () => {
    const t = makeT(); await seed(t);
    await expect(t.withIdentity(asAdmin).mutation(api.crewAssignmentsWrites.createManyNative, { ...base, startDate: NOW + DAY, endDate: NOW, items: [{ id: "n1", crewMemberId: "c1" }] })).rejects.toThrow(/end date/);
  });
});
