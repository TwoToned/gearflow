// @vitest-environment node
// UX Phase 8 (§7b, D21) — seal/unseal, the seal guard on plan writes, the
// exact bulk-plan Undo, and the plan write's packed/other-job skip rules.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };
const V1 = "v-p1";

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const lineById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const containerById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", id)).unique());

/** One project, three CUSTOM cases (c1..c3) and plannable lines li1..li3. */
async function seed(t: T, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${orgId}`, organizationId: orgId, userId: USER, role: "member" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P-1", name: "Test",
      total: 0, liveVersionId: V1, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", { id: V1, organizationId: orgId, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    for (const id of ["li1", "li2", "li3"]) {
      await ctx.db.insert("projectLineItems", {
        id, organizationId: orgId, projectId: "p1", versionId: V1, lineageId: id,
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
    }
  });
  for (const [i, id] of ["c1", "c2", "c3"].entries()) {
    await t.withIdentity(asUser(orgId)).mutation(api.projectContainersWrites.createNative, {
      id, orgId, projectId: "p1", kind: "CUSTOM", label: `Case ${i + 1}`, now: NOW, actor: ACTOR, auditId: `a-${id}`,
    });
  }
}

const plan = (t: T, lineItemIds: string[], containerId: string | null, auditId: string, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).mutation(api.projectContainersWrites.setPlannedContainerNative, {
    orgId, lineItemIds, containerId, now: NOW, actor: ACTOR, auditId,
  });
const seal = (t: T, id: string, auditId: string, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).mutation(api.projectContainerPlanWrites.sealNative, { id, orgId, now: NOW, actor: ACTOR, auditId });
const unseal = (t: T, id: string, auditId: string, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).mutation(api.projectContainerPlanWrites.unsealNative, { id, orgId, now: NOW, actor: ACTOR, auditId });

describe("seal / unseal", () => {
  test("seal sets sealedAt, is idempotent, and unseal clears it with its own audit row", async () => {
    const t = makeT();
    await seed(t);
    expect(await seal(t, "c1", "s1")).toEqual({ ok: true, changed: true });
    expect((await containerById(t, "c1"))?.sealedAt).toBe(NOW);
    expect(await seal(t, "c1", "s2")).toEqual({ ok: true, changed: false });
    expect(await unseal(t, "c1", "u1")).toEqual({ ok: true, changed: true });
    expect((await containerById(t, "c1"))?.sealedAt).toBeUndefined();
    expect(await unseal(t, "c1", "u2")).toEqual({ ok: true, changed: false });
    const log = (id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    expect(await log("s1")).toMatchObject({ summary: 'Sealed case "Case 1"' });
    expect(await log("u1")).toMatchObject({ summary: 'Unsealed case "Case 1"' });
    expect(await log("s2")).toBeNull(); // idempotent no-op writes nothing
  });

  test("a foreign org cannot seal or unseal (NOT_FOUND)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m-other", organizationId: OTHER, userId: USER, role: "member" });
    });
    await expect(seal(t, "c1", "x1", OTHER)).rejects.toThrow(/not found/i);
    await expect(unseal(t, "c1", "x2", OTHER)).rejects.toThrow(/not found/i);
    expect((await containerById(t, "c1"))?.sealedAt).toBeUndefined();
  });
});

describe("seal guard on plan writes", () => {
  test("rejects planning a line INTO a sealed case; allowed again after unseal", async () => {
    const t = makeT();
    await seed(t);
    await seal(t, "c1", "s1");
    await expect(plan(t, ["li1"], "c1", "p1")).rejects.toThrow(/sealed/i);
    expect((await lineById(t, "li1"))?.plannedContainerId).toBeUndefined();
    await unseal(t, "c1", "u1");
    await expect(plan(t, ["li1"], "c1", "p2")).resolves.toMatchObject({ updated: 1 });
  });

  test("rejects planning a line OUT of a sealed case, to another case or to Unplanned, atomically", async () => {
    const t = makeT();
    await seed(t);
    await plan(t, ["li1"], "c1", "p1");
    await plan(t, ["li2"], "c2", "p2");
    await seal(t, "c1", "s1");
    await expect(plan(t, ["li1"], "c2", "p3")).rejects.toThrow(/sealed/i);
    await expect(plan(t, ["li1"], null, "p4")).rejects.toThrow(/sealed/i);
    // A batch containing one sealed-source line applies NOTHING (li2 stays put).
    await expect(plan(t, ["li2", "li1"], "c3", "p5")).rejects.toThrow(/sealed/i);
    expect((await lineById(t, "li1"))?.plannedContainerId).toBe("c1");
    expect((await lineById(t, "li2"))?.plannedContainerId).toBe("c2");
  });

  test("a line moves freely between open cases", async () => {
    const t = makeT();
    await seed(t);
    await plan(t, ["li1"], "c1", "p1");
    const r = await plan(t, ["li1"], "c2", "p2");
    expect(r.changes).toEqual([{ lineItemId: "li1", from: "c1" }]);
  });
});

const update = (t: T, id: string, patch: Record<string, unknown>, auditId: string) =>
  t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.updateNative, {
    id, orgId: ORG, now: NOW, actor: ACTOR, auditId, ...patch,
  } as never);
const remove = (t: T, id: string, auditId: string) =>
  t.withIdentity(asUser(ORG)).mutation(api.projectContainersWrites.deleteNative, { id, orgId: ORG, now: NOW, actor: ACTOR, auditId });

describe("seal guard on case structure writes (Q3)", () => {
  test("rename of a sealed case is rejected; allowed after unseal", async () => {
    const t = makeT();
    await seed(t);
    await seal(t, "c1", "s1");
    await expect(update(t, "c1", { label: "Renamed" }, "r1")).rejects.toThrow(/sealed/i);
    expect((await containerById(t, "c1"))?.label).toBe("Case 1");
    await unseal(t, "c1", "u1");
    await expect(update(t, "c1", { label: "Renamed" }, "r2")).resolves.toEqual({ ok: true });
  });

  test("re-nesting a sealed case (into a parent, or out to the top level) is rejected", async () => {
    const t = makeT();
    await seed(t);
    await seal(t, "c1", "s1");
    await expect(update(t, "c1", { parentContainerId: "c2" }, "n1")).rejects.toThrow(/sealed/i);
    expect((await containerById(t, "c1"))?.parentContainerId).toBeUndefined();
    await unseal(t, "c1", "u1");
    await update(t, "c1", { parentContainerId: "c2" }, "n2");
    await seal(t, "c1", "s2");
    await expect(update(t, "c1", { parentContainerId: null }, "n3")).rejects.toThrow(/sealed/i);
    expect((await containerById(t, "c1"))?.parentContainerId).toBe("c2");
  });

  test("a description-only edit and an unchanged label still go through on a sealed case", async () => {
    const t = makeT();
    await seed(t);
    await seal(t, "c1", "s1");
    await expect(update(t, "c1", { description: "Fragile" }, "d1")).resolves.toEqual({ ok: true });
    await expect(update(t, "c1", { label: "Case 1" }, "d2")).resolves.toEqual({ ok: true });
  });

  test("deleting a sealed case is rejected; allowed after unseal", async () => {
    const t = makeT();
    await seed(t);
    await seal(t, "c1", "s1");
    await expect(remove(t, "c1", "x1")).rejects.toThrow(/sealed/i);
    expect(await containerById(t, "c1")).not.toBeNull();
    await unseal(t, "c1", "u1");
    await expect(remove(t, "c1", "x2")).resolves.toEqual({ ok: true });
    expect(await containerById(t, "c1")).toBeNull();
  });
});

describe("plan write: changes, skips", () => {
  test("returns each line's previous case, treats a re-plan into the same case as a no-op", async () => {
    const t = makeT();
    await seed(t);
    await plan(t, ["li1"], "c1", "p1");
    const r = await plan(t, ["li1", "li2", "li3"], "c1", "p2");
    expect(r.updated).toBe(2);
    expect(r.changes).toEqual([{ lineItemId: "li2", from: null }, { lineItemId: "li3", from: null }]);
  });

  test("skips a line with a packed unit (packed wins) and reports it", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 1, containerId: "c3", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
      } as never);
    });
    const r = await plan(t, ["li1", "li2"], "c1", "p1");
    expect(r.skipped).toEqual([{ lineItemId: "li1", reason: "PACKED" }]);
    expect(r.updated).toBe(1);
    expect((await lineById(t, "li1"))?.plannedContainerId).toBeUndefined();
  });

  test("skips a line that belongs to another job (same-org, different project)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "foreign", organizationId: ORG, projectId: "p2", versionId: "v-p2", lineageId: "foreign",
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
    });
    const r = await plan(t, ["foreign"], "c1", "p1");
    expect(r.skipped).toEqual([{ lineItemId: "foreign", reason: "OTHER_JOB" }]);
    expect((await lineById(t, "foreign"))?.plannedContainerId).toBeUndefined();
  });

  test("a line in another org is ignored, never moved", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "alien", organizationId: OTHER, projectId: "px", versionId: "vx", lineageId: "alien",
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
    });
    const r = await plan(t, ["alien"], "c1", "p1");
    expect(r).toMatchObject({ updated: 0, changes: [], skipped: [] });
    expect((await lineById(t, "alien"))?.plannedContainerId).toBeUndefined();
  });
});

describe("restorePlannedContainersNative", () => {
  const restore = (t: T, expectedContainerId: string | null, entries: { lineItemId: string; from: string | null }[], auditId: string) =>
    t.withIdentity(asUser(ORG)).mutation(api.projectContainerPlanWrites.restorePlannedContainersNative, {
      orgId: ORG, expectedContainerId, entries, now: NOW, actor: ACTOR, auditId,
    });

  test("undoes a mixed-source bulk move line by line", async () => {
    const t = makeT();
    await seed(t);
    await plan(t, ["li1"], "c1", "p1");
    await plan(t, ["li2"], "c2", "p2");
    const fwd = await plan(t, ["li1", "li2", "li3"], "c3", "p3");
    const r = await restore(t, "c3", fwd.changes, "r1");
    expect(r).toEqual({ restored: 3, skipped: 0 });
    expect((await lineById(t, "li1"))?.plannedContainerId).toBe("c1");
    expect((await lineById(t, "li2"))?.plannedContainerId).toBe("c2");
    expect((await lineById(t, "li3"))?.plannedContainerId).toBeUndefined();
  });

  test("leaves a line alone that someone changed since (exact, never clobbers)", async () => {
    const t = makeT();
    await seed(t);
    const fwd = await plan(t, ["li1", "li2"], "c1", "p1");
    await plan(t, ["li2"], "c2", "p2"); // a later edit
    const r = await restore(t, "c1", fwd.changes, "r1");
    expect(r).toEqual({ restored: 1, skipped: 1 });
    expect((await lineById(t, "li2"))?.plannedContainerId).toBe("c2");
  });

  test("is not a way around a seal (leaving or returning to a sealed case)", async () => {
    const t = makeT();
    await seed(t);
    await plan(t, ["li1"], "c1", "p1");
    const fwd = await plan(t, ["li1"], "c2", "p2");
    await seal(t, "c1", "s1"); // the case it would return to
    expect(await restore(t, "c2", fwd.changes, "r1")).toEqual({ restored: 0, skipped: 1 });
    await unseal(t, "c1", "u1");
    await seal(t, "c2", "s2"); // the case it would leave
    expect(await restore(t, "c2", fwd.changes, "r2")).toEqual({ restored: 0, skipped: 1 });
    expect((await lineById(t, "li1"))?.plannedContainerId).toBe("c2");
  });

  test("a foreign org's lines are never restored", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "alien", organizationId: OTHER, projectId: "px", versionId: "vx", lineageId: "alien", plannedContainerId: "c1",
        type: "EQUIPMENT", quantity: 1, sortOrder: 5, createdAt: NOW, updatedAt: NOW,
      });
    });
    const r = await restore(t, "c1", [{ lineItemId: "alien", from: null }], "r1");
    expect(r.restored).toBe(0);
    expect((await lineById(t, "alien"))?.plannedContainerId).toBe("c1");
  });
});
