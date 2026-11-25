// @vitest-environment node
//
// Templates (UX Phase 9, D23): archive / unarchive (exact Undo), apply / undo apply onto a
// wizard draft, and the list read. Every refusal is tested on its own.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const OTHER = "user_2";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: USER, userName: "Alice" };
const asUser = (subject = USER, orgId = ORG) => ({ subject, orgId });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seedMembers(t: T, role = "owner") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: OTHER, role });
  });
}

type Seed = { id: string; org?: string; status?: string; updatedAt?: number; lines?: number; tags?: string[]; type?: string; description?: string; discountPercent?: number };
async function seedTemplate(t: T, s: Seed) {
  const org = s.org ?? ORG;
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: s.id, organizationId: org, projectNumber: `T-${s.id}`, name: `Template ${s.id}`, isTemplate: true,
      ...(s.status ? { status: s.status as "CANCELLED" } : {}), liveVersionId: `v-${s.id}`, createdAt: NOW, updatedAt: s.updatedAt ?? NOW,
      tags: s.tags ?? [], ...(s.type ? { type: s.type as "TOUR" } : {}),
      ...(s.description ? { description: s.description } : {}), ...(s.discountPercent != null ? { discountPercent: s.discountPercent } : {}),
    });
    await ctx.db.insert("projectVersions", { id: `v-${s.id}`, organizationId: org, projectId: s.id, number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    for (let i = 0; i < (s.lines ?? 0); i++) {
      await ctx.db.insert("projectLineItems", { versionId: `v-${s.id}`, lineageId: `${s.id}l${i}`, id: `${s.id}l${i}`, organizationId: org, projectId: s.id, type: "EQUIPMENT", quantity: 2 + i, unitPrice: 100, lineTotal: 200, status: "QUOTED", sortOrder: i, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("projectManagers", { id: `pm-${s.id}`, organizationId: org, projectId: s.id, userId: OTHER, addedAt: NOW });
  });
}

async function seedDraft(t: T, over: { lines?: boolean; status?: string; tags?: string[]; type?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "d1", organizationId: ORG, projectNumber: "P-1", name: "Draft", status: (over.status ?? "ENQUIRY") as "ENQUIRY", isTemplate: false,
      liveVersionId: "v-d1", createdAt: NOW, updatedAt: NOW, tags: over.tags ?? [], type: (over.type ?? "OTHER") as "OTHER",
    });
    await ctx.db.insert("projectVersions", { id: "v-d1", organizationId: ORG, projectId: "d1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    if (over.lines) {
      await ctx.db.insert("projectLineItems", { versionId: "v-d1", lineageId: "own", id: "own", organizationId: ORG, projectId: "d1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    }
  });
}

const status = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.status);

describe("archive / unarchive", () => {
  const archive = (t: T, ids: string[], who = asUser()) => t.withIdentity(who).mutation(api.projectTemplateWrites.archiveTemplatesNative, { orgId: ORG, ids, actor: ACTOR, auditId: "arc", now: NOW });
  const unarchive = (t: T, items: { id: string; auditId: string }[], who = asUser()) => t.withIdentity(who).mutation(api.projectTemplateWrites.unarchiveTemplatesNative, { orgId: ORG, items, actor: ACTOR, now: NOW });

  test("archives templates (status CANCELLED) and Undo restores exactly what was there, including no status at all", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    await seedTemplate(t, { id: "b", status: "ENQUIRY" });
    const r = await archive(t, ["a", "b"]);
    expect(r.archived.map((x) => x.id)).toEqual(["a", "b"]);
    expect(await status(t, "a")).toBe("CANCELLED");
    expect(await unarchive(t, r.archived)).toEqual({ restored: ["a", "b"] });
    expect(await status(t, "a")).toBeFalsy(); // absent again (t.run reports absent as null)
    expect(await status(t, "b")).toBe("ENQUIRY");
  });

  test("an already archived template is skipped (no Undo for it)", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a", status: "CANCELLED" });
    expect((await archive(t, ["a"])).archived).toEqual([]);
  });

  test("a job (not a template), another org's template, and a missing id are refused; nothing is archived", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    await seedTemplate(t, { id: "x", org: "org_2" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "job", organizationId: ORG, projectNumber: "J", name: "Job", status: "ENQUIRY", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    for (const bad of ["job", "x", "nope"]) await expect(archive(t, ["a", bad])).rejects.toThrow(/Template not found/);
    expect(await status(t, "a")).toBeFalsy();
  });

  test("needs project:delete", async () => {
    const t = makeT();
    await seedMembers(t, "viewer");
    await seedTemplate(t, { id: "a" });
    await expect(archive(t, ["a"])).rejects.toThrow();
    expect(await status(t, "a")).toBeFalsy();
  });

  test("Undo refuses as a whole after someone else changed the status, after the window, and twice", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    await seedTemplate(t, { id: "b" });
    const r = await archive(t, ["a", "b"]);
    await t.run(async (ctx) => {
      const b = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "b")).first();
      await ctx.db.patch(b!._id, { status: "ENQUIRY" });
    });
    await expect(unarchive(t, r.archived)).rejects.toThrow(/changed since/);
    expect(await status(t, "a")).toBe("CANCELLED"); // all-or-nothing: a was not restored either
    const t2 = makeT();
    await seedMembers(t2);
    await seedTemplate(t2, { id: "a" });
    const r2 = await archive(t2, ["a"]);
    await unarchive(t2, r2.archived);
    await expect(unarchive(t2, r2.archived)).rejects.toThrow(/already undone/);
  });

  test("Undo is for the person who archived; another user's ids are refused", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    const r = await archive(t, ["a"]);
    await expect(t.withIdentity(asUser(OTHER)).mutation(api.projectTemplateWrites.unarchiveTemplatesNative, {
      orgId: ORG, items: r.archived, actor: { userId: OTHER, userName: "Bob" }, now: NOW,
    })).rejects.toThrow(/Only the person/);
  });

  test("Undo refuses outside the 10-minute window (server clock)", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    const r = await archive(t, ["a"]);
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      await expect(unarchive(t, r.archived)).rejects.toThrow(/10 minutes/);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("applyTemplateNative / undoApplyTemplateNative", () => {
  const apply = (t: T, over: Partial<{ draftId: string; templateId: string; auditId: string }> = {}, who = asUser()) =>
    t.withIdentity(who).mutation(api.projectTemplateWrites.applyTemplateNative, { orgId: ORG, draftId: "d1", templateId: "t1", actor: ACTOR, auditId: "ap1", now: NOW, ...over });
  const undo = (t: T, who = asUser(), actor = ACTOR) =>
    t.withIdentity(who).mutation(api.projectTemplateWrites.undoApplyTemplateNative, { orgId: ORG, projectId: "d1", applyAuditId: "ap1", actor, now: NOW + 5 });
  const lineIds = (t: T) => t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", "v-d1")).collect()).map((l) => l.id));
  const draft = (t: T) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "d1")).first());

  async function setup(t: T, tpl: Partial<Seed> = {}) {
    await seedMembers(t);
    await seedTemplate(t, { id: "t1", lines: 2, tags: ["gala"], type: "TOUR", description: "Ballroom", discountPercent: 5, ...tpl });
    await seedDraft(t, { tags: ["mine"] });
  }

  test("copies the template's gear onto the empty draft and fills type, tags, description and discount only where the draft has none", async () => {
    const t = makeT();
    await setup(t);
    const applied = await apply(t);
    expect(applied).toMatchObject({ id: "d1", lineCount: 2 });
    // What the wizard form adopts: the scalars filled, and what the draft had before (null = none).
    expect(applied.applied).toMatchObject({ type: "TOUR", description: "Ballroom", discountPercent: 5 });
    expect(applied.previous).toMatchObject({ description: null, discountPercent: null, tags: ["mine"] });
    expect(await lineIds(t)).toHaveLength(2);
    const d = await draft(t);
    expect(d).toMatchObject({ type: "TOUR", description: "Ballroom", discountPercent: 5, name: "Draft", projectNumber: "P-1", status: "ENQUIRY" });
    expect([...(d?.tags ?? [])].sort()).toEqual(["gala", "mine"]);
    // The draft's own number, name and the template's manager came across without duplicating.
    const pms = await t.run(async (ctx) => ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "d1")).collect());
    expect(pms.map((p) => p.userId)).toEqual([OTHER]);
  });

  test("never overwrites what the draft already has", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "t1", lines: 1, type: "TOUR", description: "Theirs" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "d1", organizationId: ORG, projectNumber: "P-1", name: "Draft", status: "ENQUIRY", isTemplate: false, liveVersionId: "v-d1", type: "FESTIVAL", description: "Mine", discountPercent: 2, tags: [], createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: "v-d1", organizationId: ORG, projectId: "d1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    });
    await apply(t);
    expect(await draft(t)).toMatchObject({ type: "FESTIVAL", description: "Mine", discountPercent: 2 });
  });

  test("refuses a draft that already has gear, a job past Enquiry, another org's template, an archived template and another org's draft", async () => {
    const t = makeT();
    await setup(t);
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", { versionId: "v-d1", lineageId: "own", id: "own", organizationId: ORG, projectId: "d1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 0, createdAt: NOW, updatedAt: NOW }); });
    await expect(apply(t)).rejects.toThrow(/already has gear/);
    const t2 = makeT();
    await setup(t2);
    await t2.run(async (ctx) => { const d = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "d1")).first(); await ctx.db.patch(d!._id, { status: "QUOTING" }); });
    await expect(apply(t2)).rejects.toThrow(/only be applied to a draft/);
    const t3 = makeT();
    await setup(t3);
    await seedTemplate(t3, { id: "tx", org: "org_2", lines: 1 });
    await expect(apply(t3, { templateId: "tx" })).rejects.toThrow(/Template not found/);
    const t4 = makeT();
    await setup(t4, { status: "CANCELLED" });
    await expect(apply(t4)).rejects.toThrow(/Template not found/);
    expect(await lineIds(t4)).toEqual([]);
  });

  test("Undo removes exactly what the apply made and restores the scalars, leaving the draft as it was", async () => {
    const t = makeT();
    await setup(t);
    await apply(t);
    const undone = await undo(t);
    expect(undone.removedLines).toBe(2);
    expect(undone.restored).toMatchObject({ description: null, discountPercent: null, tags: ["mine"] });
    expect(await lineIds(t)).toEqual([]);
    const d = await draft(t);
    expect(d).toMatchObject({ type: "OTHER", name: "Draft" });
    expect(d?.description).toBeUndefined();
    expect(d?.discountPercent).toBeUndefined();
    expect(d?.tags).toEqual(["mine"]);
    const pms = await t.run(async (ctx) => ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "d1")).collect());
    expect(pms).toHaveLength(0);
  });

  test("Undo refuses after a copied line was edited, after an extra line was added, after a scalar changed, twice, and for another user", async () => {
    const edited = makeT();
    await setup(edited);
    await apply(edited);
    await edited.run(async (ctx) => { const l = (await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", "v-d1")).first())!; await ctx.db.patch(l._id, { quantity: 99, updatedAt: NOW + 1 }); });
    await expect(undo(edited)).rejects.toThrow(/gear from the template has been changed/);

    const added = makeT();
    await setup(added);
    await apply(added);
    await added.run(async (ctx) => { await ctx.db.insert("projectLineItems", { versionId: "v-d1", lineageId: "z", id: "z", organizationId: ORG, projectId: "d1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 9, createdAt: NOW, updatedAt: NOW }); });
    await expect(undo(added)).rejects.toThrow(/changed since/);

    const scalar = makeT();
    await setup(scalar);
    await apply(scalar);
    await scalar.run(async (ctx) => { const d = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "d1")).first(); await ctx.db.patch(d!._id, { description: "Edited" }); });
    await expect(undo(scalar)).rejects.toThrow(/description changed since/);
    expect(await lineIds(scalar)).toHaveLength(2);

    const twice = makeT();
    await setup(twice);
    await apply(twice);
    await undo(twice);
    await expect(undo(twice)).rejects.toThrow(/already undone|changed since/);

    const other = makeT();
    await setup(other);
    await apply(other);
    await expect(undo(other, asUser(OTHER), { userId: OTHER, userName: "Bob" })).rejects.toThrow(/Only the person/);
    expect(await lineIds(other)).toHaveLength(2);
  });

  test("Undo refuses outside the window and once the job has left Enquiry", async () => {
    const late = makeT();
    await setup(late);
    await apply(late);
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      await expect(undo(late)).rejects.toThrow(/10 minutes/);
    } finally {
      Date.now = realNow;
    }
    const moved = makeT();
    await setup(moved);
    await apply(moved);
    await moved.run(async (ctx) => { const d = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "d1")).first(); await ctx.db.patch(d!._id, { status: "QUOTING" }); });
    await expect(undo(moved)).rejects.toThrow(/moved on/);
  });
});

