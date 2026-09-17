// @vitest-environment node
//
// #1243 Phase 1 — additive `work` RBAC resource. Task reads/writes must accept
// EITHER `work:*` or `project:*` scope: apiKeys.scopes is a frozen stored
// string never re-validated after mint/OAuth-consent, so an already-issued key
// that only ever knew about `project:*` must keep authorising task operations
// after `work` is introduced. This is the issue's explicit non-negotiable
// test: "Every issued API key still authorises task operations."
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const KEY = "key_1";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: USER, userName: "Alice" };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T, scopes: string[]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("apiKeys", {
      id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
      scopes: JSON.stringify(scopes), isActive: true, actingUserId: USER, createdById: USER,
    });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectTasks", {
      id: "t1", organizationId: ORG, projectId: "p1", title: "A task", status: "TODO", sortOrder: 1, createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("projectTasks reads accept an old project:read-only key OR a work:read key", () => {
  test("a key scoped only to project:read still authorises listByProject", async () => {
    const t = makeT(); await seed(t, ["project:read"]);
    const rows = await t.withIdentity(asAgent).query(api.projectTasks.listByProject, { projectId: "p1", orgId: ORG });
    expect(rows.map((r) => r.id)).toEqual(["t1"]);
  });

  test("a key scoped only to work:read also authorises listByProject", async () => {
    const t = makeT(); await seed(t, ["work:read"]);
    const rows = await t.withIdentity(asAgent).query(api.projectTasks.listByProject, { projectId: "p1", orgId: ORG });
    expect(rows.map((r) => r.id)).toEqual(["t1"]);
  });

  test("a key scoped only to project:read still authorises getById", async () => {
    const t = makeT(); await seed(t, ["project:read"]);
    const doc = await t.withIdentity(asAgent).query(api.projectTasks.getById, { id: "t1" });
    expect(doc?.id).toBe("t1");
  });

  test("a key with neither work nor project scope is rejected, surfacing the project scope as the actionable gap", async () => {
    const t = makeT(); await seed(t, ["asset:read"]);
    await expect(
      t.withIdentity(asAgent).query(api.projectTasks.listByProject, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/missing the 'project:read' scope/i);
  });
});

describe("projectTasksWrites.createNative accepts an old project:update-only key OR a work:update key", () => {
  test("a key scoped only to project:update still authorises createNative", async () => {
    const t = makeT(); await seed(t, ["project:update"]);
    await t.withIdentity(asAgent).mutation(api.projectTasksWrites.createNative, {
      id: "t2", projectId: "p1", orgId: ORG, title: "New", now: NOW, actor: ACTOR, auditId: "a1",
    });
    const doc = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t2")).unique());
    expect(doc?.title).toBe("New");
  });

  test("a key scoped only to work:update also authorises createNative", async () => {
    const t = makeT(); await seed(t, ["work:update"]);
    await t.withIdentity(asAgent).mutation(api.projectTasksWrites.createNative, {
      id: "t2", projectId: "p1", orgId: ORG, title: "New", now: NOW, actor: ACTOR, auditId: "a1",
    });
    const doc = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t2")).unique());
    expect(doc?.title).toBe("New");
  });

  test("a key with neither scope is rejected", async () => {
    const t = makeT(); await seed(t, ["asset:read"]);
    await expect(
      t.withIdentity(asAgent).mutation(api.projectTasksWrites.createNative, {
        id: "t2", projectId: "p1", orgId: ORG, title: "New", now: NOW, actor: ACTOR, auditId: "a1",
      }),
    ).rejects.toThrow(/missing the 'project:update' scope/i);
  });
});
