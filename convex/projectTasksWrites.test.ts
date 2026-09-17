// @vitest-environment node
//
// convex/projectTasksWrites.ts + the composite reads (projectTasks.assignees /
// listByProjectWithRelations). Verifies: create/update/delete + bulk with per-row org
// re-check, assignee validation via the members/crew mirrors, DONE completedAt stamping,
// sortOrder, RBAC (project:update), cross-tenant, and the read joins.
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
const asUser = { subject: USER, orgId: ORG, role: "manager" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T, opts: { projectOrg?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager", createdAt: 1 });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "u2", role: "member", createdAt: 2 });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.co" });
    await ctx.db.insert("users", { id: "u2", name: "Bob", email: "b@x.co", image: "img" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Cara", lastName: "Crew", status: "ACTIVE" });
    await ctx.db.insert("crewMembers", { id: "c2", organizationId: ORG, firstName: "Zed", lastName: "Old", status: "ARCHIVED" });
    await ctx.db.insert("projects", {
      id: "P1", organizationId: opts.projectOrg ?? ORG, projectNumber: "P1", name: "Gig",
      status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const tasks = (t: T) =>
  t.run(async (ctx) => ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", "P1")).collect());

describe("projectTasksWrites", () => {
  test("create assigns sortOrder, validates assignee, audits", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "t1", projectId: "P1", orgId: ORG, title: "  First  ", assigneeUserId: "u2", now: NOW, actor, auditId: "a1",
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "t2", projectId: "P1", orgId: ORG, title: "Second", status: "DONE", now: NOW, actor, auditId: "a2",
    });
    const rows = (await tasks(t)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(rows.map((r) => [r.title, r.sortOrder])).toEqual([["First", 1], ["Second", 2]]);
    expect(rows.find((r) => r.id === "t2")?.completedAt).toBe(NOW); // DONE stamps completedAt
    const audit = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(audit?.summary).toBe('Added task "First"');
  });

  test("create rejects a non-member assignee + both-assignees", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
        id: "t1", projectId: "P1", orgId: ORG, title: "X", assigneeUserId: "outsider", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/not a member/i);
    await expect(
      t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
        id: "t2", projectId: "P1", orgId: ORG, title: "X", assigneeUserId: "u2", assigneeCrewId: "c1", now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/either a user or a crew/i);
  });

  test("update stamps completedAt on the DONE transition, clears it leaving DONE", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "T", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: "t1", orgId: ORG, status: "DONE", now: NOW + 1, actor, auditId: "a1",
    });
    expect((await tasks(t))[0].completedAt).toBe(NOW + 1);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: "t1", orgId: ORG, status: "TODO", now: NOW + 2, actor, auditId: "a2",
    });
    // Cleared via undefined (the schema optional is removed, not set to null).
    expect((await tasks(t))[0].completedAt).toBeUndefined();
  });

  test("reassigning to a user clears an existing crew assignment (XOR on merged row)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "T", status: "TODO", assigneeCrewId: "c1", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: "t1", orgId: ORG, assigneeUserId: "u2", now: NOW + 1, actor, auditId: "a1",
    });
    const row = (await tasks(t))[0];
    expect(row.assigneeUserId).toBe("u2");
    expect(row.assigneeCrewId).toBeUndefined(); // crew cleared
  });

  test("bulkUpdate skips foreign-org rows + returns counts", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "A", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "tX", organizationId: OTHER, projectId: "P1", title: "B", status: "TODO", sortOrder: 2, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser).mutation(api.projectTasksWrites.bulkUpdateNative, {
      ids: ["t1", "tX"], orgId: ORG, priority: "HIGH", now: NOW, actor, auditId: "a1",
    });
    expect(res).toEqual({ updated: 1, skipped: 1 });
    expect((await tasks(t)).find((r) => r.id === "t1")?.priority).toBe("HIGH");
  });

  test("bulkDelete removes only the org's rows", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "A", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "tX", organizationId: OTHER, projectId: "P1", title: "B", status: "TODO", sortOrder: 2, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser).mutation(api.projectTasksWrites.bulkDeleteNative, {
      ids: ["t1", "tX"], orgId: ORG, now: NOW, actor, auditId: "a1",
    });
    expect(res).toEqual({ deleted: 1, skipped: 1 });
    expect((await tasks(t)).map((r) => r.id)).toEqual(["tX"]);
  });

  test("cross-tenant: cannot create against a project in another org", async () => {
    const t = makeT(); await seed(t, { projectOrg: OTHER });
    await expect(
      t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
        id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Project not found/i);
  });

  test("RBAC: a viewer (no project:update) is rejected", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.projectTasksWrites.createNative, {
        id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  test("stage defaults from the project's lifecycle status when not given explicitly", async () => {
    const t = makeT(); await seed(t); // seeded project status is CONFIRMED → stage "prep"
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "a1",
    });
    expect((await tasks(t))[0].stage).toBe("prep");
  });

  test("an explicit stage wins over the project-status default", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "t1", projectId: "P1", orgId: ORG, title: "X", stage: "close", now: NOW, actor, auditId: "a1",
    });
    expect((await tasks(t))[0].stage).toBe("close");
  });

  test("quick-add: no projectId creates a personal task with no project, no stage default, sortOrder 0", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "t1", orgId: ORG, title: "Call the venue", now: NOW, actor, auditId: "a1",
    });
    const doc = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t1")).unique());
    expect(doc?.projectId).toBeUndefined();
    expect(doc?.stage).toBeUndefined();
    expect(doc?.sortOrder).toBe(0);
    expect(doc?.organizationId).toBe(ORG);
  });

  test("a subtask (parentId) inherits the parent's project/org, carries no stage, and sorts among siblings", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "parent", projectId: "P1", orgId: ORG, title: "Load in", stage: "load_in", now: NOW, actor, auditId: "a1",
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "child1", parentId: "parent", orgId: ORG, title: "Step 1", now: NOW, actor, auditId: "a2",
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "child2", parentId: "parent", orgId: ORG, title: "Step 2", now: NOW, actor, auditId: "a3",
    });
    const children = (await t.run((ctx) =>
      ctx.db.query("projectTasks").withIndex("by_parentId", (q) => q.eq("parentId", "parent")).collect(),
    )).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(children.map((c) => [c.id, c.projectId, c.organizationId, c.stage, c.sortOrder])).toEqual([
      ["child1", "P1", ORG, undefined, 1],
      ["child2", "P1", ORG, undefined, 2],
    ]);
  });

  test("creating a subtask under a task from another org is rejected", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "foreign_parent", organizationId: OTHER, title: "Foreign", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
        id: "child1", parentId: "foreign_parent", orgId: ORG, title: "Step 1", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Parent task not found/i);
  });

  test("updateNative can set kind, and ignores a stage patch on a subtask", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "parent", organizationId: ORG, projectId: "P1", title: "Parent", stage: "prep", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "child", organizationId: ORG, projectId: "P1", title: "Child", parentId: "parent", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: "parent", orgId: ORG, kind: "follow_up", stage: "show", now: NOW, actor, auditId: "a1",
    });
    const parentDoc = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "parent")).unique());
    expect(parentDoc?.kind).toBe("follow_up");
    expect(parentDoc?.stage).toBe("show");

    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: "child", orgId: ORG, stage: "show", now: NOW, actor, auditId: "a2",
    });
    const childDoc = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "child")).unique());
    expect(childDoc?.stage).toBeUndefined(); // stage patch silently ignored on a subtask
  });
});

