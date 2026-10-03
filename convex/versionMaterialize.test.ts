// @vitest-environment node
//
// convex/projectVersionsWrites.ts's `materializeVersionRowsNative` — the §6
// step 2 materialization primitive (#1228, Phase 2 of "Project versioning
// v2"). See the mutation's own file-level comment block for the full
// deploy-order/safety writeup; this file proves the mechanically-checked
// half of it.
import { convexTest } from "convex-test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const USER = { subject: "user_1", orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seedProject(t: T, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P1", name: "Gig",
      isTemplate: false, liveVersionId: "v-live", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", {
      id: "v-live", organizationId: orgId, projectId: "p1", number: 2,
      contentState: "ready", createdAt: NOW, createdById: "u1",
    });
    await ctx.db.insert("projectVersions", {
      id: "v-target", organizationId: orgId, projectId: "p1", number: 1,
      contentState: "missing", createdAt: NOW, createdById: "u1",
    });
    await ctx.db.insert("projectCategories", {
      id: "cat1", organizationId: orgId, projectId: "p1", versionId: "v-live", lineageId: "cat1",
      name: "Audio", sortOrder: 0,
    });
    await ctx.db.insert("projectGroups", {
      id: "grp1", organizationId: orgId, projectId: "p1", versionId: "v-live", lineageId: "grp1",
      title: "Stage", quantity: 1, sortOrder: 0,
    });
    await ctx.db.insert("projectLineItems", {
      id: "li1", organizationId: orgId, projectId: "p1", versionId: "v-live", lineageId: "li1",
      type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false, quantity: 1,
      unitPrice: 50, lineTotal: 50, description: "Speaker",
    });
    await ctx.db.insert("projectServices", {
      id: "svc1", organizationId: orgId, projectId: "p1", versionId: "v-live", lineageId: "svc1",
      type: "LABOUR", title: "Crew", status: "CONFIRMED", quantity: 1,
    });
  });
}

const materialize = (t: T, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(SERVICE).mutation(api.projectVersionsWrites.materializeVersionRowsNative, {
    organizationId: ORG, projectId: "p1", targetVersionId: "v-target", ...over,
  } as never);

const rowsForVersion = (t: T, table: "projectCategories" | "projectGroups" | "projectLineItems" | "projectServices", versionId: string) =>
  t.run(async (ctx) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.db.query(table) as any).withIndex("by_versionId", (q: any) => q.eq("versionId", versionId)).collect(),
  );

