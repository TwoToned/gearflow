// @vitest-environment node
//
// #1243 Phase 1 schema widening — projectTasks' new optional fields (kind,
// stage, parentId, scheduling, sourceKey, etc.) and the new workSignalStates
// table. No operations exist yet for workSignalStates (wired in a later
// Phase 1 slice, once Today gains snooze/promote-a-signal) — this pins the
// table's shape and indexes directly via ctx.db so the schema doesn't drift
// silently ahead of its first consumer.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;

function makeT(): T {
  return convexTest(schema, modules);
}

describe("projectTasks Phase 1 schema widening", () => {
  test("projectId is optional — a task can be created with no project", async () => {
    const t = makeT();
    const id = await t.run((ctx) =>
      ctx.db.insert("projectTasks", {
        id: "t1", organizationId: ORG, title: "Personal follow-up",
        kind: "follow_up", createdAt: NOW, updatedAt: NOW,
      }),
    );
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc?.projectId).toBeUndefined();
    expect(doc?.kind).toBe("follow_up");
  });

  test("a subtask carries parentId and is findable via by_parentId", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "parent", organizationId: ORG, title: "Parent", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "child", organizationId: ORG, title: "Child", parentId: "parent", createdAt: NOW, updatedAt: NOW });
    });
    const children = await t.run((ctx) =>
      ctx.db.query("projectTasks").withIndex("by_parentId", (q) => q.eq("parentId", "parent")).collect(),
    );
    expect(children.map((c) => c.id)).toEqual(["child"]);
  });

  test("stage, scheduling and sourceKey fields round-trip", async () => {
    const t = makeT();
    await t.run((ctx) =>
      ctx.db.insert("projectTasks", {
        id: "t1", organizationId: ORG, title: "Prep gear", stage: "prep",
        startDate: NOW, dueTime: "14:30", scheduledStart: NOW, scheduledEnd: NOW + 3_600_000,
        snoozedUntil: NOW + 86_400_000, estimateMinutes: 45, tags: ["urgent"],
        sourceKey: "quote:expiring:q1", isPrivate: true, templateId: "tmpl1",
        createdAt: NOW, updatedAt: NOW,
      }),
    );
    const doc = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t1")).unique());
    expect(doc).toMatchObject({
      stage: "prep", startDate: NOW, dueTime: "14:30", scheduledStart: NOW, scheduledEnd: NOW + 3_600_000,
      snoozedUntil: NOW + 86_400_000, estimateMinutes: 45, tags: ["urgent"],
      sourceKey: "quote:expiring:q1", isPrivate: true, templateId: "tmpl1",
    });
  });

  test("by_organizationId_assigneeUserId_status is org-prefixed, not a global scan", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "mine", organizationId: ORG, title: "A", assigneeUserId: USER, status: "TODO", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "theirs", organizationId: "org_2", title: "B", assigneeUserId: USER, status: "TODO", createdAt: NOW, updatedAt: NOW });
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("projectTasks")
        .withIndex("by_organizationId_assigneeUserId_status", (q) =>
          q.eq("organizationId", ORG).eq("assigneeUserId", USER).eq("status", "TODO"),
        )
        .collect(),
    );
    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });
});

describe("workSignalStates table", () => {
  test("stores a per-user decision about a derived signal, keyed by sourceKey", async () => {
    const t = makeT();
    await t.run((ctx) =>
      ctx.db.insert("workSignalStates", {
        id: "ws1", organizationId: ORG, userId: USER, sourceKey: "quote:expiring:q1",
        state: "snoozed", snoozedUntil: NOW + 86_400_000, createdAt: NOW, updatedAt: NOW,
      }),
    );
    const doc = await t.run((ctx) => ctx.db.query("workSignalStates").withIndex("by_cuid", (q) => q.eq("id", "ws1")).unique());
    expect(doc?.state).toBe("snoozed");
  });

  test("by_organizationId_userId_sourceKey scopes one user's decision without leaking another's", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("workSignalStates", { id: "ws1", organizationId: ORG, userId: USER, sourceKey: "quote:expiring:q1", state: "dismissed", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("workSignalStates", { id: "ws2", organizationId: ORG, userId: "user_2", sourceKey: "quote:expiring:q1", state: "snoozed", snoozedUntil: NOW + 1000, createdAt: NOW, updatedAt: NOW });
    });
    const mine = await t.run((ctx) =>
      ctx.db
        .query("workSignalStates")
        .withIndex("by_organizationId_userId_sourceKey", (q) =>
          q.eq("organizationId", ORG).eq("userId", USER).eq("sourceKey", "quote:expiring:q1"),
        )
        .collect(),
    );
    expect(mine.map((r) => r.id)).toEqual(["ws1"]);
  });

  test("promoted state carries the resulting projectTasks id", async () => {
    const t = makeT();
    await t.run((ctx) =>
      ctx.db.insert("workSignalStates", {
        id: "ws1", organizationId: ORG, userId: USER, sourceKey: "quote:expiring:q1",
        state: "promoted", promotedWorkItemId: "t99", createdAt: NOW, updatedAt: NOW,
      }),
    );
    const doc = await t.run((ctx) => ctx.db.query("workSignalStates").withIndex("by_cuid", (q) => q.eq("id", "ws1")).unique());
    expect(doc?.promotedWorkItemId).toBe("t99");
  });
});
