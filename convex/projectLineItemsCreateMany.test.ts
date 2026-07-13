// @vitest-environment node
//
// projectLineItems.createMany — the Phase 3 bulk single-call invariant for the
// WooCommerce order-ingest server loop: N project line items created in ONE array
// mutation (was one `create` round-trip per matched product). organizationId is
// stamped from the arg (no per-row cross-tenant smuggling); dedups by id.
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
  t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));

describe("projectLineItems.createMany — bulk single-call", () => {
  test("creates new rows, skips an existing id, stamps organizationId from the arg", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li-existing", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    });

    const { created } = await t.withIdentity(SERVICE).mutation(api.projectLineItems.createMany, {
      organizationId: ORG,
      rows: [
        { id: "li-existing", projectId: "p1", type: "EQUIPMENT", sortOrder: 0, createdAt: NOW, updatedAt: NOW }, // already there → skip
        { id: "li1", projectId: "p1", type: "EQUIPMENT", modelId: "m1", quantity: 2, unitPrice: 10, pricingType: "PER_DAY", duration: 3, lineTotal: 20, sortOrder: 1, createdAt: NOW, updatedAt: NOW },
        { id: "li2", projectId: "p1", type: "MISC", description: "[WooCommerce] Widget", quantity: 1, unitPrice: 5, sortOrder: 2, createdAt: NOW, updatedAt: NOW },
      ],
    });

    expect(created).toBe(2);
    const li1 = await rowById(t, "li1");
    expect(li1?.organizationId).toBe(ORG); // stamped from the arg
    expect(li1?.projectId).toBe("p1");
    expect(li1?.modelId).toBe("m1");
    expect(li1?.quantity).toBe(2);
    expect(li1?.sortOrder).toBe(1);
    const li2 = await rowById(t, "li2");
    expect(li2?.organizationId).toBe(ORG);
    expect(li2?.type).toBe("MISC");
    expect(li2?.description).toBe("[WooCommerce] Widget");

    // Exactly one row for the pre-existing id (no duplicate insert).
    const dupes = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li-existing")).collect()).length,
    );
    expect(dupes).toBe(1);
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.projectLineItems.createMany, {
        organizationId: ORG,
        rows: [{ id: "x", projectId: "p1" }],
      }),
    ).rejects.toThrow(/server/i);
  });
});