describe("projects.listTemplates", () => {
  const list = (t: T, archived?: boolean, who = asUser()) => t.withIdentity(who).query(api.projects.listTemplates, { orgId: ORG, archived });

  test("templates only, newest updated first, with line counts; archived only when asked; org-isolated", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "old", updatedAt: NOW, lines: 1 });
    await seedTemplate(t, { id: "new", updatedAt: NOW + 10, lines: 3 });
    await seedTemplate(t, { id: "gone", status: "CANCELLED", updatedAt: NOW + 20 });
    await seedTemplate(t, { id: "theirs", org: "org_2", updatedAt: NOW + 30 });
    await t.run(async (ctx) => { await ctx.db.insert("projects", { id: "job", organizationId: ORG, projectNumber: "J", name: "Job", status: "ENQUIRY", isTemplate: false, createdAt: NOW, updatedAt: NOW + 40 }); });
    const r = await list(t);
    expect(r.templates.map((x) => [x.id, x.lineCount])).toEqual([["new", 3], ["old", 1]]);
    expect(r.truncated).toBe(false);
    expect((await list(t, true)).templates.map((x) => x.id)).toEqual(["gone"]);
  });

  test("caps AFTER the filter with the true total and truncated", async () => {
    const t = makeT();
    await seedMembers(t);
    for (let i = 0; i < 205; i++) await seedTemplate(t, { id: `t${i}`, updatedAt: NOW + i });
    const r = await list(t);
    expect(r.templates).toHaveLength(200);
    expect(r.total).toBe(205);
    expect(r.truncated).toBe(true);
  });

  test("a caller from another org is refused", async () => {
    const t = makeT();
    await seedMembers(t);
    await expect(list(t, false, asUser("u9", "org_2"))).rejects.toThrow();
  });
});

