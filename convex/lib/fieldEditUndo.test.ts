// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect, afterEach, vi } from "vitest";
import schema from "../schema";
import type { MutationCtx } from "../_generated/server";
import { UNDO_WINDOW_MS } from "./undoWindow";
import {
  diffFields,
  planFieldEditUndo,
  readSnapshot,
  recordFieldEdit,
  sameValue,
  undoFieldEdit,
  undoMarkerId,
  type FieldEditSnapshot,
} from "./fieldEditUndo";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";
const ME = { userId: "u1", userName: "Alice" };
const NOW = 1_700_000_000_000;

afterEach(() => vi.useRealTimers());

describe("diffFields / sameValue", () => {
  test("only changed fields, absent equals null, nothing changed is null", () => {
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    const d = diffFields({ name: "A", rate: 10, tag: "x" }, { name: "B", rate: 10, tag: undefined }, ["name", "rate", "tag"]);
    expect(d).toEqual({ before: { name: "A", tag: "x" }, after: { name: "B", tag: null } });
    expect(diffFields({ a: 1 }, { a: 1 }, ["a"])).toBeNull();
    // a blank staying blank is not a change; 0 is a real value, not blank
    expect(diffFields({ p: undefined }, { p: null }, ["p"])).toBeNull();
    expect(diffFields({ p: undefined }, { p: 0 }, ["p"])).toEqual({ before: { p: null }, after: { p: 0 } });
  });
});

describe("planFieldEditUndo", () => {
  const snap: FieldEditSnapshot = {
    before: { name: "A", note: null },
    after: { name: "B", note: "hi" },
    serverSavedAt: NOW,
    authorId: "u1",
  };
  const ok = { snapshot: snap, current: { name: "B", note: "hi", other: 1 }, actorId: "u1", serverNow: NOW + 1000, alreadyUndone: false };

  test("restores exactly the changed fields; absent-before is cleared", () => {
    expect(planFieldEditUndo(ok)).toEqual({ set: { name: "A" }, clear: ["note"] });
  });
  test("refuses: not the author, already undone, expired, any field changed since", () => {
    expect(() => planFieldEditUndo({ ...ok, actorId: "u2" })).toThrow(/Only the person/);
    expect(() => planFieldEditUndo({ ...ok, alreadyUndone: true })).toThrow(/already undone/);
    expect(() => planFieldEditUndo({ ...ok, serverNow: NOW + UNDO_WINDOW_MS + 1 })).toThrow(/10 minutes/);
    expect(() => planFieldEditUndo({ ...ok, current: { name: "C", note: "hi" } })).toThrow(/name changed since/);
    expect(() => planFieldEditUndo({ ...ok, current: { name: "B", note: null } })).toThrow(/note changed since/);
  });
  test("readSnapshot rejects a row that is not a field edit", () => {
    expect(readSnapshot({ other: 1 })).toBeNull();
    expect(readSnapshot({ fieldEdit: snap })).toEqual(snap);
  });
});

describe("recordFieldEdit + undoFieldEdit (in a transaction)", () => {
  async function setup() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "Old", type: "WAREHOUSE" } as never);
    });
    const loc = (orgId = ORG) => async (ctx: MutationCtx) => {
      const d = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", "l1")).first();
      return d && d.organizationId === orgId ? d : null;
    };
    const edit = (name: string) =>
      t.run(async (ctx) => {
        const d = (await loc()(ctx))!;
        const diff = diffFields(d, { ...d, name }, ["name", "address"])!;
        await ctx.db.patch(d._id, { name });
        await recordFieldEdit(ctx, { orgId: ORG, entityType: "location", entityId: "l1", entityName: name, auditId: "a1", actor: ME, summary: "Edited", diff, now: NOW });
      });
    const undo = (over: { actor?: typeof ME; orgId?: string; auditId?: string } = {}) =>
      t.run(async (ctx) =>
        undoFieldEdit(ctx, {
          orgId: over.orgId ?? ORG,
          entityType: "location",
          entityId: "l1",
          entityName: "Loc",
          auditId: over.auditId ?? "a1",
          actor: over.actor ?? ME,
          now: NOW,
          load: () => loc(over.orgId ?? ORG)(ctx),
          apply: async (doc, plan) => {
            await ctx.db.patch(doc._id, { ...plan.set, ...Object.fromEntries(plan.clear.map((k) => [k, undefined])) });
          },
        }),
      );
    const name = () => t.run(async (ctx) => (await loc()(ctx))!.name);
    return { t, edit, undo, name };
  }

  test("exact Undo restores, writes one marker, and works once", async () => {
    const { t, edit, undo, name } = await setup();
    await edit("New");
    expect(await name()).toBe("New");
    expect((await undo()).restored).toEqual(["name"]);
    expect(await name()).toBe("Old");
    const marker = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId("a1"))).first());
    expect(marker?.organizationId).toBe(ORG);
    await expect(undo()).rejects.toThrow(/already undone/);
  });

  test("refuses when someone edited the field since, and changes nothing", async () => {
    const { t, edit, undo, name } = await setup();
    await edit("New");
    await t.run(async (ctx) => {
      const d = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", "l1")).first();
      await ctx.db.patch(d!._id, { name: "Someone else" });
    });
    await expect(undo()).rejects.toThrow(/name changed since/);
    expect(await name()).toBe("Someone else");
  });

  test("refuses a load that returns another org's doc, writing nothing", async () => {
    const { t, edit, name } = await setup();
    await edit("New");
    let applied = false;
    await expect(
      t.run(async (ctx) =>
        undoFieldEdit(ctx, {
          orgId: ORG, entityType: "location", entityId: "l1", entityName: "Loc", auditId: "a1", actor: ME, now: NOW,
          load: async () => ({ _id: "x", organizationId: OTHER_ORG, name: "New" }) as never,
          apply: async () => { applied = true; },
        }),
      ),
    ).rejects.toThrow(/no longer exists/);
    expect(applied).toBe(false);
    expect(await name()).toBe("New");
    const marker = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId("a1"))).first());
    expect(marker).toBeNull();
  });

  test("refuses another author, an expired window, a foreign org and an unknown id", async () => {
    const { edit, undo } = await setup();
    await edit("New");
    await expect(undo({ actor: { userId: "u2", userName: "Bob" } })).rejects.toThrow(/Only the person/);
    await expect(undo({ orgId: OTHER_ORG })).rejects.toThrow(/not found/);
    await expect(undo({ auditId: "nope" })).rejects.toThrow(/not found/);
    vi.setSystemTime(NOW + UNDO_WINDOW_MS + 5);
    await expect(undo()).rejects.toThrow(/10 minutes/);
  });
});
