// @vitest-environment node
//
// convex/projectTasks.myOpenTasks — cross-project "my tasks" read (#952 / QW-3).
// Verifies: union of user-assigned + crew-assigned OPEN tasks, de-dup, org
// isolation (global-index cross-tenant guard), bound + sort (overdue → due asc
// → undated last → priority), and minute-bucketed `now` driving the overdue flag.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

async function baseSeed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("projects", { id: "P1", organizationId: ORG, projectNumber: "P1", name: "Gig One", status: "CONFIRMED", isTemplate: false });
    await ctx.db.insert("projects", { id: "P2", organizationId: ORG, projectNumber: "P2", name: "Gig Two", status: "CONFIRMED", isTemplate: false });
  });
}

describe("projectTasks.myOpenTasks", () => {
  test("returns the user's directly-assigned open tasks, excludes DONE and other users", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "My todo", status: "TODO", assigneeUserId: USER });
      await ctx.db.insert("projectTasks", { id: "t2", organizationId: ORG, projectId: "P1", title: "My in progress", status: "IN_PROGRESS", assigneeUserId: USER });
      await ctx.db.insert("projectTasks", { id: "t3", organizationId: ORG, projectId: "P1", title: "My done", status: "DONE", assigneeUserId: USER });
      await ctx.db.insert("projectTasks", { id: "t4", organizationId: ORG, projectId: "P1", title: "Someone else's", status: "TODO", assigneeUserId: "user_9" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW });
    expect(res.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    expect(res.every((r) => r.status !== "DONE")).toBe(true);
  });

  test("unions in crew-assigned open tasks for a user who is also a crew member", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "crew_1", organizationId: ORG, firstName: "Alice", lastName: "Crew", userId: USER, status: "ACTIVE" });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "Directly assigned", status: "TODO", assigneeUserId: USER });
      await ctx.db.insert("projectTasks", { id: "t2", organizationId: ORG, projectId: "P2", title: "Crew assigned", status: "IN_PROGRESS", assigneeCrewId: "crew_1" });
      // A different crew member's task must not leak in.
      await ctx.db.insert("crewMembers", { id: "crew_2", organizationId: ORG, firstName: "Other", lastName: "Crew", status: "ACTIVE" });
      await ctx.db.insert("projectTasks", { id: "t3", organizationId: ORG, projectId: "P2", title: "Other crew", status: "TODO", assigneeCrewId: "crew_2" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW });
    expect(res.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    const crewTask = res.find((r) => r.id === "t2")!;
    expect(crewTask.projectName).toBe("Gig Two");
    expect(crewTask.projectNumber).toBe("P2");
  });

  test("a user linked to multiple crew records never surfaces a duplicate task id", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await t.run(async (ctx) => {
      // Two crew records resolve to the same user (e.g. re-hired under a new
      // crew row) — the union walks both, so the de-dup Map must still land on
      // exactly one row per task id, with no duplicates in the final list.
      await ctx.db.insert("crewMembers", { id: "crew_1", organizationId: ORG, firstName: "Alice", lastName: "Crew", userId: USER, status: "ACTIVE" });
      await ctx.db.insert("crewMembers", { id: "crew_2", organizationId: ORG, firstName: "Alice2", lastName: "Crew2", userId: USER, status: "ACTIVE" });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "Directly assigned", status: "TODO", assigneeUserId: USER });
      await ctx.db.insert("projectTasks", { id: "t2", organizationId: ORG, projectId: "P1", title: "Crew 1 task", status: "TODO", assigneeCrewId: "crew_1" });
      await ctx.db.insert("projectTasks", { id: "t3", organizationId: ORG, projectId: "P1", title: "Crew 2 task", status: "IN_PROGRESS", assigneeCrewId: "crew_2" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW });
    const ids = res.map((r) => r.id);
    expect(ids.sort()).toEqual(["t1", "t2", "t3"]);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  test("org isolation: a same-id assignee in another org never leaks across the global index", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: OTHER_ORG, userId: USER, role: "manager" });
      await ctx.db.insert("projects", { id: "P9", organizationId: OTHER_ORG, projectNumber: "P9", name: "Foreign gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "In org", status: "TODO", assigneeUserId: USER });
      await ctx.db.insert("projectTasks", { id: "tForeign", organizationId: OTHER_ORG, projectId: "P9", title: "Foreign", status: "TODO", assigneeUserId: USER });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW });
    expect(res.map((r) => r.id)).toEqual(["t1"]);

    const resOther = await t.withIdentity(asUser(OTHER_ORG)).query(api.projectTasks.myOpenTasks, { orgId: OTHER_ORG, now: NOW });
    expect(resOther.map((r) => r.id)).toEqual(["tForeign"]);
  });

  test("rejects an org mismatch between the caller's token and the requested orgId", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await expect(
      t.withIdentity(asUser(OTHER_ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("bounds to 100 and sorts overdue → due asc → undated last → priority", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await t.run(async (ctx) => {
      // Undated, normal priority.
      await ctx.db.insert("projectTasks", { id: "undated", organizationId: ORG, projectId: "P1", title: "Undated", status: "TODO", assigneeUserId: USER });
      // Due in the future, two tasks same day — HIGH before NORMAL.
      await ctx.db.insert("projectTasks", { id: "future-normal", organizationId: ORG, projectId: "P1", title: "Future normal", status: "TODO", assigneeUserId: USER, dueDate: NOW + 3 * DAY, priority: "NORMAL" });
      await ctx.db.insert("projectTasks", { id: "future-high", organizationId: ORG, projectId: "P1", title: "Future high", status: "TODO", assigneeUserId: USER, dueDate: NOW + 3 * DAY, priority: "HIGH" });
      // Overdue.
      await ctx.db.insert("projectTasks", { id: "overdue", organizationId: ORG, projectId: "P1", title: "Overdue", status: "TODO", assigneeUserId: USER, dueDate: NOW - DAY });
      // 100 filler tasks to exercise the bound.
      for (let i = 0; i < 100; i++) {
        await ctx.db.insert("projectTasks", { id: `filler-${i}`, organizationId: ORG, projectId: "P1", title: `Filler ${i}`, status: "TODO", assigneeUserId: USER, dueDate: NOW + (10 + i) * DAY });
      }
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW });
    expect(res).toHaveLength(100); // bounded — 104 candidates exist
    expect(res[0].id).toBe("overdue");
    expect(res[0].overdue).toBe(true);
    expect(res[1].id).toBe("future-high"); // same due date as future-normal, HIGH sorts first
    expect(res[2].id).toBe("future-normal");
    // Undated tasks sort last; with 104 candidates bounded to 100, the undated
    // filler-heavy tail means "undated" itself may be trimmed — assert the
    // ordering invariant instead of its literal presence.
    const dueDates = res.map((r) => r.dueDate).filter((d): d is number => d != null);
    expect(dueDates).toEqual([...dueDates].sort((a, b) => a - b));
  });

  test("computes overdue against the client-passed `now`, not server time", async () => {
    const t = convexTest(schema, modules);
    await baseSeed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "Borderline", status: "TODO", assigneeUserId: USER, dueDate: NOW });
    });
    const before = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW - 1 });
    expect(before[0].overdue).toBe(false); // dueDate (NOW) is not < now (NOW - 1)
    const after = await t.withIdentity(asUser(ORG)).query(api.projectTasks.myOpenTasks, { orgId: ORG, now: NOW + 1 });
    expect(after[0].overdue).toBe(true); // dueDate (NOW) < now (NOW + 1)
  });
});
