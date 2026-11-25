// @vitest-environment node
//
// UX Phase 10 Slice E: `projectTaskLinks`. Link / unlink with EXACT ids-only Undo, every
// target and task org- and job-checked, the bounded one-read `listForProject`, and the
// stale-undo refusals (author, window, once, changed since, cross-org forward row).
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
const W = api.projectTaskLinksWrites;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager", createdAt: 1 });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "u2", role: "manager", createdAt: 2 });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.co" });
    await ctx.db.insert("users", { id: "u2", name: "Bob", email: "b@x.co" });
    for (const [id, org] of [["P1", ORG], ["P2", ORG], ["PX", OTHER]] as const) {
      await ctx.db.insert("projects", { id, organizationId: org, projectNumber: id, name: id, status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, projectId: "P1", title: "Book truck", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectTasks", { id: "tX", organizationId: OTHER, projectId: "PX", title: "Theirs", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "P1", description: "Transport", quantity: 1 } as never);
    await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "P2", description: "Other job line", quantity: 1 } as never);
    await ctx.db.insert("projectLineItems", { id: "liX", organizationId: OTHER, projectId: "PX", description: "Foreign line", quantity: 1 } as never);
    await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "rider.pdf", fileSize: 10, mimeType: "application/pdf", url: "u", storageKey: "k", uploadedById: USER, createdAt: NOW } as never);
    await ctx.db.insert("projectMedia", { id: "pm1", organizationId: ORG, projectId: "P1", fileId: "f1", type: "OTHER", createdAt: NOW });
  });
}

const link = (t: T, over: Record<string, unknown> = {}) =>
  t.withIdentity(asUser).mutation(W.linkNative, { id: "l1", orgId: ORG, taskId: "t1", linkedKind: "lineItem", linkedId: "li1", now: NOW, actor, auditId: "a1", ...over } as never);
const links = (t: T) => t.run(async (ctx) => ctx.db.query("projectTaskLinks").collect());
const auditRow = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const events = (t: T) => t.run(async (ctx) => ctx.db.query("activityEvents").collect());

describe("linkNative", () => {
  test("links a line item and a file, writes an audit row and an activity event", async () => {
    const t = makeT(); await seed(t);
    expect(await link(t)).toEqual({ id: "l1", created: true });
    await link(t, { id: "l2", linkedKind: "file", linkedId: "pm1", auditId: "a2" });
    expect((await links(t)).map((l) => [l.linkedKind, l.linkedId])).toEqual([["lineItem", "li1"], ["file", "pm1"]]);
    expect((await auditRow(t, "a1"))?.summary).toBe('Linked task "Book truck" to line item "Transport"');
    expect((await events(t)).map((e) => e.action)).toEqual(["task_linked", "task_linked"]);
  });

  test("links a discussion thread on the job", async () => {
    const t = makeT(); await seed(t);
    const threadId = await t.run(async (ctx) =>
      String(await ctx.db.insert("commentThreads", { orgId: ORG, entityType: "project", entityId: "P1", projectId: "P1", status: "open", createdBy: USER, createdByName: "Alice", createdAt: NOW, updatedAt: NOW })),
    );
    expect(await link(t, { linkedKind: "discussion", linkedId: threadId })).toEqual({ id: "l1", created: true });
  });

  test("is idempotent: the same pair returns the existing link, with no write and no audit row", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    expect(await link(t, { id: "l9", auditId: "a9" })).toEqual({ id: "l1", created: false });
    expect(await links(t)).toHaveLength(1);
    expect(await auditRow(t, "a9")).toBeNull();
  });

  test("a target on another job, or in another org, is refused", async () => {
    const t = makeT(); await seed(t);
    await expect(link(t, { linkedId: "li2" })).rejects.toThrow(/not on this job/);
    await expect(link(t, { linkedId: "liX" })).rejects.toThrow(/not on this job/);
    await expect(link(t, { linkedKind: "file", linkedId: "nope" })).rejects.toThrow(/not on this job/);
    await expect(link(t, { linkedKind: "discussion", linkedId: "not-a-convex-id" })).rejects.toThrow(/not on this job/);
    expect(await links(t)).toHaveLength(0);
  });

  test("another org's task is refused, and a viewer cannot link", async () => {
    const t = makeT(); await seed(t);
    await expect(link(t, { taskId: "tX" })).rejects.toThrow(/Task not found/);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(W.linkNative, { id: "l1", orgId: ORG, taskId: "t1", linkedKind: "lineItem", linkedId: "li1", now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow();
  });

  test("a task takes at most 25 links", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) await ctx.db.insert("projectTaskLinks", { id: `x${i}`, organizationId: ORG, taskId: "t1", linkedKind: "file", linkedId: `gone${i}`, createdById: USER, createdAt: NOW });
    });
    await expect(link(t)).rejects.toThrow(/at most 25/);
  });
});

