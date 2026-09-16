// @vitest-environment node
//
// convex/lib/versionGraph.ts — the `copyPlanGraph` clone primitive shared by
// `convex/versions.ts`'s `createNative` and `convex/projectVersionsWrites.ts`'s
// `materializeVersionRowsNative` (#1229, Phase 3 of "Project versioning v2").
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import { copyPlanGraph, MAX_CLONABLE_PLAN_ROWS } from "./versionGraph";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_1";

function makeT() {
  return convexTest(schema, modules);
}

describe("copyPlanGraph", () => {
  test("clones categories/groups/lineItems/services with fresh ids, preserved lineageId, and in-clone FK rewrite", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "cat1", organizationId: ORG, projectId: "p1", versionId: "src", lineageId: "cat1", name: "Audio", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "grp1", organizationId: ORG, projectId: "p1", versionId: "src", lineageId: "grp1", title: "Stage", quantity: 1, sortOrder: 0, categoryId: "cat1" });
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", versionId: "src", lineageId: "li1", type: "EQUIPMENT",
        status: "CONFIRMED", isKitChild: false, quantity: 1, unitPrice: 50, lineTotal: 50, description: "Speaker",
        categoryId: "cat1", groupId: "grp1",
      });
      await ctx.db.insert("projectServices", { id: "svc1", organizationId: ORG, projectId: "p1", versionId: "src", lineageId: "svc1", type: "LABOUR", title: "Crew", status: "CONFIRMED", quantity: 1 });
    });

    const result = await t.run((ctx) => copyPlanGraph(ctx, { sourceVersionId: "src", targetVersionId: "tgt" }));
    expect(result.materialized).toBe(4);

    const [cats, groups, lines, services] = await Promise.all([
      t.run((ctx) => ctx.db.query("projectCategories").withIndex("by_versionId", (q) => q.eq("versionId", "tgt")).collect()),
      t.run((ctx) => ctx.db.query("projectGroups").withIndex("by_versionId", (q) => q.eq("versionId", "tgt")).collect()),
      t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", "tgt")).collect()),
      t.run((ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "tgt")).collect()),
    ]);
    expect(cats).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(services).toHaveLength(1);

    expect(lines[0].id).not.toBe("li1");
    expect(lines[0].lineageId).toBe("li1"); // lineage preserved across the clone
    expect(lines[0].unitPrice).toBe(50);
    // In-clone-set FK rewrite: the cloned line's categoryId/groupId point at
    // THIS clone's category/group, not the source's.
    expect(lines[0].categoryId).toBe(cats[0].id);
    expect(lines[0].groupId).toBe(groups[0].id);
    expect(groups[0].categoryId).toBe(cats[0].id);

    // The source rows are completely untouched.
    const srcLines = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", "src")).collect());
    expect(srcLines).toHaveLength(1);
    expect(srcLines[0].id).toBe("li1");
  });

  test("refuses with VERSION_TOO_LARGE when the source has more than MAX_CLONABLE_PLAN_ROWS rows", async () => {
    const t = makeT();
    const n = MAX_CLONABLE_PLAN_ROWS + 1;
    await t.run(async (ctx) => {
      const inserts: Promise<unknown>[] = [];
      for (let i = 0; i < n; i++) {
        inserts.push(
          ctx.db.insert("projectLineItems", {
            id: `li${i}`, organizationId: ORG, projectId: "p1", versionId: "src", lineageId: `li${i}`,
            type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false, quantity: 1, unitPrice: 1, lineTotal: 1,
          }),
        );
      }
      await Promise.all(inserts);
    });

    await expect(
      t.run((ctx) => copyPlanGraph(ctx, { sourceVersionId: "src", targetVersionId: "tgt" })),
    ).rejects.toThrow(/VERSION_TOO_LARGE|too many/i);

    // Refuses BEFORE inserting anything into the target — no partial clone.
    const tgtRows = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", "tgt")).collect());
    expect(tgtRows).toHaveLength(0);
  }, 60_000);
});
