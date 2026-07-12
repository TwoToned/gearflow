// @vitest-environment node
//
// Kit per-unit fulfillment — Phase 2 backfill (docs/designs/kit-per-unit-fulfillment.md).
// Verifies unit-less kit member child lines get a unit carrying the line's current
// lifecycle, idempotently, while loose / accessory / nested / already-seeded lines are
// left alone.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

/** A pre-change kit member child line (no unit). */
function kitChild(id: string, extra: Record<string, unknown>) {
  return { id, organizationId: ORG, projectId: "p1", type: "EQUIPMENT" as const, isKitChild: true, parentLineItemId: "kl1", createdAt: NOW, updatedAt: NOW, ...extra };
}

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  for (;;) {
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } = await t.withIdentity(SERVICE).mutation(api.backfillKitUnits.backfillKitUnitsPage, { cursor, apply });
    scanned += r.scanned;
    created += r.created;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, created };
}
const unitsFor = (t: T, lineId: string) => t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineId)).collect());

describe("backfillKitUnits — carries line lifecycle", () => {
  test("deployed / returned / prepped / bulk members each backfill at the right stage", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", kitChild("out", { assetId: "aOut", status: "CHECKED_OUT", checkedOutAt: NOW, checkedOutById: USER }));
      await ctx.db.insert("projectLineItems", kitChild("ret", { assetId: "aRet", status: "RETURNED", returnedAt: NOW, returnedById: USER, returnCondition: "DAMAGED" }));
      await ctx.db.insert("projectLineItems", kitChild("prep", { assetId: "aPrep", status: "CONFIRMED", prepStatus: "PACKED", prepContainer: "Case 3" }));
      await ctx.db.insert("projectLineItems", kitChild("bulk", { bulkAssetId: "b1", quantity: 3, status: "CHECKED_OUT", checkedOutAt: NOW, checkedOutById: USER }));
    });
    const { created } = await runBackfill(t);
    expect(created).toBe(4);

    const [out] = await unitsFor(t, "out");
    expect(out.status).toBe("CHECKED_OUT");
    expect(out.assetId).toBe("aOut");
    expect(out.checkedOutById).toBe(USER);
    expect(out.returnedQuantity).toBe(0);

    const [ret] = await unitsFor(t, "ret");
    expect(ret.status).toBe("RETURNED");
    expect(ret.returnCondition).toBe("DAMAGED");
    expect(ret.returnedQuantity).toBe(1);

    const [prep] = await unitsFor(t, "prep");
    expect(prep.status).toBe("CONFIRMED");
    expect(prep.prepStatus).toBe("PACKED");
    expect(prep.prepContainer).toBe("Case 3");

    const [bulk] = await unitsFor(t, "bulk");
    expect(bulk.bulkAssetId).toBe("b1");
    expect(bulk.quantity).toBe(3);
    expect(bulk.status).toBe("CHECKED_OUT");
  });
});

describe("backfillKitUnits — idempotent + dry-run", () => {
  test("re-running the backfill creates nothing new", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", kitChild("out", { assetId: "aOut", status: "CHECKED_OUT" })); });
    expect((await runBackfill(t)).created).toBe(1);
    expect((await runBackfill(t)).created).toBe(0);
    expect(await unitsFor(t, "out")).toHaveLength(1);
  });

  test("dry-run scans but writes nothing", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", kitChild("out", { assetId: "aOut", status: "CHECKED_OUT" })); });
    const { scanned, created } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(created).toBe(0);
    expect(await unitsFor(t, "out")).toHaveLength(0);
  });

  test("a member already seeded (Phase 1) keeps its live unit, untouched", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", kitChild("seeded", { assetId: "aS", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItemUnits", { id: "liveU", organizationId: ORG, lineItemId: "seeded", assetId: "aS", ordinal: 1, status: "CHECKED_OUT", checkedOutById: "someone", createdAt: NOW, updatedAt: NOW });
    });
    expect((await runBackfill(t)).created).toBe(0);
    const units = await unitsFor(t, "seeded");
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("liveU");
    expect(units[0].checkedOutById).toBe("someone"); // not clobbered
  });
});

describe("backfillKitUnits — leaves non-kit-member lines alone", () => {
  test("loose, accessory, nested-kit-parent, and asset-free lines are skipped", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "loose", organizationId: ORG, projectId: "p1", type: "EQUIPMENT" as const, isKitChild: false, assetId: "aL", status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", kitChild("acc", { assetId: "aAcc", childKind: "ACCESSORY", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", kitChild("nested", { kitId: "k2", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", kitChild("svc", { status: "CONFIRMED" })); // no asset/bulk
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(created).toBe(0);
    for (const id of ["loose", "acc", "nested", "svc"]) expect(await unitsFor(t, id)).toHaveLength(0);
  });
});
