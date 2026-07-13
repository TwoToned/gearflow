// @vitest-environment node
//
// modelCheckItems.createManyIfMissing — the Phase 3 bulk single-call invariant for
// bulk-assigning check items to models (Appendix A*): N model×checkItem rows created
// in ONE array mutation (was one createIfMissing round-trip per pair). organizationId
// is stamped from the arg (no per-row cross-tenant smuggling); dedups by id.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

const rowById = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));

describe("modelCheckItems.createManyIfMissing — bulk single-call", () => {
  test("creates new pairs, skips an existing id, stamps organizationId from the arg", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("modelCheckItems", { id: "mc-existing", organizationId: ORG, modelId: "m1", checkItemId: "c1", sortOrder: 0, createdAt: NOW });
    });

    const { created } = await t.withIdentity(SERVICE).mutation(api.modelCheckItems.createManyIfMissing, {
      organizationId: ORG,
      rows: [
        { id: "mc-existing", modelId: "m1", checkItemId: "c1", sortOrder: 0, createdAt: NOW }, // already there → skip
        { id: "mc1", modelId: "m1", checkItemId: "c2", sortOrder: 1, createdAt: NOW },
        { id: "mc2", modelId: "m2", checkItemId: "c1", sortOrder: 0, createdAt: NOW },
      ],
    });

    expect(created).toBe(2);
    const mc1 = await rowById(t, "mc1");
    expect(mc1?.organizationId).toBe(ORG); // stamped from the arg
    expect(mc1?.modelId).toBe("m1");
    expect(mc1?.checkItemId).toBe("c2");
    expect(mc1?.sortOrder).toBe(1);
    expect((await rowById(t, "mc2"))?.checkItemId).toBe("c1");

    // Exactly one row for the pre-existing id (no duplicate insert).
    const dupes = await t.run(async (ctx) =>
      (await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", "mc-existing")).collect()).length,
    );
    expect(dupes).toBe(1);
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.modelCheckItems.createManyIfMissing, {
        organizationId: ORG,
        rows: [{ id: "x", modelId: "m1", checkItemId: "c1" }],
      }),
    ).rejects.toThrow(/server/i);
  });
});
