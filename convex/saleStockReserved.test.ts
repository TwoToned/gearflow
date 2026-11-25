// @vitest-environment node
//
// Sales stock "Reserved" must be exactly what the pool has given out (review ruling). These drive the REAL
// write path (`lineItemWrites.addNative`) and then read `modelsList.saleStockPage`, so a drift between the
// decrement and the Reserved read fails here. The invariant in every case: On hand = the pool before the
// adds, minus whatever physically left the building.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { ReadBudget } from "./lib/readBudget";
import { loadReservedByModel, takesFromPool, isReservedSaleLine } from "./lib/saleStockFacts";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const as = (t: T) => t.withIdentity({ subject: USER, orgId: ORG });
const ACTOR = { userId: USER, userName: "Alice" };
const POOL = 20;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, liveVersionId: "v1", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", salePrice: 120, saleStockQuantity: POOL });
  });
}

let n = 0;
async function addSale(t: T, over: Record<string, unknown>, qty = 3) {
  const id = `sale${++n}`;
  await as(t).mutation(api.lineItemWrites.addNative, {
    id, organizationId: ORG, projectId: "p1",
    fields: { type: "SALE", modelId: "m1", quantity: qty, unitPrice: 120, ...over },
    includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: `log${n}`, now: NOW,
  } as never);
  return id;
}
const patchLine = (t: T, id: string, patch: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    await ctx.db.patch(l!._id, patch);
  });
async function row(t: T) {
  const r = await as(t).query(api.modelsList.saleStockPage, { orgId: ORG });
  return r.items.find((i) => i.id === "m1")!;
}

describe("Reserved is exactly what the pool gave out", () => {
  test("a live explicit NEW_STOCK line: pool down, reserved up, on hand unchanged", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
  });

  test("a CANCELLED job still holds what was taken (nothing restores it): honest, still reserved", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { status: "CANCELLED" });
    });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
  });

  test("a line on a DRAFT (non-live) version was decremented too, so it is reserved", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" });
    await patchLine(t, id, { versionId: "v0" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
  });

  test("an UNSET saleMode is neither decremented nor reserved (whatever the write path does today)", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, {});
    const r = await row(t);
    expect(r.available).toBe(POOL);
    expect(r).toMatchObject({ reserved: 0, onHand: POOL });
  });

  test("a CHECKED_OUT line has left the building: not reserved, on hand drops with it", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" });
    await patchLine(t, id, { status: "CHECKED_OUT" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 0, onHand: POOL - 3 });
  });

  test("a copy of a line in another version is one add: counted once per lineage", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" });
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      const { _id, _creationTime, ...rest } = l!;
      void _id;
      void _creationTime;
      await ctx.db.patch(l!._id, { lineageId: "lin1" });
      await ctx.db.insert("projectLineItems", { ...rest, id: `${id}-copy`, versionId: "v0", lineageId: "lin1" });
    });
    expect(await row(t)).toMatchObject({ reserved: 3, onHand: POOL });
  });
});