describe("projectTasks read composites", () => {
  test("assignees returns member users (createdAt order) + non-archived crew", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).query(api.projectTasks.assignees, { orgId: ORG });
    expect(res.users.map((u) => u.id)).toEqual([USER, "u2"]); // member createdAt asc
    expect(res.crew.map((c) => c.id)).toEqual(["c1"]); // c2 ARCHIVED excluded
  });

  test("listByProjectWithRelations joins assignee + returns ISO dueDate, org re-checked", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "A", status: "TODO", sortOrder: 1, dueDate: NOW, assigneeUserId: "u2", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "tX", organizationId: OTHER, projectId: "P1", title: "leak", status: "TODO", sortOrder: 2, createdAt: NOW, updatedAt: NOW });
    });
    const rows = await t.withIdentity(asUser).query(api.projectTasks.listByProjectWithRelations, { projectId: "P1", orgId: ORG });
    expect(rows.map((r) => r.id)).toEqual(["t1"]); // foreign-org row filtered out
    expect(rows[0].assigneeUser).toEqual({ id: "u2", name: "Bob", image: "img" });
    expect(rows[0].dueDate).toBe(new Date(NOW).toISOString());
  });

  test("assigneeUser is null when the assignee is no longer an org member (no cross-org leak)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      // A user that exists in the global mirror but is NOT a member of ORG.
      await ctx.db.insert("users", { id: "ghost", name: "Ghost", email: "g@x.co" });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "A", status: "TODO", sortOrder: 1, assigneeUserId: "ghost", createdAt: NOW, updatedAt: NOW });
    });
    const rows = await t.withIdentity(asUser).query(api.projectTasks.listByProjectWithRelations, { projectId: "P1", orgId: ORG });
    expect(rows[0].assigneeUser).toBeNull(); // membership-gated — no name/image leak
  });

  test("listByProjectWithRelations excludes subtasks (parentId set) from the flat board columns", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "parent", organizationId: ORG, projectId: "P1", title: "Parent", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "child", organizationId: ORG, projectId: "P1", title: "Child", status: "TODO", sortOrder: 2, parentId: "parent", createdAt: NOW, updatedAt: NOW });
    });
    const rows = await t.withIdentity(asUser).query(api.projectTasks.listByProjectWithRelations, { projectId: "P1", orgId: ORG });
    expect(rows.map((r) => r.id)).toEqual(["parent"]);
  });

  test("listByProject excludes subtasks (parentId set)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "parent", organizationId: ORG, projectId: "P1", title: "Parent", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "child", organizationId: ORG, projectId: "P1", title: "Child", status: "TODO", sortOrder: 2, parentId: "parent", createdAt: NOW, updatedAt: NOW });
    });
    const rows = await t.withIdentity(asUser).query(api.projectTasks.listByProject, { projectId: "P1", orgId: ORG });
    expect(rows.map((r) => r.id)).toEqual(["parent"]);
  });

  test("listSubtasks returns a task's children sorted, org-checked against the parent", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "parent", organizationId: ORG, projectId: "P1", title: "Parent", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "child2", organizationId: ORG, projectId: "P1", title: "Second", status: "TODO", parentId: "parent", sortOrder: 2, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "child1", organizationId: ORG, projectId: "P1", title: "First", status: "DONE", parentId: "parent", sortOrder: 1, completedAt: NOW, createdAt: NOW, updatedAt: NOW });
      // A same-id-parent row in another org must never leak in.
      await ctx.db.insert("projectTasks", { id: "foreign_child", organizationId: OTHER, projectId: "P1", title: "Foreign", status: "TODO", parentId: "parent", sortOrder: 3, createdAt: NOW, updatedAt: NOW });
    });
    const rows = await t.withIdentity(asUser).query(api.projectTasks.listSubtasks, { parentId: "parent", orgId: ORG });
    expect(rows).toEqual([
      { id: "child1", title: "First", status: "DONE", completedAt: NOW },
      { id: "child2", title: "Second", status: "TODO", completedAt: null },
    ]);
  });
});
