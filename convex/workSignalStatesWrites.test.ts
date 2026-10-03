// @vitest-environment node
//
// convex/workSignalStatesWrites.ts — browser-direct USER-scoped writes for a
// human's decision about a derived Triage signal (#1243 Phase 1, design doc
// §9/§10.3). Verifies: snooze/dismiss upsert idempotently (one row per
// (org, user, sourceKey)), promote creates a real projectTasks row AND the
// `promoted` decision in one transaction, the assignee defaults to the
// promoting user unless overridden, cross-org/cross-user isolation, and the
// user↔crew XOR guard on promote.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const OTHER_USER = "user_2";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.co" });
    await ctx.db.insert("users", { id: OTHER_USER, name: "Bob", email: "b@x.co" });
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: OTHER_USER, role: "member" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Cara", lastName: "Crew", status: "ACTIVE" });
    await ctx.db.insert("projects", { id: "P1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
  });
}

const stateFor = (t: T, orgId: string, userId: string, sourceKey: string) =>
  t.run((ctx) =>
    ctx.db
      .query("workSignalStates")
      .withIndex("by_organizationId_userId_sourceKey", (q) => q.eq("organizationId", orgId).eq("userId", userId).eq("sourceKey", sourceKey))
      .first(),
  );

describe("snoozeSignalNative", () => {
  test("creates a snoozed row scoped to the caller's own org/user", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "quote:expiring:q1", snoozedUntil: NOW + 86_400_000, now: NOW,
    });
    const row = await stateFor(t, ORG, USER, "quote:expiring:q1");
    expect(row?.state).toBe("snoozed");
    expect(row?.snoozedUntil).toBe(NOW + 86_400_000);
  });

  test("re-snoozing the same sourceKey upserts (one row, updated snoozedUntil)", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "quote:expiring:q1", snoozedUntil: NOW + 1000, now: NOW,
    });
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "quote:expiring:q1", snoozedUntil: NOW + 2000, now: NOW + 1,
    });
    const rows = await t.run((ctx) => ctx.db.query("workSignalStates").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].snoozedUntil).toBe(NOW + 2000);
  });

  test("two different users snoozing the same signal each get their own row", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "quote:expiring:q1", snoozedUntil: NOW + 1000, now: NOW,
    });
    await t.withIdentity({ subject: OTHER_USER, orgId: ORG }).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "quote:expiring:q1", snoozedUntil: NOW + 2000, now: NOW,
    });
    expect(await stateFor(t, ORG, USER, "quote:expiring:q1")).toMatchObject({ snoozedUntil: NOW + 1000 });
    expect(await stateFor(t, ORG, OTHER_USER, "quote:expiring:q1")).toMatchObject({ snoozedUntil: NOW + 2000 });
  });

  test("the same sourceKey in a different org is a separate row", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "quote:expiring:q1", snoozedUntil: NOW + 1000, now: NOW,
    });
    expect(await stateFor(t, OTHER_ORG, USER, "quote:expiring:q1")).toBeNull();
  });
});

describe("dismissSignalNative", () => {
  test("dismisses a signal, clearing any prior snoozedUntil", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.snoozeSignalNative, {
      sourceKey: "crew:declined:ca1", snoozedUntil: NOW + 1000, now: NOW,
    });
    await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.dismissSignalNative, {
      sourceKey: "crew:declined:ca1", now: NOW + 1,
    });
    const row = await stateFor(t, ORG, USER, "crew:declined:ca1");
    expect(row?.state).toBe("dismissed");
    expect(row?.snoozedUntil).toBeUndefined();
  });
});

describe("promoteSignalNative", () => {
  test("creates a real task and records the promoted decision, defaulting the assignee to self", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.promoteSignalNative, {
      sourceKey: "quote:expiring:q1", title: "Follow up on quote", projectId: "P1", now: NOW, actor, auditId: "a1",
    });
    const task = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", res.id)).unique());
    expect(task).toMatchObject({
      organizationId: ORG, projectId: "P1", title: "Follow up on quote",
      status: "TODO", sourceKey: "quote:expiring:q1", assigneeUserId: USER,
    });
    const signal = await stateFor(t, ORG, USER, "quote:expiring:q1");
    expect(signal?.state).toBe("promoted");
    expect(signal?.promotedWorkItemId).toBe(res.id);
    const audit = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(audit?.entityType).toBe("ProjectTask");
  });

  test("an explicit crew assignee overrides the self-default and clears assigneeUserId", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.promoteSignalNative, {
      sourceKey: "crew:declined:ca1", title: "Find cover", assigneeCrewId: "c1", now: NOW, actor, auditId: "a1",
    });
    const task = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", res.id)).unique());
    expect(task?.assigneeCrewId).toBe("c1");
    expect(task?.assigneeUserId).toBeUndefined();
  });

  test("promoting without a project creates a personal task", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.promoteSignalNative, {
      sourceKey: "mention:c1:u1", title: "Reply to Tom", now: NOW, actor, auditId: "a1",
    });
    const task = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", res.id)).unique());
    expect(task?.projectId).toBeUndefined();
  });

  test("rejects a project from another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "PX", organizationId: OTHER_ORG, projectNumber: "PX", name: "Foreign", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.workSignalStatesWrites.promoteSignalNative, {
        sourceKey: "quote:expiring:q1", title: "X", projectId: "PX", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Project not found/i);
  });

  test("re-promoting the same sourceKey overwrites the promotedWorkItemId (last write wins)", async () => {
    const t = makeT(); await seed(t);
    const first = await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.promoteSignalNative, {
      sourceKey: "quote:expiring:q1", title: "First", now: NOW, actor, auditId: "a1",
    });
    const second = await t.withIdentity(asUser).mutation(api.workSignalStatesWrites.promoteSignalNative, {
      sourceKey: "quote:expiring:q1", title: "Second", now: NOW + 1, actor, auditId: "a2",
    });
    expect(first.id).not.toBe(second.id);
    const signal = await stateFor(t, ORG, USER, "quote:expiring:q1");
    expect(signal?.promotedWorkItemId).toBe(second.id);
  });
});