describe("the pool is accounted per lineage: pool + reserved stays constant through every step", () => {
  const lines = (t: T, versionId: string) =>
    t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).collect());
  const physical = async (t: T) => {
    const r = await row(t);
    return r.available + (r.reserved ?? NaN);
  };
  let seq = 0;
  const id = () => `seq${++seq}`;

  test("add, copy to a version, patch either row, make live, delete a version, delete the last row", async () => {
    const t = makeT();
    await seed(t);
    const idA = await addSale(t, { saleMode: "NEW_STOCK" }, 3);
    expect(await physical(t)).toBe(POOL);

    // Copy to v2 (copyPlanGraph): the SAME add, so it takes nothing more.
    const v2 = await as(t).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", actor: ACTOR, auditId: id(), now: NOW } as never);
    const [copy] = (await lines(t, v2.id)).filter((l) => l.type === "SALE");
    expect(copy.lineageId).toBe(idA);
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3 });
    expect(await physical(t)).toBe(POOL);

    const patch = (lineId: string, quantity: number) =>
      as(t).mutation(api.lineItemWrites.patchNative, { id: lineId, orgId: ORG, set: { quantity }, clear: [], entityName: "SM58", allowOverbook: false, actor: ACTOR, auditId: id(), now: NOW } as never);
    await patch(idA, 5); // the lineage's maximum grows 3 -> 5
    expect(await physical(t)).toBe(POOL);
    expect(await row(t)).toMatchObject({ available: POOL - 5, reserved: 5 });
    await patch(copy.id, 8); // the copy is now the larger one: 5 -> 8
    expect(await physical(t)).toBe(POOL);
    expect(await row(t)).toMatchObject({ available: POOL - 8, reserved: 8 });
    await patch(copy.id, 2); // shrinking the copy: the original still holds 5
    expect(await physical(t)).toBe(POOL);
    expect(await row(t)).toMatchObject({ available: POOL - 5, reserved: 5 });

    // Make v2 live, then delete the (now non-live) v1: the lineage lives on in v2.
    await as(t).mutation(api.versions.makeLiveNative, { organizationId: ORG, projectId: "p1", versionId: v2.id, actor: ACTOR, auditId: id(), now: NOW } as never);
    expect(await physical(t)).toBe(POOL);
    await as(t).mutation(api.versions.deleteNative, { organizationId: ORG, projectId: "p1", versionId: "v1", actor: ACTOR, auditId: id(), now: NOW } as never);
    expect(await physical(t)).toBe(POOL);
    expect(await row(t)).toMatchObject({ available: POOL - 2, reserved: 2 }); // only the copy's 2 remain

    // Deleting the last row of the lineage gives everything back.
    await as(t).mutation(api.lineItemWrites.removeNative, { id: copy.id, orgId: ORG, actor: ACTOR, auditId: id(), now: NOW } as never);
    expect(await row(t)).toMatchObject({ available: POOL, reserved: 0 });
  });

  test("deleting one copy while another still holds the stock restores nothing (the finding's example)", async () => {
    const t = makeT();
    await seed(t);
    const idA = await addSale(t, { saleMode: "NEW_STOCK" }, 5);
    const v2 = await as(t).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", actor: ACTOR, auditId: id(), now: NOW } as never);
    const [copy] = (await lines(t, v2.id)).filter((l) => l.type === "SALE");
    await as(t).mutation(api.versions.deleteNative, { organizationId: ORG, projectId: "p1", versionId: v2.id, actor: ACTOR, auditId: id(), now: NOW } as never);
    expect(await row(t)).toMatchObject({ available: POOL - 5, reserved: 5 }); // copy B gone, A still holds 5: pool unchanged
    expect(copy.id).not.toBe(idA);
  });
});

describe("every path that removes or copies sale lines keeps pool + reserved = physical", () => {
  const lines = (t: T, versionId: string) =>
    t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).collect());
  let n = 0;
  const aid = () => `v${++n}`;
  const total = async (t: T) => {
    const r = await row(t);
    return r.available + (r.reserved ?? NaN);
  };

  test("deleting a (cancelled) project gives every sale line's stock back, once per lineage across its versions", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" }, 3);
    await as(t).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", actor: ACTOR, auditId: aid(), now: NOW } as never); // a copy: same lineage
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3 });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { status: "CANCELLED" });
    });
    await as(t).mutation(api.projectWrites.deleteNative, { id: "p1", orgId: ORG, defaultLocationId: null, actor: ACTOR, auditId: aid(), now: NOW } as never);
    const m = await t.run(async (ctx) => (await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "m1")).first())!.saleStockQuantity);
    expect(m).toBe(POOL); // restored once, not twice, not zero times
  });

  test("copy of a non-live version, delete the original, Undo the copy: the lineage's stock goes back exactly when its last row leaves", async () => {
    const t = makeT();
    await seed(t);
    const idA = await addSale(t, { saleMode: "NEW_STOCK" }, 3); // lineage A on live v1
    const v2 = await as(t).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", actor: ACTOR, auditId: aid(), now: NOW } as never);
    await as(t).mutation(api.versions.makeLiveNative, { organizationId: ORG, projectId: "p1", versionId: v2.id, actor: ACTOR, auditId: aid(), now: NOW } as never);
    // Take the lineage off the live version: it now lives only on v1, a non-live version.
    const [onV2] = (await lines(t, v2.id)).filter((l) => l.type === "SALE");
    await as(t).mutation(api.lineItemWrites.removeNative, { id: onV2.id, orgId: ORG, actor: ACTOR, auditId: aid(), now: NOW } as never);
    expect(await total(t)).toBe(POOL);
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3 });
    // Copy the non-live v1 into v3, delete v1, then Undo the copy.
    const v3 = await as(t).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", fromVersionId: "v1", actor: ACTOR, auditId: "create-v3", now: NOW } as never);
    expect((await lines(t, v3.id)).some((l) => l.lineageId === idA)).toBe(true);
    await as(t).mutation(api.versions.deleteNative, { organizationId: ORG, projectId: "p1", versionId: "v1", actor: ACTOR, auditId: aid(), now: NOW } as never);
    expect(await total(t)).toBe(POOL);
    await as(t).mutation(api.versions.undoCreateNative, { organizationId: ORG, projectId: "p1", versionId: v3.id, createAuditId: "create-v3", actor: ACTOR, auditId: aid(), now: NOW } as never);
    expect(await row(t)).toMatchObject({ available: POOL, reserved: 0 });
  });

  test("duplicating a job takes the copy's NEW_STOCK quantity from the pool, keeps its saleMode, and the invariant holds", async () => {
    const t = makeT();
    await seed(t);
    const idA = await addSale(t, { saleMode: "NEW_STOCK" }, 3);
    await as(t).mutation(api.projectWrites.duplicateNative, { sourceId: "p1", newId: "dup1", newProjectNumber: "P-DUP", newName: "Copy", orgId: ORG, orgDefaultTaxRate: null, now: NOW, actor: ACTOR, auditId: aid() } as never);
    const copies = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", "m1")).collect());
    const copy = copies.find((l) => l.projectId === "dup1")!;
    expect(copy).toMatchObject({ type: "SALE", saleMode: "NEW_STOCK", quantity: 3 });
    expect(copy.lineageId).not.toBe(idA); // a new add
    expect(await row(t)).toMatchObject({ available: POOL - 6, reserved: 6 });
    expect(await total(t)).toBe(POOL);
  });
});

