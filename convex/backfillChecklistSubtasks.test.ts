// @vitest-environment node
//
// #1243 Phase 1 backfill (convex/backfillChecklistSubtasks.ts). Verifies: a parent
// with a non-empty checklist gets one child (subtask) projectTasks row per item,
// status derived from `done`, sortOrder preserves checklist order; a checklist item
// with no text is skipped; an absent/empty checklist gets no subtasks; idempotent
// re-runs create nothing new; a parent that already has a subtask is left alone;
// dry-run writes nothing; the parent's own checklist field is left untouched
// (expand-contract — dropped in a separate follow-up release).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  for (;;) {
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillChecklistSubtasks.backfillChecklistSubtasksPage, { cursor, apply });
    scanned += r.scanned;
    created += r.created;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, created };
}

const subtasksFor = (t: T, parentId: string) =>
  t.run(async (ctx) => ctx.db.query("projectTasks").withIndex("by_parentId", (q) => q.eq("parentId", parentId)).collect());

describe("backfillChecklistSubtasks", () => {
  test("non-empty checklist → one subtask per item, status from done, sortOrder preserves order, id preserved", async () => {
    const t = makeT();
    const parentUpdatedAt = 1_700_000_000_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", {
        id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in", updatedAt: parentUpdatedAt,
        checklist: [{ id: "c1", text: "Load truck", done: true }, { id: "c2", text: "Unload dock", done: false }],
      });
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(created).toBe(2);
    const subtasks = (await subtasksFor(t, "p1")).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(subtasks.map((s) => [s.id, s.title, s.status, s.sortOrder])).toEqual([
      ["c1", "Load truck", "DONE", 0],
      ["c2", "Unload dock", "TODO", 1],
    ]);
    expect(subtasks.every((s) => s.organizationId === ORG && s.projectId === "proj1" && s.parentId === "p1")).toBe(true);
    // completedAt for an already-done item is the parent's own updatedAt, not migration time.
    expect(subtasks.find((s) => s.status === "DONE")?.completedAt).toBe(parentUpdatedAt);
    expect(subtasks.find((s) => s.status === "TODO")?.completedAt).toBeUndefined();
  });

  test("falls back to a fresh id when the checklist item's id is missing or already taken", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      // "taken" already exists as an unrelated row's id — the migrated item can't reuse it.
      await ctx.db.insert("projectTasks", { id: "taken", organizationId: ORG, projectId: "proj1", title: "Unrelated" });
      await ctx.db.insert("projectTasks", {
        id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in",
        checklist: [{ text: "No id at all", done: false }, { id: "taken", text: "Id collision", done: false }],
      });
    });
    await runBackfill(t);
    const subtasks = await subtasksFor(t, "p1");
    expect(subtasks).toHaveLength(2);
    for (const s of subtasks) {
      expect(s.id).not.toBe("taken");
      expect(s.id.length).toBeGreaterThan(0);
    }
  });

  test("a checklist item with no text is skipped", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", {
        id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in",
        checklist: [{ id: "c1", text: "  ", done: false }, { id: "c2", text: "Real item", done: false }],
      });
    });
    const { created } = await runBackfill(t);
    expect(created).toBe(1);
    const subtasks = await subtasksFor(t, "p1");
    expect(subtasks.map((s) => s.title)).toEqual(["Real item"]);
  });

  test("absent or empty checklist → no subtasks", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "p1", organizationId: ORG, projectId: "proj1", title: "No checklist" });
      await ctx.db.insert("projectTasks", { id: "p2", organizationId: ORG, projectId: "proj1", title: "Empty checklist", checklist: [] });
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(created).toBe(0);
    expect(await subtasksFor(t, "p1")).toHaveLength(0);
    expect(await subtasksFor(t, "p2")).toHaveLength(0);
  });

  test("idempotent — re-running creates nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in", checklist: [{ id: "c1", text: "Step 1", done: false }] });
    });
    expect((await runBackfill(t)).created).toBe(1);
    expect((await runBackfill(t)).created).toBe(0);
    expect(await subtasksFor(t, "p1")).toHaveLength(1);
  });

  test("a parent that already has a subtask is left alone (even with checklist still present)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in", checklist: [{ id: "c1", text: "Step 1", done: false }] });
      await ctx.db.insert("projectTasks", { id: "existing_child", organizationId: ORG, projectId: "proj1", title: "Manually added subtask", parentId: "p1" });
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(created).toBe(0);
    const subtasks = await subtasksFor(t, "p1");
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].title).toBe("Manually added subtask");
  });

  test("dry-run scans but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in", checklist: [{ id: "c1", text: "Step 1", done: false }] });
    });
    const { scanned, created } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(created).toBe(0);
    expect(await subtasksFor(t, "p1")).toHaveLength(0);
  });

  test("the parent's checklist field is left untouched (expand-contract — dropped separately)", async () => {
    const t = makeT();
    const checklist = [{ id: "c1", text: "Step 1", done: true }];
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "p1", organizationId: ORG, projectId: "proj1", title: "Load in", checklist });
    });
    await runBackfill(t);
    const parent = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "p1")).unique());
    expect(parent?.checklist).toEqual(checklist);
  });
});
