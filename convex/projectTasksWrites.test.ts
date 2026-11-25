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
    expect(res).toEqual({ updated: 1, skipped: 1, changedIds: ["t1"] });
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
    expect(res).toEqual({ deleted: 1, skipped: 1, deletedIds: ["t1"] });
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

  test("reorderNative assigns sortOrder=index for exactly the given ids, org re-checked", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "A", status: "TODO", sortOrder: 5, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "t2", organizationId: ORG, projectId: "P1", title: "B", status: "TODO", sortOrder: 6, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "tX", organizationId: OTHER, projectId: "P1", title: "Foreign", status: "TODO", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.reorderNative, {
      orgId: ORG, orderedIds: ["t2", "t1", "tX"], now: NOW + 1,
    });
    const rows = await tasks(t);
    expect(rows.find((r) => r.id === "t2")?.sortOrder).toBe(0);
    expect(rows.find((r) => r.id === "t1")?.sortOrder).toBe(1);
    // Foreign-org id at index 2 is silently skipped — untouched, not reordered in.
    const foreign = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "tX")).unique());
    expect(foreign?.sortOrder).toBe(0);
    expect(foreign?.updatedAt).toBe(NOW); // untouched
  });

});

const W = api.projectTasksWrites;
const events = (t: T) => t.run(async (ctx) => ctx.db.query("activityEvents").collect());
const seedTask = (t: T, over: Record<string, unknown> = {}) =>
  t.run(async (ctx) => {
    await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "A", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW, ...over } as never);
  });

describe("activityEvents (UX Phase 10)", () => {
  test("create, complete, update and delete each write one Activity row on the job, with no note text", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.createNative, { id: "t1", projectId: "P1", orgId: ORG, title: "Print call sheets", now: NOW, actor, auditId: "c1" });
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, status: "DONE", now: NOW + 1, actor, auditId: "u1" });
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "HIGH", now: NOW + 2, actor, auditId: "u2" });
    await u.mutation(W.deleteNative, { id: "t1", orgId: ORG, now: NOW + 3, actor, auditId: "d1" });
    const ev = await events(t);
    expect(ev.map((e) => e.action)).toEqual(["task_created", "task_completed", "task_updated", "task_deleted"]);
    expect(ev.every((e) => e.entityType === "project" && e.entityId === "P1" && e.orgId === ORG)).toBe(true);
  });

  test("an update that changes nothing writes nothing and reports changed:false", async () => {
    const t = makeT(); await seed(t); await seedTask(t);
    const r = await t.withIdentity(asUser).mutation(W.updateNative, { id: "t1", orgId: ORG, title: "A", now: NOW + 1, actor, auditId: "u1" });
    expect(r.changed).toBe(false);
    expect(await events(t)).toHaveLength(0);
  });
});