describe("materializeVersionRowsNative", () => {
  test("clones every live row into the target version, fresh id + preserved lineageId", async () => {
    const t = makeT();
    await seedProject(t);

    const result = await materialize(t);
    expect(result.materialized).toBe(4); // 1 category + 1 group + 1 line item + 1 service

    const [cats, groups, lines, services] = await Promise.all([
      rowsForVersion(t, "projectCategories", "v-target"),
      rowsForVersion(t, "projectGroups", "v-target"),
      rowsForVersion(t, "projectLineItems", "v-target"),
      rowsForVersion(t, "projectServices", "v-target"),
    ]);
    expect(cats).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(services).toHaveLength(1);

    // Fresh id, but lineageId ties back to the live row so a
    // by_versionId_lineageId lookup can find "the same line" across versions.
    expect(cats[0].id).not.toBe("cat1");
    expect(cats[0].lineageId).toBe("cat1");
    expect(lines[0].id).not.toBe("li1");
    expect(lines[0].lineageId).toBe("li1");
    expect(lines[0].description).toBe("Speaker");
    expect(lines[0].unitPrice).toBe(50);

    // The live rows themselves are completely untouched.
    const liveLines = await rowsForVersion(t, "projectLineItems", "v-live");
    expect(liveLines).toHaveLength(1);
    expect(liveLines[0].id).toBe("li1");

    // contentState flips to "ready" now that the version has real rows.
    const target = await t.run((ctx) => ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", "v-target")).first());
    expect(target?.contentState).toBe("ready");
  });

  test("rewrites in-clone-set FK references (categoryId/groupId/parentLineItemId) to the NEW cloned ids", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      // Wire the existing group/line into the existing category, and add a
      // kit child pointing at li1 as its parent — every FK a materialized
      // clone must not leave dangling against the SOURCE version's ids.
      await ctx.db.patch(
        (await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "grp1")).first())!._id,
        { categoryId: "cat1" },
      );
      await ctx.db.patch(
        (await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first())!._id,
        { categoryId: "cat1", groupId: "grp1" },
      );
      await ctx.db.insert("projectLineItems", {
        id: "li1-child", organizationId: ORG, projectId: "p1", versionId: "v-live", lineageId: "li1-child",
        type: "EQUIPMENT", status: "CONFIRMED", isKitChild: true, parentLineItemId: "li1", childKind: "KIT",
        quantity: 1, description: "Cable",
        // Deliberately points OUTSIDE the clone set — modelId names a `models`
        // row, not one of the 4 cloned tables, and must survive unchanged.
        modelId: "m1",
      });
    });

    await materialize(t);

    const [cats, groups, lines] = await Promise.all([
      rowsForVersion(t, "projectCategories", "v-target"),
      rowsForVersion(t, "projectGroups", "v-target"),
      rowsForVersion(t, "projectLineItems", "v-target"),
    ]);
    const newCatId = cats[0].id;
    const newGroupId = groups[0].id;
    const parentLine = lines.find((l: { lineageId?: string }) => l.lineageId === "li1")!;
    const childLine = lines.find((l: { lineageId?: string }) => l.lineageId === "li1-child")!;

    // The group's categoryId and the parent line's categoryId/groupId now
    // point at THIS version's cloned category/group, not the source's.
    expect(groups[0].categoryId).toBe(newCatId);
    expect(parentLine.categoryId).toBe(newCatId);
    expect(parentLine.groupId).toBe(newGroupId);
    // The kit child's parentLineItemId points at the cloned PARENT LINE,
    // not the source version's "li1".
    expect(childLine.parentLineItemId).toBe(parentLine.id);
    expect(childLine.parentLineItemId).not.toBe("li1");
    // A FK outside the clone set (modelId -> `models`) is untouched.
    expect(childLine.modelId).toBe("m1");
  });

  test("refuses to materialize the project's OWN live version", async () => {
    const t = makeT();
    await seedProject(t);
    await expect(materialize(t, { targetVersionId: "v-live" })).rejects.toThrow(/refusing to materialize the LIVE version/i);
  });

  test("refuses to double-materialize a version that already has rows", async () => {
    const t = makeT();
    await seedProject(t);
    await materialize(t);
    await expect(materialize(t)).rejects.toThrow(/already has plan rows/i);
  });

  test("a non-service (user) token cannot call it", async () => {
    const t = makeT();
    await seedProject(t);
    await expect(
      t.withIdentity(USER).mutation(api.projectVersionsWrites.materializeVersionRowsNative, {
        organizationId: ORG, projectId: "p1", targetVersionId: "v-target",
      } as never),
    ).rejects.toThrow(/server/i);
  });

  test("rejects a cross-org project", async () => {
    const t = makeT();
    await seedProject(t, OTHER);
    await expect(materialize(t)).rejects.toThrow(/not found or cross-org/i);
  });

  test("rejects a target version belonging to another project", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Other", isTemplate: false, liveVersionId: "v-live-p2", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: "v-live-p2", organizationId: ORG, projectId: "p2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectVersions", { id: "v-foreign-target", organizationId: ORG, projectId: "p2", number: 2, contentState: "missing", createdAt: NOW, createdById: "u1" });
    });
    await expect(materialize(t, { targetVersionId: "v-foreign-target" })).rejects.toThrow(/target version not found or cross-org\/project/i);
  });

  test("can materialize from an explicit non-live sourceVersionId, not just the live one", async () => {
    const t = makeT();
    await seedProject(t);
    // A third version, already materialized from live, becomes the source for a fourth.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: "v-mid", organizationId: ORG, projectId: "p1", number: 3, contentState: "missing", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectVersions", { id: "v-final", organizationId: ORG, projectId: "p1", number: 4, contentState: "missing", createdAt: NOW, createdById: "u1" });
    });
    await materialize(t, { targetVersionId: "v-mid" });
    const result = await materialize(t, { targetVersionId: "v-final", sourceVersionId: "v-mid" });
    expect(result.materialized).toBe(4);

    const finalLines = await rowsForVersion(t, "projectLineItems", "v-final");
    expect(finalLines).toHaveLength(1);
    expect(finalLines[0].lineageId).toBe("li1"); // lineage survives a two-hop clone
  });
});
