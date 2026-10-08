// @vitest-environment node
//
// One-off repair: release line items whose groupId points at a group that no
// longer exists (left behind by deleteGroupNative when it ran in a non-live
// version). See convex/repairOrphanedGroupLines.ts.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

function line(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, organizationId: ORG, projectId: "p1", categoryId: "cat1", quantity: 1, isKitChild: false,
    isCustomItem: false, status: "CONFIRMED" as const, type: "EQUIPMENT" as const, versionId: "v2", lineageId: id,
    ...extra,
  };
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectGroups", { id: "g-live", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Real", sortOrder: 0, versionId: "v2", lineageId: "g-live" });
    // A group that exists, but in ANOTHER org — does not count as this line's group.
    await ctx.db.insert("projectGroups", { id: "g-foreign", organizationId: "org_other", projectId: "p9", title: "Theirs", sortOrder: 0 });
    await ctx.db.insert("projectLineItems", line("ok", { groupId: "g-live" }));
    await ctx.db.insert("projectLineItems", line("orphan", { groupId: "g-deleted", description: "SM57" }));
    await ctx.db.insert("projectLineItems", line("orphan-foreign", { groupId: "g-foreign" }));
    await ctx.db.insert("projectLineItems", line("standalone"));
  });
}

async function run(t: T, apply: boolean) {
  return t.withIdentity(SERVICE).mutation(api.repairOrphanedGroupLines.repairOrphanedGroupLinesPage, { cursor: null, apply });
}

describe("repairOrphanedGroupLines", () => {
  test("dry run reports the orphans and changes nothing", async () => {
    const t = makeT();
    await seed(t);
    const r = await run(t, false);
    expect(r.scanned).toBe(3); // the three lines that carry a groupId
    expect(r.orphaned).toBe(2);
    expect(r.released).toBe(0);
    expect(r.sample.map((s) => s.lineId).sort()).toEqual(["orphan", "orphan-foreign"]);
    expect(r.sample.find((s) => s.lineId === "orphan")?.description).toBe("SM57");
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "orphan")).first();
      expect(l?.groupId).toBe("g-deleted");
    });
  });

  test("apply releases only orphaned lines, keeps categoryId, is idempotent", async () => {
    const t = makeT();
    await seed(t);
    const r = await run(t, true);
    expect(r.released).toBe(2);
    await t.run(async (ctx) => {
      const get = (id: string) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      expect((await get("orphan"))?.groupId).toBeUndefined();
      expect((await get("orphan"))?.categoryId).toBe("cat1");
      expect((await get("orphan-foreign"))?.groupId).toBeUndefined();
      expect((await get("ok"))?.groupId).toBe("g-live"); // real group untouched
      expect((await get("standalone"))?.groupId).toBeUndefined();
    });
    const again = await run(t, true);
    expect(again.orphaned).toBe(0);
    expect(again.released).toBe(0);
  });

  test("rejects a non-service caller", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).mutation(api.repairOrphanedGroupLines.repairOrphanedGroupLinesPage, { cursor: null, apply: false }),
    ).rejects.toThrow();
  });
});