// ─── restore / unrestore ─────────────────────────────────────────────────────

describe("restoreTemplatesNative / unrestoreTemplatesNative", () => {
  const restore = (t: T, ids: string[], who = asUser()) => t.withIdentity(who).mutation(api.projectTemplateWrites.restoreTemplatesNative, { orgId: ORG, ids, actor: ACTOR, auditId: "res", now: NOW });
  const unrestore = (t: T, items: { id: string; auditId: string }[], who = asUser()) => t.withIdentity(who).mutation(api.projectTemplateWrites.unrestoreTemplatesNative, { orgId: ORG, items, actor: ACTOR, now: NOW });
  const archiveOne = (t: T, ids: string[], auditId = "arc") => t.withIdentity(asUser()).mutation(api.projectTemplateWrites.archiveTemplatesNative, { orgId: ORG, ids, actor: ACTOR, auditId, now: NOW });
  const setRole = (t: T, role: string) => t.run(async (ctx) => {
    for (const m of await ctx.db.query("members").collect()) await ctx.db.patch(m._id, { role });
  });

  test("brings an archived template back to a live Enquiry, and its own Undo archives it again", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a", status: "CANCELLED" });
    const r = await restore(t, ["a"]);
    expect(r.restored.map((x) => x.id)).toEqual(["a"]);
    expect(await status(t, "a")).toBe("ENQUIRY");
    expect(await unrestore(t, r.restored)).toEqual({ restored: ["a"] });
    expect(await status(t, "a")).toBe("CANCELLED");
  });

  test("a live template is skipped; another org's template and a missing id are refused", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "live", status: "ENQUIRY" });
    await seedTemplate(t, { id: "gone", status: "CANCELLED" });
    await seedTemplate(t, { id: "x", org: "org_2", status: "CANCELLED" });
    expect((await restore(t, ["live"])).restored).toEqual([]);
    for (const bad of ["x", "nope"]) await expect(restore(t, ["gone", bad])).rejects.toThrow(/Template not found/);
    expect(await status(t, "gone")).toBe("CANCELLED");
    expect(await status(t, "x")).toBe("CANCELLED");
  });

  test("needs project:delete, like archive: a manager (create/update only) is refused for archive, restore and both Undos", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    await seedTemplate(t, { id: "b", status: "CANCELLED" });
    const arc = await archiveOne(t, ["a"]);
    const res = await restore(t, ["b"]);
    await setRole(t, "manager");
    await expect(archiveOne(t, ["b"], "arc2")).rejects.toThrow();
    await expect(restore(t, ["a"])).rejects.toThrow();
    await expect(t.withIdentity(asUser()).mutation(api.projectTemplateWrites.unarchiveTemplatesNative, { orgId: ORG, items: arc.archived, actor: ACTOR, now: NOW })).rejects.toThrow();
    await expect(unrestore(t, res.restored)).rejects.toThrow();
    expect(await status(t, "a")).toBe("CANCELLED");
    expect(await status(t, "b")).toBe("ENQUIRY");
  });

  test("the generic Undo helper refuses an audit id for another template, another entity type and another org", async () => {
    const t = makeT();
    await seedMembers(t);
    await seedTemplate(t, { id: "a" });
    await seedTemplate(t, { id: "b" });
    const r = await archiveOne(t, ["a", "b"]);
    const [aItem, bItem] = r.archived;
    const undoItems = (items: { id: string; auditId: string }[]) => t.withIdentity(asUser()).mutation(api.projectTemplateWrites.unarchiveTemplatesNative, { orgId: ORG, items, actor: ACTOR, now: NOW });
    const patchRow = (p: { entityType?: string; organizationId?: string }) => t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", aItem.auditId)).first();
      await ctx.db.patch(row!._id, p);
    });
    // entityId: a's audit row presented for b.
    await expect(undoItems([{ id: bItem.id, auditId: aItem.auditId }])).rejects.toThrow(/not found/);
    await patchRow({ entityType: "asset" });
    await expect(undoItems([aItem])).rejects.toThrow(/not found/);
    await patchRow({ entityType: "project", organizationId: "org_2" });
    await expect(undoItems([aItem])).rejects.toThrow(/not found/);
    expect(await status(t, "a")).toBe("CANCELLED");
  });
});

