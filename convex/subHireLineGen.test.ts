// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import type { MutationCtx } from "./_generated/server";
import { regenerateSubHireLines } from "./lib/subHireLineGen";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;

/**
 * Money gate for regenerateSubHireLines (convex/lib/subHireLineGen.ts) — byte-parity
 * with src/server/sub-hires.ts generateSubHireLineItems (delete-and-recreate of a
 * sub-hire's project line items). Asserts the exact line set (parent + kit-children +
 * standalone), placement resolution, delete-and-recreate, and the (intentionally
 * PERSISTED) suggestedPrice.
 */

const makeT = () => convexTest(schema, modules);
type Ctx = MutationCtx;

async function seedProject(ctx: Ctx, id = "p1") {
  await ctx.db.insert("projects", {
    id, organizationId: ORG, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED",
    defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1, isTemplate: false, createdAt: NOW, updatedAt: NOW,
  });
}

// A realistic sub-hire: one grouped set (charge + one member item) + one ungrouped
// item, both placed into project group pg1 (categoryId catX).
async function seedRealisticSubHire(ctx: Ctx) {
  await seedProject(ctx);
  await ctx.db.insert("projectGroups", { id: "pg1", organizationId: ORG, projectId: "p1", categoryId: "catX", title: "Host", quantity: 1, sortOrder: 0 });
  await ctx.db.insert("subHires", {
    id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: "u1", orderNumber: "SH-0001",
    projectId: "p1", pricingMode: "ITEMIZED", status: "CONFIRMED",
  });
  // Grouped set: charge 500 × qty 1 × (1-10/100) = 450 parent lineTotal, KIT_PRICE.
  await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Lighting Kit", quantity: 1, charge: 500, discount: 10, showOnQuote: true, showOnDocs: true, targetGroupId: "pg1", sortOrder: 0 });
  // Member item: charge 50 × (1-0) × qty 4 × dur 2 = 400.
  await ctx.db.insert("subHireItems", { id: "i1", subHireId: "sh1", groupId: "g1", modelId: "m1", description: "Par Can", quantity: 4, unitCharge: 50, discount: 0, duration: 2, pricingType: "PER_DAY", showOnQuote: true, showOnDocs: true, sortOrder: 0 });
  // Ungrouped standalone: charge 25 × (1-20/100) × qty 2 × dur 1 = 40. Placed into pg1.
  await ctx.db.insert("subHireItems", { id: "i2", subHireId: "sh1", description: "Cable", quantity: 2, unitCharge: 25, discount: 20, duration: 1, pricingType: "FLAT", showOnQuote: true, showOnDocs: false, targetGroupId: "pg1", sortOrder: 1 });
}

async function linesForProject(t: ReturnType<typeof makeT>, projectId = "p1") {
  return await t.run(async (ctx) =>
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  );
}

