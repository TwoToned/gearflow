// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { LocationMovements, movedLocationIds, stampLocationMovement } from "./locationMovement";

const modules = import.meta.glob("../**/*.ts");

describe("movedLocationIds", () => {
  test.each([
    ["move", "a", "b", ["a", "b"]],
    ["first placement (only the entered location)", undefined, "b", ["b"]],
    ["cleared", "a", null, ["a"]],
    ["unchanged", "a", "a", []],
    ["field not touched", "a", undefined, []],
    ["both absent", null, null, []],
  ] as const)("%s", (_name, from, to, expected) => {
    expect(movedLocationIds(from, to)).toEqual(expected);
  });
});

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("locations", { id: "a", organizationId: "o1", name: "A" });
    await ctx.db.insert("locations", { id: "b", organizationId: "o1", name: "B" });
    await ctx.db.insert("locations", { id: "x", organizationId: "o2", name: "Foreign" });
  });
}
const stamp = (t: ReturnType<typeof convexTest>, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.lastMovementAt ?? null);

describe("stamping", () => {
  test("a move stamps both ends; others and foreign locations are untouched", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run((ctx) => stampLocationMovement(ctx, "o1", "a", "b", 100));
    expect(await stamp(t, "a")).toBe(100);
    expect(await stamp(t, "b")).toBe(100);
    await t.run((ctx) => stampLocationMovement(ctx, "o1", "a", "x", 200));
    expect(await stamp(t, "x")).toBeNull(); // another org's location is never written
    expect(await stamp(t, "a")).toBe(200);
  });

  test("no change, or a field the write did not touch, stamps nothing (absent stays absent)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run((ctx) => stampLocationMovement(ctx, "o1", "a", "a", 100));
    await t.run((ctx) => stampLocationMovement(ctx, "o1", "a", undefined, 100));
    expect(await stamp(t, "a")).toBeNull();
  });

  test("a batch stamps each location once and never moves a stamp backwards", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      const m = new LocationMovements();
      m.record("a", "b").record("a", "b").record(null, "b");
      await m.flush(ctx, "o1", 300);
    });
    expect(await stamp(t, "a")).toBe(300);
    await t.run((ctx) => stampLocationMovement(ctx, "o1", "a", "b", 250));
    expect(await stamp(t, "a")).toBe(300);
  });
});