describe("Undo (ids only, exact)", () => {
  const unlink = (t: T, over: Record<string, unknown> = {}) =>
    t.withIdentity(asUser).mutation(W.unlinkNative, { id: "l1", orgId: ORG, now: NOW + 1, actor, auditId: "u1", ...over } as never);
  const undoUnlink = (t: T, as: object = asUser, over: Record<string, unknown> = {}) =>
    t.withIdentity(as).mutation(W.undoUnlinkNative, { id: "l1", orgId: ORG, auditId: "u1", now: NOW + 2, actor, ...over } as never);
  const undoLink = (t: T, as: object = asUser, over: Record<string, unknown> = {}) =>
    t.withIdentity(as).mutation(W.undoLinkNative, { id: "l1", orgId: ORG, auditId: "a1", now: NOW + 2, actor, ...over } as never);
  const age = (t: T, rowId: string) =>
    t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", rowId)).first();
      const d = row!.details as { taskLink: Record<string, unknown> };
      await ctx.db.patch(row!._id, { details: { taskLink: { ...d.taskLink, serverSavedAt: Date.now() - 11 * 60 * 1000 } } });
    });

  test("undoLink deletes only that link, once", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await link(t, { id: "l2", linkedKind: "file", linkedId: "pm1", auditId: "a2" });
    expect(await undoLink(t)).toEqual({ ok: true });
    expect((await links(t)).map((l) => l.id)).toEqual(["l2"]);
    await expect(undoLink(t)).rejects.toThrow(/already undone/i);
  });

  test("undoLink refuses when the link was already removed by someone else (nothing changes)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await unlink(t);
    await expect(undoLink(t)).rejects.toThrow(/already removed/i);
  });

  test("unlink then undoUnlink re-creates the SAME link; a second undo is refused", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await unlink(t);
    expect(await links(t)).toHaveLength(0);
    expect(await undoUnlink(t)).toEqual({ id: "l1" });
    const [row] = await links(t);
    expect([row.id, row.taskId, row.linkedKind, row.linkedId, row.createdById, row.createdAt]).toEqual(["l1", "t1", "lineItem", "li1", USER, NOW]);
    await expect(undoUnlink(t)).rejects.toThrow(/already undone/i);
  });

  test("author guard: another person cannot undo a link or an unlink", async () => {
    const t = makeT(); await seed(t);
    const asU2 = { subject: "u2", orgId: ORG, role: "manager" };
    await link(t);
    await expect(undoLink(t, asU2, { actor: { userId: "u2", userName: "Bob" } })).rejects.toThrow(/only the person/i);
    expect(await links(t)).toHaveLength(1); // untouched
    await unlink(t);
    await expect(undoUnlink(t, asU2, { actor: { userId: "u2", userName: "Bob" } })).rejects.toThrow(/only the person/i);
    expect(await links(t)).toHaveLength(0); // still unlinked
  });

  test("window guard: an Undo after 10 minutes on the server clock is refused", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await age(t, "a1");
    await expect(undoLink(t)).rejects.toThrow(/10 minutes/i);
    expect(await links(t)).toHaveLength(1);
    await unlink(t);
    await age(t, "u1");
    await expect(undoUnlink(t)).rejects.toThrow(/10 minutes/i);
    expect(await links(t)).toHaveLength(0);
  });

  test("undoUnlink refuses when the pair exists again, the task is gone or the target is gone", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await unlink(t);
    await link(t, { id: "l5", auditId: "a5" }); // the same pair, re-linked by hand
    await expect(undoUnlink(t)).rejects.toThrow(/already exists again/i);
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectTaskLinks").withIndex("by_cuid", (q) => q.eq("id", "l5")).first();
      await ctx.db.delete(l!._id);
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      await ctx.db.delete(li!._id);
    });
    await expect(undoUnlink(t)).rejects.toThrow(/no longer exists/i);
    expect(await links(t)).toHaveLength(0);
    await t.run(async (ctx) => {
      const task = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t1")).first();
      await ctx.db.delete(task!._id);
    });
    await expect(undoUnlink(t)).rejects.toThrow(/no longer exists/i);
  });

  test("an unlink's audit row cannot be used to undo a link (action mismatch), nor the reverse", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await unlink(t, { auditId: "u1" });
    await expect(undoLink(t, asUser, { auditId: "u1" })).rejects.toThrow(/can't be undone/i);
    await link(t, { id: "l3", linkedKind: "file", linkedId: "pm1", auditId: "a3" });
    await expect(undoUnlink(t, asUser, { id: "l3", auditId: "a3" })).rejects.toThrow(/can't be undone/i);
  });

  test("forward-row org guard: another org cannot undo through the link id", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m_o", organizationId: OTHER, userId: USER, role: "manager", createdAt: 1 });
    });
    const asOther = { subject: USER, orgId: OTHER, role: "manager" };
    await link(t);
    await expect(undoLink(t, asOther, { orgId: OTHER })).rejects.toThrow(/not found/i);
    await unlink(t);
    await expect(undoUnlink(t, asOther, { orgId: OTHER })).rejects.toThrow(/not found/i);
    expect(await links(t)).toHaveLength(0);
  });

  // The forward row is only trusted for THIS link: kill the entityId / entityType / org checks one by one.
  const patchAudit = (t: T, rowId: string, patch: Record<string, unknown>) =>
    t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", rowId)).first();
      await ctx.db.patch(row!._id, patch as never);
    });

  test("a forward row for ANOTHER link cannot undo this one (entityId check)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await link(t, { id: "l2", linkedKind: "file", linkedId: "pm1", auditId: "a2" });
    await expect(undoLink(t, asUser, { id: "l2", auditId: "a1" })).rejects.toThrow(/not found/i);
    expect(await links(t)).toHaveLength(2);
  });

  test("an audit row of another entity type cannot be used as a forward row (entityType check)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await patchAudit(t, "a1", { entityType: "ProjectTask" });
    await expect(undoLink(t, asUser, { id: "l1", auditId: "a1" })).rejects.toThrow(/not found/i);
    expect(await links(t)).toHaveLength(1);
  });

  test("an Undo marker from ANOTHER org with the same id does not block this org's Undo (marker org check)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "undo:a1", organizationId: OTHER, action: "UNDO", entityType: "ProjectTaskLink", entityId: "l1", entityName: "x", userId: "z", userName: "Z", summary: "x", createdAt: NOW } as never);
    });
    expect(await undoLink(t)).toEqual({ ok: true });
    expect(await links(t)).toHaveLength(0);
  });

  test("a tampered unlink snapshot (another link id, or another org) is refused", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await unlink(t);
    const setSnap = (over: Record<string, unknown>) =>
      t.run(async (ctx) => {
        const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "u1")).first();
        const d = row!.details as { taskLink: { row: Record<string, unknown> } };
        await ctx.db.patch(row!._id, { details: { taskLink: { ...d.taskLink, row: { ...d.taskLink.row, ...over } } } });
      });
    await setSnap({ id: "someone-else" });
    await expect(undoUnlink(t)).rejects.toThrow(/can't be undone/i);
    await setSnap({ id: "l1", organizationId: OTHER });
    await expect(undoUnlink(t)).rejects.toThrow(/can't be undone/i);
    expect(await links(t)).toHaveLength(0);
  });

  test("undoUnlink refuses when a link with the same id exists again (a different pair)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await unlink(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTaskLinks", { id: "l1", organizationId: ORG, taskId: "t1", linkedKind: "file", linkedId: "pm1", createdById: USER, createdAt: NOW });
    });
    await expect(undoUnlink(t)).rejects.toThrow(/already exists again/i);
  });

  test("a viewer cannot unlink, undo a link or undo an unlink (each stays refused after the manager's own write)", async () => {
    const t = makeT(); await seed(t);
    const asViewer = { subject: "v1", orgId: ORG, role: "viewer" };
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mv", organizationId: ORG, userId: "v1", role: "viewer", createdAt: 3 });
    });
    await link(t);
    await expect(t.withIdentity(asViewer).mutation(W.unlinkNative, { id: "l1", orgId: ORG, now: NOW, actor: { userId: "v1", userName: "V" }, auditId: "uv" })).rejects.toThrow();
    await expect(undoLink(t, asViewer, { actor: { userId: "v1", userName: "V" } })).rejects.toThrow();
    expect(await links(t)).toHaveLength(1);
    await unlink(t);
    await expect(undoUnlink(t, asViewer, { actor: { userId: "v1", userName: "V" } })).rejects.toThrow();
    expect(await links(t)).toHaveLength(0);
  });

  test("a client-chosen link id or audit id that is already used is refused (link and unlink)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await expect(link(t, { id: "l1", linkedKind: "file", linkedId: "pm1", auditId: "a7" })).rejects.toThrow(/link id is already used/i);
    await expect(link(t, { id: "l8", linkedKind: "file", linkedId: "pm1", auditId: "a1" })).rejects.toThrow(/audit id is already used/i);
    await expect(unlink(t, { auditId: "a1" })).rejects.toThrow(/audit id is already used/i);
    expect(await links(t)).toHaveLength(1);
  });

  test("unlink of a link in another org is refused", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTaskLinks", { id: "lx", organizationId: OTHER, taskId: "tX", linkedKind: "lineItem", linkedId: "liX", createdById: "z", createdAt: NOW });
    });
    await expect(unlink(t, { id: "lx" })).rejects.toThrow(/Link not found/);
    expect(await links(t)).toHaveLength(1);
  });
});