describe("a line that took stock from the pool cannot change type", () => {
  test("SALE -> EQUIPMENT (set or clear) is refused with SALE_TYPE_LOCKED and the pool is untouched; a type that is not changing is fine", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" }, 3);
    const patch = (set: Record<string, unknown>, clear: string[] = []) =>
      as(t).mutation(api.lineItemWrites.patchNative, { id, orgId: ORG, set, clear, entityName: "SM58", allowOverbook: false, actor: ACTOR, auditId: `ty${Math.random()}`, now: NOW } as never);
    await expect(patch({ type: "EQUIPMENT" })).rejects.toThrow(/SALE_TYPE_LOCKED|can't change its type/);
    await expect(patch({}, ["type"])).rejects.toThrow(/SALE_TYPE_LOCKED|can't change its type/);
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
    await patch({ type: "SALE", description: "same type is fine" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3 });
  });
});

describe("the one predicate", () => {
  test("takesFromPool is what the write path decrements by; isReservedSaleLine adds only 'not out'", () => {
    const base = { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", status: "CONFIRMED" };
    expect(takesFromPool(base)).toBe(true);
    expect(takesFromPool({ ...base, saleMode: undefined })).toBe(false);
    expect(takesFromPool({ ...base, saleMode: "FROM_RENTAL_STOCK" })).toBe(false);
    expect(takesFromPool({ ...base, modelId: undefined })).toBe(false);
    expect(takesFromPool({ ...base, type: "EQUIPMENT" })).toBe(false);
    expect(isReservedSaleLine(base)).toBe(true);
    expect(isReservedSaleLine({ ...base, status: "CHECKED_OUT" })).toBe(false);
    expect(isReservedSaleLine({ ...base, status: "CANCELLED" })).toBe(true);
  });
});

describe("the read budget", () => {
  test("a model the budget cannot cover is absent (unknown), never zero, and truncated is set", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" });
    const out = await t.run(async (ctx) => {
      const r = await loadReservedByModel(ctx, ORG, ["m1", "m2"], new ReadBudget(1));
      return { keys: [...r.reserved.keys()], truncated: r.truncated };
    });
    expect(out.truncated).toBe(true);
    expect(out.keys).not.toContain("m2");
  });

  test("with no budget left nothing is read and nothing is guessed", async () => {
    const t = makeT();
    await seed(t);
    const r = await t.run(async (ctx) => {
      const x = await loadReservedByModel(ctx, ORG, ["m1"], new ReadBudget(0));
      return { size: x.reserved.size, truncated: x.truncated };
    });
    expect(r).toEqual({ size: 0, truncated: true });
  });
});