describe("regenerateSubHireLines — full pipeline", () => {
  test("creates parent + kit-children + standalone with correct fields, placement, and persisted suggestedPrice", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await seedRealisticSubHire(ctx);
      await regenerateSubHireLines(ctx, "sh1", ORG, NOW + 1);
    });

    const lines = await linesForProject(t);
    expect(lines).toHaveLength(3);

    const parent = lines.find((l) => l.subHireGroupId === "g1")!;
    expect(parent).toBeDefined();
    expect(parent.type).toBe("EQUIPMENT");
    expect(parent.description).toBe("Lighting Kit");
    expect(parent.quantity).toBe(1);
    expect(parent.unitPrice).toBe(500);
    expect(parent.discount).toBe(10);
    expect(parent.lineTotal).toBe(450);
    expect(parent.pricingMode).toBe("KIT_PRICE");
    expect(parent.subHireId).toBe("sh1");
    expect(parent.supplierId).toBe("sup1");
    expect(parent.showSubhireOnDocs).toBe(true);
    expect(parent.subhireOrderNumber).toBe("SH-0001");
    expect(parent.categoryId).toBe("catX"); // from pg1
    expect(parent.groupId).toBe("pg1");
    expect(parent.status).toBe("QUOTED");
    expect(parent.isKitChild).toBeFalsy();

    const child = lines.find((l) => l.subHireItemId === "i1")!;
    expect(child).toBeDefined();
    expect(child.isKitChild).toBe(true);
    expect(child.parentLineItemId).toBe(parent.id);
    expect(child.unitPrice).toBe(50);
    expect(child.lineTotal).toBe(400);
    expect(child.modelId).toBe("m1");
    expect(child.categoryId).toBe("catX");
    expect(child.groupId).toBe("pg1");
    expect(child.showSubhireOnDocs).toBe(true);
    expect(child.duration).toBe(2);

    const standalone = lines.find((l) => l.subHireItemId === "i2")!;
    expect(standalone).toBeDefined();
    expect(standalone.isKitChild).toBeFalsy();
    expect(standalone.parentLineItemId).toBeUndefined();
    expect(standalone.unitPrice).toBe(25);
    expect(standalone.lineTotal).toBe(40);
    expect(standalone.groupId).toBe("pg1");
    expect(standalone.categoryId).toBe("catX");
    expect(standalone.showSubhireOnDocs).toBe(false);

    // suggestedPrice PERSISTED on pg1 (intentional deviation). Lines in pg1 that are
    // NOT kit-children: parent (no modelId → unitPrice 500) × qty 1 × rentalQty 1 = 500;
    // standalone (no modelId → unitPrice 25) × qty 2 = 50. Child excluded. Total 550.
    const pg1 = await t.run(async (ctx) => ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "pg1")).first());
    expect(pg1?.suggestedPrice).toBe(550);
  });

  test("sortOrder continues after the project's OTHER lines; pre-existing sub-hire lines are deleted", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await seedRealisticSubHire(ctx);
      // Pre-existing sub-hire lines (a stale parent + child) — must be deleted.
      await ctx.db.insert("projectLineItems", { id: "old1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", subHireId: "sh1", isKitChild: false, sortOrder: 5, lineTotal: 111 });
      await ctx.db.insert("projectLineItems", { id: "oldchild1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", subHireId: "sh1", isKitChild: true, parentLineItemId: "old1", sortOrder: 6, lineTotal: 22 });
      // An unrelated (non-sub-hire) line — must remain + set the nextSort baseline (max 10 → 11).
      await ctx.db.insert("projectLineItems", { id: "keep1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", isKitChild: false, sortOrder: 10, lineTotal: 77 });
      await regenerateSubHireLines(ctx, "sh1", ORG, NOW + 1);
    });

    const lines = await linesForProject(t);
    // keep1 + 3 freshly generated = 4. old1/oldchild1 gone.
    expect(lines.map((l) => l.id).sort()).toContain("keep1");
    expect(lines.find((l) => l.id === "old1")).toBeUndefined();
    expect(lines.find((l) => l.id === "oldchild1")).toBeUndefined();
    expect(lines).toHaveLength(4);

    const parent = lines.find((l) => l.subHireGroupId === "g1")!;
    const child = lines.find((l) => l.subHireItemId === "i1")!;
    const standalone = lines.find((l) => l.subHireItemId === "i2")!;
    // nextSort baseline = max(keep1 sortOrder 10) + 1 = 11 → parent 11, child 12, standalone 13.
    expect(parent.sortOrder).toBe(11);
    expect(child.sortOrder).toBe(12);
    expect(standalone.sortOrder).toBe(13);
  });

  test("no-op when the sub-hire has no project", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHires", { id: "sh2", organizationId: ORG, supplierId: "sup1", createdById: "u1", orderNumber: "SH-0002", pricingMode: "ITEMIZED" });
      await ctx.db.insert("subHireItems", { id: "x1", subHireId: "sh2", description: "orphan", quantity: 1, unitCharge: 10, duration: 1, showOnQuote: true, sortOrder: 0 });
      await regenerateSubHireLines(ctx, "sh2", ORG, NOW + 1);
    });
    const anyLines = await t.run(async (ctx) => ctx.db.query("projectLineItems").collect());
    expect(anyLines).toHaveLength(0);
  });

  test("a !showOnQuote group is skipped and its items are not emitted as standalone", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await seedProject(ctx);
      await ctx.db.insert("subHires", { id: "sh3", organizationId: ORG, supplierId: "sup1", createdById: "u1", orderNumber: "SH-0003", projectId: "p1", pricingMode: "ITEMIZED" });
      // Hidden group + its member item → NEITHER should produce a line.
      await ctx.db.insert("subHireGroups", { id: "hg", subHireId: "sh3", title: "Hidden", quantity: 1, charge: 999, showOnQuote: false, sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "hi", subHireId: "sh3", groupId: "hg", description: "member", quantity: 1, unitCharge: 999, duration: 1, showOnQuote: true, sortOrder: 0 });
      // A visible ungrouped item → the ONLY line produced.
      await ctx.db.insert("subHireItems", { id: "vi", subHireId: "sh3", description: "visible", quantity: 1, unitCharge: 30, discount: 0, duration: 1, pricingType: "FLAT", showOnQuote: true, sortOrder: 1 });
      await regenerateSubHireLines(ctx, "sh3", ORG, NOW + 1);
    });
    const lines = await linesForProject(t);
    expect(lines).toHaveLength(1);
    expect(lines[0].subHireItemId).toBe("vi");
    expect(lines[0].lineTotal).toBe(30);
  });

  test("idempotent: regenerating twice yields the same logical line set", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await seedRealisticSubHire(ctx);
      await regenerateSubHireLines(ctx, "sh1", ORG, NOW + 1);
    });
    const first = await linesForProject(t);
    await t.run(async (ctx) => regenerateSubHireLines(ctx, "sh1", ORG, NOW + 2));
    const second = await linesForProject(t);

    const key = (l: { subHireGroupId?: string; subHireItemId?: string; lineTotal?: number; isKitChild?: boolean }) =>
      `${l.subHireGroupId ?? ""}|${l.subHireItemId ?? ""}|${l.lineTotal}|${l.isKitChild ? 1 : 0}`;
    expect(second.map(key).sort()).toEqual(first.map(key).sort());
    expect(second).toHaveLength(3);
    // Rows were recreated (new cuids), not reused.
    expect(new Set(second.map((l) => l.id))).not.toEqual(new Set(first.map((l) => l.id)));
  });
});