describe("listForProject", () => {
  const list = (t: T, orgId = ORG, projectId = "P1", as: object = asUser) => t.withIdentity(as).query(api.projectTaskLinks.listForProject, { orgId, projectId });

  test("returns each link with its target's label in ONE read", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await link(t, { id: "l2", linkedKind: "file", linkedId: "pm1", auditId: "a2" });
    const r = await list(t);
    expect(r.links.map((l) => [l.taskId, l.kind, l.label])).toEqual([["t1", "lineItem", "Transport"], ["t1", "file", "rider.pdf"]]);
    expect(r.truncated).toBe(false);
  });

  test("drops a link whose target is gone or moved to another job (never leaks, never errors)", async () => {
    const t = makeT(); await seed(t);
    await link(t);
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      await ctx.db.patch(li!._id, { projectId: "P2" });
      await ctx.db.insert("projectTaskLinks", { id: "lz", organizationId: ORG, taskId: "t1", linkedKind: "lineItem", linkedId: "liX", createdById: USER, createdAt: NOW });
    });
    expect((await list(t)).links).toEqual([]);
  });

  test("a caller whose org is not the requested org is refused, and another org's job reads empty", async () => {
    const t = makeT(); await seed(t);
    await expect(list(t, OTHER, "PX")).rejects.toThrow();
    expect((await list(t, ORG, "PX")).links).toEqual([]);
  });
});