describe("task Undo (exact, ids only)", () => {
  test("undoCreate deletes only the unedited task, once", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.createNative, { id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "c1" });
    await u.mutation(W.undoCreateNative, { id: "t1", orgId: ORG, auditId: "c1", now: NOW + 1, actor });
    expect(await tasks(t)).toHaveLength(0);
    await expect(u.mutation(W.undoCreateNative, { id: "t1", orgId: ORG, auditId: "c1", now: NOW + 2, actor })).rejects.toThrow(/already undone|no longer exists/i);
  });

  test("undoCreate refuses once the task was edited", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.createNative, { id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "c1" });
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "HIGH", now: NOW + 1, actor, auditId: "u1" });
    await expect(u.mutation(W.undoCreateNative, { id: "t1", orgId: ORG, auditId: "c1", now: NOW + 2, actor })).rejects.toThrow(/edited since/i);
    expect(await tasks(t)).toHaveLength(1);
  });

  test("undoUpdate restores exactly the changed fields (incl. completedAt) and refuses a replay", async () => {
    const t = makeT(); await seed(t); await seedTask(t, { assigneeCrewId: "c1" });
    const u = t.withIdentity(asUser);
    const r = await u.mutation(W.updateNative, { id: "t1", orgId: ORG, status: "DONE", assigneeUserId: "u2", now: NOW + 1, actor, auditId: "u1" });
    expect(r.changed).toBe(true);
    expect((await tasks(t))[0]).toMatchObject({ status: "DONE", assigneeUserId: "u2", completedAt: NOW + 1 });
    const out = await u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "u1", ids: ["t1"], now: NOW + 2, actor });
    expect(out).toEqual({ restoredIds: ["t1"], skippedIds: [] });
    const row = (await tasks(t))[0];
    expect(row).toMatchObject({ status: "TODO", assigneeCrewId: "c1" });
    expect(row.assigneeUserId).toBeUndefined();
    expect(row.completedAt).toBeUndefined();
    await expect(u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "u1", ids: ["t1"], now: NOW + 3, actor })).rejects.toThrow(/already undone/i);
  });

  test("undoUpdate refuses when a later edit moved a field, changing nothing", async () => {
    const t = makeT(); await seed(t); await seedTask(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "HIGH", now: NOW + 1, actor, auditId: "u1" });
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "LOW", now: NOW + 2, actor, auditId: "u2" });
    await expect(u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "u1", ids: ["t1"], now: NOW + 3, actor })).rejects.toThrow(/changed since/i);
    expect((await tasks(t))[0].priority).toBe("LOW");
  });

  test("bulk update + undo reverse exactly the changed tasks; unchanged and foreign rows are untouched", async () => {
    const t = makeT(); await seed(t);
    await seedTask(t, { id: "t1" });
    await seedTask(t, { id: "t2", priority: "HIGH" }); // already HIGH: not changed by the bulk write
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "tX", organizationId: OTHER, projectId: "P1", title: "F", status: "TODO", sortOrder: 9, createdAt: NOW, updatedAt: NOW });
    });
    const u = t.withIdentity(asUser);
    const res = await u.mutation(W.bulkUpdateNative, { ids: ["t1", "t2", "tX"], orgId: ORG, priority: "HIGH", now: NOW + 1, actor, auditId: "b1" });
    expect(res.changedIds).toEqual(["t1"]);
    const out = await u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "b1", ids: res.changedIds, now: NOW + 2, actor });
    expect(out.restoredIds).toEqual(["t1"]);
    const rows = await tasks(t);
    expect(rows.find((r) => r.id === "t1")?.priority).toBeUndefined(); // exactly as before: absent
    expect(rows.find((r) => r.id === "t2")?.priority).toBe("HIGH");
    // A foreign id smuggled into the Undo's ids is never touched.
    await expect(u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "b1", ids: ["tX"], now: NOW + 3, actor })).rejects.toThrow();
  });

  test("restoreDeleted re-creates the task with its id, order and fields; drops an assignee who left; once", async () => {
    const t = makeT(); await seed(t); await seedTask(t, { assigneeUserId: "u2", description: "d", sortOrder: 7 });
    const u = t.withIdentity(asUser);
    const del = await u.mutation(W.bulkDeleteNative, { ids: ["t1"], orgId: ORG, now: NOW + 1, actor, auditId: "x1" });
    expect(await tasks(t)).toHaveLength(0);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", "u2")).first();
      if (m) await ctx.db.delete(m._id); // the assignee leaves the org
    });
    const out = await u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "x1", ids: del.deletedIds, now: NOW + 2, actor });
    expect(out.restoredIds).toEqual(["t1"]);
    const row = (await tasks(t))[0];
    expect(row).toMatchObject({ id: "t1", title: "A", description: "d", sortOrder: 7, createdAt: NOW });
    expect(row.assigneeUserId).toBeUndefined();
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "x1", ids: ["t1"], now: NOW + 3, actor })).rejects.toThrow(/already undone/i);
  });

  test("restoreDeleted refuses a task that exists again", async () => {
    const t = makeT(); await seed(t); await seedTask(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.deleteNative, { id: "t1", orgId: ORG, now: NOW + 1, actor, auditId: "d1" });
    await seedTask(t);
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "d1", ids: ["t1"], now: NOW + 2, actor })).rejects.toThrow(/exists again/i);
  });

  // ── Guard tests: each fails if THAT guard alone is removed (the paired checks cannot mask it) ──
  const asManager2 = { subject: "u2", orgId: ORG, role: "manager" };
  const actor2 = { userId: "u2", userName: "Bob" };
  const ageForwardRow = (t: T, rowId: string) =>
    t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", rowId)).first();
      if (!row) throw new Error("no forward row " + rowId);
      const d = row.details as Record<string, { serverSavedAt?: number }>;
      const key = Object.keys(d)[0];
      await ctx.db.patch(row._id, { details: { ...d, [key]: { ...d[key], serverSavedAt: Date.now() - 11 * 60 * 1000 } } });
    });
  const makeU2Manager = (t: T) =>
    t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", "u2")).first();
      if (m) await ctx.db.patch(m._id, { role: "manager" });
    });

  test("author guard: another person cannot undo a create, an update or a delete (the task is NOT in the way)", async () => {
    const t = makeT(); await seed(t); await makeU2Manager(t);
    const u = t.withIdentity(asUser);
    const u2 = t.withIdentity(asManager2);
    await u.mutation(W.createNative, { id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "c1" });
    await expect(u2.mutation(W.undoCreateNative, { id: "t1", orgId: ORG, auditId: "c1", now: NOW + 1, actor: actor2 })).rejects.toThrow(/Only the person/i);
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "HIGH", now: NOW + 2, actor, auditId: "u1" });
    await expect(u2.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "u1", ids: ["t1"], now: NOW + 3, actor: actor2 })).rejects.toThrow(/Only the person/i);
    await u.mutation(W.deleteNative, { id: "t1", orgId: ORG, now: NOW + 4, actor, auditId: "d1" });
    expect(await tasks(t)).toHaveLength(0); // nothing exists again, so ONLY the author guard can refuse
    await expect(u2.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "d1", ids: ["t1"], now: NOW + 5, actor: actor2 })).rejects.toThrow(/Only the person/i);
    expect(await tasks(t)).toHaveLength(0);
  });

  test("window guard: an Undo older than 10 minutes on the SERVER clock is refused for create, update and delete", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.createNative, { id: "t1", projectId: "P1", orgId: ORG, title: "X", now: NOW, actor, auditId: "c1" });
    await ageForwardRow(t, "c1");
    await expect(u.mutation(W.undoCreateNative, { id: "t1", orgId: ORG, auditId: "c1", now: NOW + 1, actor })).rejects.toThrow(/10 minutes/i);
    expect(await tasks(t)).toHaveLength(1);
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "HIGH", now: NOW + 2, actor, auditId: "u1" });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "u1:t1")).first();
      const fe = (row!.details as { fieldEdit: Record<string, unknown> }).fieldEdit;
      await ctx.db.patch(row!._id, { details: { fieldEdit: { ...fe, serverSavedAt: Date.now() - 11 * 60 * 1000 } } });
    });
    await expect(u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "u1", ids: ["t1"], now: NOW + 3, actor })).rejects.toThrow(/10 minutes/i);
    await u.mutation(W.deleteNative, { id: "t1", orgId: ORG, now: NOW + 4, actor, auditId: "d1" });
    await ageForwardRow(t, "d1:t1");
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "d1", ids: ["t1"], now: NOW + 5, actor })).rejects.toThrow(/10 minutes/i);
    expect(await tasks(t)).toHaveLength(0);
  });

  // The SAME user belongs to both orgs, so the author check passes; the other org's task shares the id and is found
  // FIRST by the global `by_cuid` index. Only the forward row's own org check stops the cross-org Undo.
  async function twoOrgSameIdFixture() {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m_o", organizationId: OTHER, userId: USER, role: "manager", createdAt: 1 });
      await ctx.db.insert("projects", { id: "PO", organizationId: OTHER, projectNumber: "PO", name: "Other org job", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: OTHER, projectId: "PO", title: "Theirs", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    });
    return { t, asOther: { subject: USER, orgId: OTHER, role: "manager" } };
  }

  test("forward-row org guard: another org cannot undo a create through a same-id task of its own", async () => {
    const { t, asOther } = await twoOrgSameIdFixture();
    await t.withIdentity(asUser).mutation(W.createNative, { id: "t1", projectId: "P1", orgId: ORG, title: "Mine", now: NOW, actor, auditId: "c1" });
    await expect(t.withIdentity(asOther).mutation(W.undoCreateNative, { id: "t1", orgId: OTHER, auditId: "c1", now: NOW + 1, actor })).rejects.toThrow(/not found/i);
    const rows = await t.run(async (ctx) => ctx.db.query("projectTasks").collect());
    expect(rows.map((r) => r.organizationId).sort()).toEqual([ORG, OTHER]); // neither task deleted
  });

  test("forward-row org guard: another org cannot restore a delete", async () => {
    const { t, asOther } = await twoOrgSameIdFixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t9", organizationId: ORG, projectId: "P1", title: "Mine", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser).mutation(W.deleteNative, { id: "t9", orgId: ORG, now: NOW + 1, actor, auditId: "d1" });
    await expect(t.withIdentity(asOther).mutation(W.restoreDeletedNative, { orgId: OTHER, auditId: "d1", ids: ["t9"], now: NOW + 2, actor })).rejects.toThrow(/not found/i);
    expect((await t.run(async (ctx) => ctx.db.query("projectTasks").collect())).some((r) => r.id === "t9")).toBe(false);
  });

  test("snapshot guard: a delete row whose stored task is another org's, or another id, is not restorable", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    const forge = (rowId: string, row: Record<string, unknown>) =>
      t.run(async (ctx) => {
        await ctx.db.insert("activityLogs", {
          id: rowId, organizationId: ORG, action: "deleted", entityType: "ProjectTask", entityId: "t1", entityName: "Forged", userId: USER, userName: "Alice",
          summary: "x", createdAt: NOW, details: { deletedTask: { authorId: USER, serverSavedAt: Date.now(), row } },
        });
      });
    const base = { id: "t1", organizationId: ORG, projectId: "P1", title: "Forged", status: "TODO", createdAt: NOW, updatedAt: NOW };
    await forge("f1:t1", { ...base, organizationId: OTHER }); // the snapshot says another org
    await forge("f2:t1", { ...base, id: "someone-else" }); // the snapshot is another task
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "f1", ids: ["t1"], now: NOW + 1, actor })).rejects.toThrow(/can't be undone/i);
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "f2", ids: ["t1"], now: NOW + 1, actor })).rejects.toThrow(/can't be undone/i);
    expect(await tasks(t)).toHaveLength(0);
  });

  test("project guard: a task whose job moved to another org is not re-created", async () => {
    const t = makeT(); await seed(t); await seedTask(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.deleteNative, { id: "t1", orgId: ORG, now: NOW + 1, actor, auditId: "d1" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).first();
      await ctx.db.patch(p!._id, { organizationId: OTHER });
    });
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "d1", ids: ["t1"], now: NOW + 2, actor })).rejects.toThrow(/no longer exists/i);
    expect(await tasks(t)).toHaveLength(0);
  });

  test("bulk Undo refuses AS A WHOLE: if one task changed since, NOTHING is restored and the task is named", async () => {
    const t = makeT(); await seed(t);
    await seedTask(t, { id: "t1", title: "Order cables" });
    await seedTask(t, { id: "t2", title: "Book truck" });
    const u = t.withIdentity(asUser);
    const r = await u.mutation(W.bulkUpdateNative, { ids: ["t1", "t2"], orgId: ORG, priority: "HIGH", now: NOW + 1, actor, auditId: "b1" });
    expect(r.changedIds).toEqual(["t1", "t2"]);
    await u.mutation(W.updateNative, { id: "t2", orgId: ORG, priority: "LOW", now: NOW + 2, actor, auditId: "u2" }); // t2 moved on
    await expect(u.mutation(W.undoUpdateNative, { orgId: ORG, auditId: "b1", ids: r.changedIds, now: NOW + 3, actor })).rejects.toThrow(/“Book truck” changed since. Nothing was restored/);
    const rows = await tasks(t);
    expect(rows.find((x) => x.id === "t1")?.priority).toBe("HIGH"); // t1 was NOT restored either
    expect(rows.find((x) => x.id === "t2")?.priority).toBe("LOW");
  });

  test("bulk restore refuses as a whole too: one task exists again, nothing comes back", async () => {
    const t = makeT(); await seed(t);
    await seedTask(t, { id: "t1", title: "A" });
    await seedTask(t, { id: "t2", title: "B" });
    const u = t.withIdentity(asUser);
    const del = await u.mutation(W.bulkDeleteNative, { ids: ["t1", "t2"], orgId: ORG, now: NOW + 1, actor, auditId: "x1" });
    await seedTask(t, { id: "t2", title: "B again" });
    await expect(u.mutation(W.restoreDeletedNative, { orgId: ORG, auditId: "x1", ids: del.deletedIds, now: NOW + 2, actor })).rejects.toThrow(/“B” changed since. Nothing was restored/);
    expect((await tasks(t)).map((x) => x.id)).toEqual(["t2"]); // t1 was NOT brought back
  });

  test("reorder guard: tasks of another job (or another org) in the forward row are never restored through this job", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "P2", organizationId: ORG, projectNumber: "P2", name: "Second", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await seedTask(t, { id: "t1", sortOrder: 5 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t3", organizationId: ORG, projectId: "P2", title: "Other job", status: "TODO", sortOrder: 6, createdAt: NOW, updatedAt: NOW });
    });
    const u = t.withIdentity(asUser);
    await u.mutation(W.reorderNative, { orgId: ORG, orderedIds: ["t3", "t1"], now: NOW + 1, auditId: "r1", actor }); // spans two jobs
    // The row is recorded against the job of its first task (P2): t1, a P1 task, must not be restored through it.
    await expect(u.mutation(W.undoReorderNative, { orgId: ORG, auditId: "r1", projectId: "P2", now: NOW + 2, actor })).rejects.toThrow(/changed since/i);
    const rows = await tasks(t);
    expect(rows.find((x) => x.id === "t1")?.sortOrder).toBe(1); // untouched: the Undo refused as a whole
    const t3 = await t.run(async (ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t3")).first());
    expect(t3?.sortOrder).toBe(0);
  });

  test("reorder guard: a foreign-org task id in the row is not found, never restored", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "tF", organizationId: OTHER, projectId: "P1", title: "Foreign", status: "TODO", sortOrder: 3, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("activityLogs", {
        id: "rf", organizationId: ORG, action: "UPDATE", entityType: "ProjectTaskOrder", entityId: "P1", entityName: "Task order", userId: USER, userName: "Alice", summary: "x", createdAt: NOW,
        details: { fieldEdit: { before: { tF: 9 }, after: { tF: 3 }, serverSavedAt: Date.now(), authorId: USER } },
      });
    });
    await expect(t.withIdentity(asUser).mutation(W.undoReorderNative, { orgId: ORG, auditId: "rf", projectId: "P1", now: NOW + 1, actor })).rejects.toThrow(/changed since/i);
    expect((await t.run(async (ctx) => ctx.db.query("projectTasks").collect())).find((x) => x.id === "tF")?.sortOrder).toBe(3);
  });

  test("a cross-org caller cannot undo another org's task changes", async () => {
    const t = makeT(); await seed(t); await seedTask(t);
    const u = t.withIdentity(asUser);
    await u.mutation(W.updateNative, { id: "t1", orgId: ORG, priority: "HIGH", now: NOW + 1, actor, auditId: "u1" });
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: "o1", role: "manager", createdAt: 1 });
    });
    await expect(
      t.withIdentity({ subject: "o1", orgId: OTHER, role: "manager" }).mutation(W.undoUpdateNative, {
        orgId: OTHER, auditId: "u1", ids: ["t1"], now: NOW + 2, actor: { userId: "o1", userName: "O" },
      }),
    ).rejects.toThrow();
    expect((await tasks(t))[0].priority).toBe("HIGH");
  });

  test("reorder + undoReorder restore each task's previous order only while untouched", async () => {
    const t = makeT(); await seed(t);
    await seedTask(t, { id: "t1", sortOrder: 5 });
    await seedTask(t, { id: "t2", sortOrder: 6 });
    const u = t.withIdentity(asUser);
    const r = await u.mutation(W.reorderNative, { orgId: ORG, orderedIds: ["t2", "t1"], now: NOW + 1, auditId: "r1", actor });
    expect(r.changed).toBe(true);
    expect((await tasks(t)).map((x) => [x.id, x.sortOrder]).sort()).toEqual([["t1", 1], ["t2", 0]]);
    const back = await u.mutation(W.undoReorderNative, { orgId: ORG, auditId: "r1", projectId: "P1", now: NOW + 2, actor });
    expect(back.restored).toBe(2);
    expect((await tasks(t)).map((x) => [x.id, x.sortOrder]).sort()).toEqual([["t1", 5], ["t2", 6]]);
    await expect(u.mutation(W.undoReorderNative, { orgId: ORG, auditId: "r1", projectId: "P1", now: NOW + 3, actor })).rejects.toThrow(/already undone/i);
  });

  test("undoReorder refuses when a later reorder moved the tasks", async () => {
    const t = makeT(); await seed(t);
    await seedTask(t, { id: "t1", sortOrder: 5 });
    await seedTask(t, { id: "t2", sortOrder: 6 });
    const u = t.withIdentity(asUser);
    await u.mutation(W.reorderNative, { orgId: ORG, orderedIds: ["t2", "t1"], now: NOW + 1, auditId: "r1", actor });
    await u.mutation(W.reorderNative, { orgId: ORG, orderedIds: ["t1", "t2"], now: NOW + 2, auditId: "r2", actor });
    await expect(u.mutation(W.undoReorderNative, { orgId: ORG, auditId: "r1", projectId: "P1", now: NOW + 3, actor })).rejects.toThrow(/changed since/i);
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
});
