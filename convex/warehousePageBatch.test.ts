// @vitest-environment node
//
// Warehouse-page bulk single-call invariant (Phase 3): the two array mutations that
// collapse warehouse-page client fan-outs into one call —
//  - checkRecordOps.prepKitsBatch  (was one prepKitChildren per kit)
//  - warehouseOps.syncContainersBatch (was one syncContainerStatus per container)
// Small hand-seeded fixtures isolate the batch dispatch / per-item validation /
// partial-success (the full kit-tree + container semantics are covered elsewhere).
import { convexTest } from "convex-test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT() {
  const t = convexTest(schema, modules);
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const baseLine = (id: string, extra: Record<string, unknown>) => ({
  id,
  organizationId: ORG,
  projectId: "p1",
  type: "EQUIPMENT" as const,
  quantity: 1,
  sortOrder: 0,
  status: "CONFIRMED" as const,
  checkedOutQuantity: 0,
  prepStatus: "PENDING" as const,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const lineById = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));

// ── prepKitsBatch ─────────────────────────────────────────────────────────────

describe("checkRecordOps.prepKitsBatch — bulk single-call + partial-success", () => {
  async function seedKits(t: T) {
    await t.run(async (ctx) => {
      // Kit 1: parent kl1 + child c1 (both PENDING).
      await ctx.db.insert("projectLineItems", baseLine("kl1", { kitId: "k1", isKitChild: false }));
      await ctx.db.insert("projectLineItems", baseLine("c1", { parentLineItemId: "kl1", isKitChild: true }));
      // Kit 2: parent kl2 + child c2.
      await ctx.db.insert("projectLineItems", baseLine("kl2", { kitId: "k2", isKitChild: false }));
      await ctx.db.insert("projectLineItems", baseLine("c2", { parentLineItemId: "kl2", isKitChild: true }));
      // Cross-project parent (same org, different project) — must be skipped.
      await ctx.db.insert("projectLineItems", { ...baseLine("klX", { kitId: "kx", isKitChild: false }), projectId: "p2" });
    });
  }

  test("preps every eligible kit tree; skips cross-project / missing with per-item errors", async () => {
    const t = makeT();
    await seedKits(t);

    const res = await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepKitsBatch, {
      organizationId: ORG,
      projectId: "p1",
      parentLineItemIds: ["kl1", "kl2", "klX", "ghost"],
      now: NOW,
    });

    expect([...res.succeeded].sort()).toEqual(["kl1", "kl2"]);
    expect(res.errors.map((e) => e.lineItemId).sort()).toEqual(["ghost", "klX"]);

    // Both eligible kit trees (parents + children) flipped to CONFIRMED / PACKED.
    for (const id of ["kl1", "c1", "kl2", "c2"]) {
      const line = await lineById(t, id);
      expect(line?.status).toBe("CONFIRMED");
      expect(line?.prepStatus).toBe("PACKED");
    }
    // The cross-project kit is untouched.
    expect((await lineById(t, "klX"))?.prepStatus).toBe("PENDING");
  });

  test("a cross-org parent id can't be prepped through another org's batch", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { ...baseLine("klO", { kitId: "ko", isKitChild: false }), organizationId: OTHER });
    });

    const res = await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepKitsBatch, {
      organizationId: ORG,
      projectId: "p1",
      parentLineItemIds: ["klO"],
      now: NOW,
    });

    expect(res.succeeded).toEqual([]);
    expect(res.errors).toEqual([{ lineItemId: "klO", message: "Kit line item not found" }]);
    expect((await lineById(t, "klO"))?.prepStatus).toBe("PENDING");
  });

  test("a non-service (user) token cannot call the batch", async () => {
    const t = makeT();
    await seedKits(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG }).mutation(api.checkRecordOps.prepKitsBatch, {
        organizationId: ORG,
        projectId: "p1",
        parentLineItemIds: ["kl1"],
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});

// ── syncContainersBatch ────────────────────────────────────────────────────────

describe("warehouseOps.syncContainersBatch — bulk single-call container roll-up", () => {
  async function seedContainers(t: T) {
    await t.run(async (ctx) => {
      // Container C1: container line (CONFIRMED) + all-deployed contents → should flip CHECKED_OUT.
      await ctx.db.insert("projectLineItems", baseLine("c1li", { prepContainer: "C1", isContainerLineItem: true }));
      await ctx.db.insert("projectLineItems", baseLine("c1a", { prepContainer: "C1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", baseLine("c1b", { prepContainer: "C1", status: "CHECKED_OUT" }));
      // Container C2: container line + all-returned contents → should flip RETURNED.
      await ctx.db.insert("projectLineItems", baseLine("c2li", { prepContainer: "C2", isContainerLineItem: true, status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", baseLine("c2a", { prepContainer: "C2", status: "RETURNED" }));
      // Container C3: mixed contents → no change.
      await ctx.db.insert("projectLineItems", baseLine("c3li", { prepContainer: "C3", isContainerLineItem: true }));
      await ctx.db.insert("projectLineItems", baseLine("c3a", { prepContainer: "C3", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", baseLine("c3b", { prepContainer: "C3", status: "CONFIRMED" }));
      // Cross-org line sharing the C1 name — must NOT be swept into this org's rollup.
      await ctx.db.insert("projectLineItems", { ...baseLine("cxli", { prepContainer: "C1", isContainerLineItem: true, status: "CONFIRMED" }), organizationId: OTHER });
    });
  }

  test("rolls up N containers in one call — deployed→CHECKED_OUT, returned→RETURNED, mixed→no-op", async () => {
    const t = makeT();
    await seedContainers(t);

    const res = await t.withIdentity(SERVICE).mutation(api.warehouseOps.syncContainersBatch, {
      organizationId: ORG,
      projectId: "p1",
      containerNames: ["C1", "C2", "C3", "Cghost"],
      userId: USER,
      now: NOW,
    });

    const byName = new Map(res.results.map((r) => [r.containerName, r]));
    expect(byName.get("C1")).toEqual({ containerName: "C1", updated: true, status: "CHECKED_OUT" });
    expect(byName.get("C2")).toEqual({ containerName: "C2", updated: true, status: "RETURNED" });
    expect(byName.get("C3")).toEqual({ containerName: "C3", updated: false });
    expect(byName.get("Cghost")).toEqual({ containerName: "Cghost", updated: false });

    expect((await lineById(t, "c1li"))?.status).toBe("CHECKED_OUT");
    expect((await lineById(t, "c2li"))?.status).toBe("RETURNED");
    expect((await lineById(t, "c3li"))?.status).toBe("CONFIRMED");
    // The other org's identically-named container line is untouched.
    expect((await lineById(t, "cxli"))?.status).toBe("CONFIRMED");
  });

  test("a non-service (user) token cannot call the batch", async () => {
    const t = makeT();
    await seedContainers(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG }).mutation(api.warehouseOps.syncContainersBatch, {
        organizationId: ORG,
        projectId: "p1",
        containerNames: ["C1"],
        userId: USER,
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});
