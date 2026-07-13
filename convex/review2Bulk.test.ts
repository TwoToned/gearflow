// @vitest-environment node
//
// Phase 3 bulk single-call invariant — review2 batch (review2/bulk). Converts the
// last multi-select server fan-outs into single array mutations:
//   • *.reorderMany  — drag-reorder N rows in ONE call, sortOrder = index, with a
//     per-item org re-check (by_cuid is a GLOBAL index — a caller must not be able to
//     reorder another org's rows). Representative table: projectTasks.
//   • crewAssignments.createManyServiceAssignments — assign N crew to a service in ONE
//     call; organizationId stamped from the arg, (project, member, service) dedup.
// Mirrors reorderOrgCheck.test.ts / modelCheckItemsCreateMany.test.ts.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
// createManyServiceAssignments bumps the sharded dashboard counter on every insert —
// mount the component (same as dashboardCounters.test.ts) or the write throws.
const makeT = () => {
  const t = convexTest(schema, modules);
  registerShardedCounter(t, "shardedCounter");
  return t;
};
type T = ReturnType<typeof makeT>;

const taskSort = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.sortOrder);

describe("projectTasks.reorderMany — bulk drag-reorder, per-item org re-check", () => {
  test("sets sortOrder = index for in-org rows, skips a cross-org id", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", { id: "t_a", organizationId: ORG, projectId: "p1", title: "A", sortOrder: 9 });
      await ctx.db.insert("projectTasks", { id: "t_b", organizationId: ORG, projectId: "p1", title: "B", sortOrder: 9 });
      await ctx.db.insert("projectTasks", { id: "t_x", organizationId: OTHER, projectId: "p9", title: "X", sortOrder: 9 });
    });
    // Desired display order: b, a — and a cross-org id that must be ignored.
    await t.withIdentity(SERVICE).mutation(api.projectTasks.reorderMany, {
      orgId: ORG,
      orderedIds: ["t_b", "t_a", "t_x"],
      now: NOW,
    });
    expect(await taskSort(t, "t_b")).toBe(0); // in-org, index 0
    expect(await taskSort(t, "t_a")).toBe(1); // in-org, index 1
    expect(await taskSort(t, "t_x")).toBe(9); // cross-org, untouched
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.projectTasks.reorderMany, {
        orgId: ORG,
        orderedIds: ["t_a"],
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});

describe("customFieldDefinitions.reorderMany — {id,sortOrder} pairs, per-item org re-check", () => {
  const cfSort = (t: T, id: string) =>
    t.run(async (ctx) => (await ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.sortOrder);

  test("applies explicit sortOrder for in-org rows, skips a cross-org id without compressing positions", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("customFieldDefinitions", { id: "cf_a", organizationId: ORG, label: "A", fieldKey: "a", sortOrder: 5 });
      await ctx.db.insert("customFieldDefinitions", { id: "cf_b", organizationId: ORG, label: "B", fieldKey: "b", sortOrder: 5 });
      await ctx.db.insert("customFieldDefinitions", { id: "cf_x", organizationId: OTHER, label: "X", fieldKey: "x", sortOrder: 5 });
    });
    // The server filters foreign ids out but keeps explicit sortOrder so survivors
    // don't shift: cf_a→0, cf_x (cross-org, dropped by server) would be 1, cf_b→2.
    await t.withIdentity(SERVICE).mutation(api.customFieldDefinitions.reorderMany, {
      orgId: ORG,
      items: [{ id: "cf_a", sortOrder: 0 }, { id: "cf_b", sortOrder: 2 }, { id: "cf_x", sortOrder: 3 }],
      now: NOW,
    });
    expect(await cfSort(t, "cf_a")).toBe(0);
    expect(await cfSort(t, "cf_b")).toBe(2); // position preserved, not compressed to 1
    expect(await cfSort(t, "cf_x")).toBe(5); // cross-org, untouched
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.customFieldDefinitions.reorderMany, {
        orgId: ORG,
        items: [{ id: "cf_a", sortOrder: 0 }],
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});

describe("crewAssignments.createManyServiceAssignments — bulk single-call", () => {
  const rowById = (t: T, id: string) =>
    t.run(async (ctx) => (await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));

  test("creates new rows, stamps org from the arg, dedups (project, member, service)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      // Pre-existing assignment for (p1, m1, svc1) — must NOT be duplicated.
      await ctx.db.insert("crewAssignments", {
        id: "ca-existing", organizationId: ORG, projectId: "p1", crewMemberId: "m1", serviceId: "svc1", status: "PENDING",
      });
    });

    const { created } = await t.withIdentity(SERVICE).mutation(api.crewAssignments.createManyServiceAssignments, {
      organizationId: ORG,
      rows: [
        { id: "ca-dupe", projectId: "p1", crewMemberId: "m1", serviceId: "svc1", status: "PENDING" }, // dupe triple → skip
        { id: "ca1", projectId: "p1", crewMemberId: "m2", serviceId: "svc1", status: "PENDING" },
        { id: "ca2", projectId: "p1", crewMemberId: "m3", serviceId: "svc1", phase: "EVENT", status: "PENDING" },
      ],
    });

    expect(created).toBe(2);
    expect((await rowById(t, "ca-dupe"))).toBeNull(); // triple already existed → not inserted
    const ca1 = await rowById(t, "ca1");
    expect(ca1?.organizationId).toBe(ORG); // stamped from the arg
    expect(ca1?.crewMemberId).toBe("m2");
    expect((await rowById(t, "ca2"))?.phase).toBe("EVENT");

    // Exactly one row survives for the pre-existing triple.
    const dupes = await t.run(async (ctx) =>
      (await ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", "svc1")).collect())
        .filter((r) => r.projectId === "p1" && r.crewMemberId === "m1").length,
    );
    expect(dupes).toBe(1);
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.crewAssignments.createManyServiceAssignments, {
        organizationId: ORG,
        rows: [{ id: "x", projectId: "p1", crewMemberId: "m1", serviceId: "svc1" }],
      }),
    ).rejects.toThrow(/server/i);
  });
});