// ─── the apply Undo's guards ─────────────────────────────────────────────────

describe("undoApplyTemplateNative guards", () => {
  const apply = (t: T) => t.withIdentity(asUser()).mutation(api.projectTemplateWrites.applyTemplateNative, { orgId: ORG, draftId: "d1", templateId: "t1", actor: ACTOR, auditId: "ap1", now: NOW });
  const undo = (t: T, over: Partial<{ projectId: string; orgId: string }> = {}, who = asUser()) =>
    t.withIdentity(who).mutation(api.projectTemplateWrites.undoApplyTemplateNative, { orgId: ORG, projectId: "d1", applyAuditId: "ap1", actor: ACTOR, now: NOW + 5, ...over });
  const lineCount = (t: T) => t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", "v-d1")).collect()).length);
  const patchAudit = (t: T, p: { entityType?: string; organizationId?: string }) => t.run(async (ctx) => {
    const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "ap1")).first();
    await ctx.db.patch(row!._id, p);
  });

  async function setup(t: T) {
    await seedMembers(t);
    await seedTemplate(t, { id: "t1", lines: 2, discountPercent: 5 });
    await seedDraft(t);
    await apply(t);
  }

  test("an audit id from another project is refused", async () => {
    const t = makeT();
    await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "d2", organizationId: ORG, projectNumber: "P-2", name: "Other", status: "ENQUIRY", isTemplate: false, liveVersionId: "v-d2", createdAt: NOW, updatedAt: NOW, tags: [] });
      await ctx.db.insert("projectVersions", { id: "v-d2", organizationId: ORG, projectId: "d2", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    });
    await expect(undo(t, { projectId: "d2" })).rejects.toThrow(/not found/);
    expect(await lineCount(t)).toBe(2);
  });

  test("an audit row of another entity type or another org is refused", async () => {
    const t = makeT();
    await setup(t);
    await patchAudit(t, { entityType: "asset" });
    await expect(undo(t)).rejects.toThrow(/not found/);
    await patchAudit(t, { entityType: "project", organizationId: "org_2" });
    await expect(undo(t)).rejects.toThrow(/not found/);
    expect(await lineCount(t)).toBe(2);
  });

  test("another org's caller cannot undo it", async () => {
    const t = makeT();
    await setup(t);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m9", organizationId: "org_2", userId: USER, role: "owner" }); });
    await expect(undo(t, { orgId: "org_2" }, { subject: USER, orgId: "org_2" })).rejects.toThrow();
    expect(await lineCount(t)).toBe(2);
  });

  test("needs project:update", async () => {
    const t = makeT();
    await setup(t);
    await t.run(async (ctx) => { for (const m of await ctx.db.query("members").collect()) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(undo(t)).rejects.toThrow();
    expect(await lineCount(t)).toBe(2);
  });

  test("writes a once-only marker row that carries the undone audit id", async () => {
    const t = makeT();
    await setup(t);
    await undo(t);
    const marker = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "undo:ap1")).first());
    expect(marker).toMatchObject({ organizationId: ORG, entityType: "project", entityId: "d1", details: { undoOf: "ap1" } });
    // With the gear put back exactly as the apply left it, only the marker stops a replay.
    await t.run(async (ctx) => {
      const audit = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "ap1")).first();
      const ta = (audit!.details as { templateApply: { copied: { lines: string[] }; copiedAt: number } }).templateApply;
      for (let i = 0; i < ta.copied.lines.length; i++) {
        const id = ta.copied.lines[i];
        await ctx.db.insert("projectLineItems", { versionId: "v-d1", lineageId: id, id, organizationId: ORG, projectId: "d1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: i, createdAt: NOW, updatedAt: ta.copiedAt });
      }
    });
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("recalculates the draft's stored totals after removing the gear", async () => {
    const t = makeT();
    await setup(t);
    const subtotal = () => t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "d1")).first())?.subtotal ?? 0);
    // Stored totals as an apply followed by a recalc would leave them.
    await t.run(async (ctx) => { const d = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "d1")).first(); await ctx.db.patch(d!._id, { subtotal: 400, total: 400 }); });
    expect(await subtotal()).toBe(400);
    await undo(t);
    expect(await subtotal()).toBe(0);
  });

  test("never deletes a manager row of another organization, even if the audit lists its id", async () => {
    const t = makeT();
    await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "foreign-pm", organizationId: "org_2", projectId: "d1", userId: OTHER, addedAt: NOW });
      const audit = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "ap1")).first();
      const d = audit!.details as { templateApply: { copied: { managers: string[] } } };
      await ctx.db.patch(audit!._id, { details: { ...d, templateApply: { ...d.templateApply, copied: { ...d.templateApply.copied, managers: [...d.templateApply.copied.managers, "foreign-pm"] } } } });
    });
    await undo(t);
    const left = await t.run(async (ctx) => ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "d1")).collect());
    expect(left.map((m) => m.id)).toEqual(["foreign-pm"]);
  });
});
