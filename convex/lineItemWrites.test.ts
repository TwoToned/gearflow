// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
// Mount both components: the rate limiter (enforceBrowserWriteLimit on line-item
// mutations) and the sharded counter (mounted for safety — other convex modules in
// the same test glob need it).
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };
const args = { id: "li1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role }); });
}

describe("lineItemWrites.removeNative", () => {
  test("member removes a leaf line + its units + DELETE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Light", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", assetId: "a1", ordinal: 0 });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.removeNative, { ...args, emitSideEffects: true });
    expect(res.projectId).toBe("p1");
    await t.run(async (ctx) => {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(line).toBeNull();
      const units = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "li1")).collect();
      expect(units).toHaveLength(0);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
      expect(log?.entityType).toBe("lineItem");
      // Collab feed folded into the mutation (was a server-tail writeCollabActivityEvent).
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      const removed = events.find((e) => e.action === "line_item_removed");
      expect(removed?.summary).toBe("removed Light");
      expect(removed?.targetType).toBe("lineItem");
      expect(removed?.targetId).toBe("li1");
    });
  });

  test("cascade-removes children (+ their units)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Kit", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
      await ctx.db.insert("projectLineItems", { id: "child1", organizationId: ORG, projectId: "p1", parentLineItemId: "li1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: true, childKind: "KIT" });
      await ctx.db.insert("projectLineItemUnits", { id: "cu1", organizationId: ORG, lineItemId: "child1", assetId: "a2", ordinal: 0 });
    });
    await t.withIdentity(SERVICE).mutation(api.lineItemWrites.removeNative, args);
    await t.run(async (ctx) => {
      const child = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "child1")).first();
      expect(child).toBeNull();
      const cu = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "child1")).collect();
      expect(cu).toHaveLength(0);
    });
  });

  test("blocks removing a kit child directly (KIT_CHILD)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: true, childKind: "KIT" });
    });
    await expect(t.withIdentity(SERVICE).mutation(api.lineItemWrites.removeNative, args)).rejects.toThrow(/part of a Kit/i);
  });

  test("blocks removing an accessory child directly (ACCESSORY_CHILD)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: true, childKind: "ACCESSORY" });
    });
    await expect(t.withIdentity(SERVICE).mutation(api.lineItemWrites.removeNative, args)).rejects.toThrow(/accessory/i);
  });

  test("a viewer is denied (project:manage_line_items)", async () => {
    const t = makeT();
    await member(t, "viewer");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.removeNative, args)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.patchNative", () => {
  const pargs = { id: "li1", orgId: ORG, entityName: "Light", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW };
  test("member patches fields + UPDATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Light", quantity: 1, status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 3, unitPrice: 50, lineTotal: 150, updatedAt: NOW }, clear: [], emitSideEffects: true });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(3);
      expect(li?.unitPrice).toBe(50);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.entityType).toBe("lineItem");
      // Collab feed folded into the mutation, with POST-patch quantity + lineTotal metadata.
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      const updated = events.find((e) => e.action === "line_item_updated");
      expect(updated?.summary).toBe("updated Light");
      expect(updated?.targetId).toBe("li1");
      expect(updated?.metadata).toEqual({ quantity: 3, lineTotal: "150" });
    });
  });
  test("clear removes a field", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Light", notes: "x", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await t.withIdentity(SERVICE).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { updatedAt: NOW }, clear: ["notes"] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.notes).toBeUndefined();
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { updatedAt: NOW }, clear: [] })).rejects.toThrow(/insufficient permissions/i);
  });
  test("strips structural/lifecycle fields from a client set (injection guard)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Light", quantity: 1, status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    // A malicious set tries to cancel the line (drop it from revenue), forge the tree,
    // and spoof a fulfillment counter — alongside a legit quantity edit.
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, {
      ...pargs,
      set: { quantity: 4, status: "CANCELLED", isKitChild: true, parentLineItemId: "evil", checkedOutQuantity: 999, allocatedRevenue: 1e9, updatedAt: NOW },
      clear: [],
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(4); // legit field applied
      expect(li?.status).toBe("CONFIRMED"); // structural field stripped
      expect(li?.isKitChild).toBe(false);
      expect(li?.parentLineItemId).toBeUndefined();
      expect(li?.checkedOutQuantity).toBeUndefined();
      expect(li?.allocatedRevenue).toBeUndefined();
    });
  });
  test("rejects a non-finite money field in a patch set", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", quantity: 1, status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { lineTotal: Number.NaN, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow();
  });
  test("recomputes lineTotal server-side — a forged value disconnected from unitPrice/quantity is ignored", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", quantity: 1, unitPrice: 10, duration: 1, status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    // Real inputs (unitPrice 10 × quantity 2 × duration 1 = 20) but a forged lineTotal
    // of 999999 — the forged value must be discarded, not written verbatim.
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 2, lineTotal: 999999, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.lineTotal).toBe(20);
    });
  });
  test("recompute survives a stale clear:['lineTotal'] alongside pricing inputs (merge-delete must not wipe the recomputed value)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", quantity: 1, unitPrice: 10, duration: 1, status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    // A payload that both sets a real unitPrice AND (inconsistently/maliciously) asks
    // to clear lineTotal — the clear must be reconciled away, not win, since the line
    // IS priced (10 × 1 × 1 = 10). Also forces the `clear.length > 0` merge-replace path.
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, {
      ...pargs,
      set: { unitPrice: 10, updatedAt: NOW },
      clear: ["lineTotal", "notes"],
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.lineTotal).toBe(10);
    });
  });
});

describe("lineItemWrites.addCustomNative", () => {
  const cargs = { id: "cust1", organizationId: ORG, projectId: "p1", fields: { description: "Rigging labour", quantity: 1, unitPrice: 200 }, actor: ACTOR, auditId: "log1", now: NOW };
  test("member adds a custom line (sortOrder computed) + CREATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "existing", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, sortOrder: 4 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addCustomNative, { ...cargs, emitSideEffects: true });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "cust1")).first();
      expect(li?.isCustomItem).toBe(true);
      expect(li?.sortOrder).toBe(5); // max(4)+1
      expect(li?.description).toBe("Rigging labour");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      // Collab feed folded into the mutation.
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      const added = events.find((e) => e.action === "custom_item_added");
      expect(added?.summary).toBe('added custom item "Rigging labour"');
      expect(added?.targetId).toBe("cust1");
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addCustomNative, cargs)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects non-finite / out-of-range money (would poison recalc)", async () => {
    const t = makeT();
    await member(t, "member");
    const bad = async (fields: Record<string, unknown>) =>
      expect(
        t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addCustomNative, { ...cargs, fields: { description: "x", quantity: 1, ...fields } }),
      ).rejects.toThrow();
    await bad({ unitPrice: Number.NaN });
    await bad({ lineTotal: Number.POSITIVE_INFINITY });
    await bad({ unitPrice: -5 });
    await bad({ quantity: 0 });
    await bad({ quantity: 1.5 });
    await bad({ duration: 99999 });
    // Nothing was inserted.
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "cust1")).first();
      expect(li).toBeNull();
    });
  });
  test("recomputes lineTotal server-side — a forged value is ignored (unitPrice 200 × qty 1 = 200, not 999999)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addCustomNative, {
      ...cargs,
      fields: { ...cargs.fields, lineTotal: 999999 },
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "cust1")).first();
      expect(li?.lineTotal).toBe(200);
    });
  });
});

describe("lineItemWrites.addNative", () => {
  const aargs = { id: "new1", organizationId: ORG, projectId: "p1", fields: { type: "EQUIPMENT" as const, description: "PAR Can", quantity: 2, unitPrice: 15 }, includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW };
  test("member adds an inventory line (sortOrder in-mutation) + CREATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "e", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, sortOrder: 2 });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, aargs);
    expect(res.sortOrder).toBe(3);
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "new1")).first();
      expect(li?.description).toBe("PAR Can");
      expect(li?.status).toBe("CONFIRMED");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      expect(log?.entityType).toBe("lineItem");
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, aargs)).rejects.toThrow(/insufficient permissions/i);
  });
  test("recomputes lineTotal server-side — a forged value is ignored (unitPrice 15 × qty 2 = 30, not 999999)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      ...aargs,
      fields: { ...aargs.fields, lineTotal: 999999 },
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "new1")).first();
      expect(li?.lineTotal).toBe(30);
    });
  });
});

describe("lineItemWrites.addNative availability enforcement", () => {
  const DAY = 86_400_000;
  const enfArgs = (fields: { modelId?: string; assetId?: string; quantity: number }, over = false) => ({
    id: "nx", organizationId: ORG, projectId: "p1",
    fields: { type: "EQUIPMENT" as const, ...fields },
    includeAccessories: false, allowOverbook: over,
    actor: ACTOR, auditId: "log1", now: NOW,
  });

  // A SERIALIZED model with `n` active AVAILABLE assets, a project, and an existing
  // booking on THIS project (dateless → only this-project bookings count).
  async function seedModelStock(t: ReturnType<typeof makeT>, n: number, bookedQty: number, dates?: { s: number; e: number }) {
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, ...(dates ? { rentalStartDate: dates.s, rentalEndDate: dates.e } : {}) });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("assets", { id: `a${i}`, organizationId: ORG, modelId: "m1", assetTag: `A-${i}`, status: "AVAILABLE", isActive: true });
      }
      if (bookedQty > 0) {
        await ctx.db.insert("projectLineItems", { id: "lx", organizationId: ORG, projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: bookedQty, status: "CONFIRMED", isKitChild: false });
      }
    });
  }

  test("model path throws INSUFFICIENT_STOCK when qty exceeds available", async () => {
    const t = makeT();
    await seedModelStock(t, 3, 3); // 3 stock, 3 already booked on this project → 0 free
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, enfArgs({ modelId: "m1", quantity: 1 })),
    ).rejects.toThrow(/Only 0 of 1 requested are free/);
  });

  test("model path SUCCEEDS with allowOverbook:true (enforcement bypassed)", async () => {
    const t = makeT();
    await seedModelStock(t, 3, 3);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, enfArgs({ modelId: "m1", quantity: 1 }, true));
    expect(res.id).toBe("nx");
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "nx")).first();
      expect(li?.quantity).toBe(1);
    });
  });

  test("model path allows a qty that exactly fills free stock (boundary)", async () => {
    const t = makeT();
    await seedModelStock(t, 3, 1); // 3 stock, 1 booked → 2 free
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, enfArgs({ modelId: "m1", quantity: 2 }));
    expect(res.id).toBe("nx");
  });

  test("asset path throws ASSET_IN_KIT (precedence: beats a RETIRED status)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      // Asset is BOTH kit-owned AND retired — the kit guard must win (runs first).
      await ctx.db.insert("assets", { id: "ak", organizationId: ORG, modelId: "m1", assetTag: "A-K", status: "RETIRED", isActive: true, kitId: "k1" });
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-9", name: "L", status: "AVAILABLE", condition: "GOOD", isActive: true });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, enfArgs({ modelId: "m1", assetId: "ak", quantity: 1 })),
    ).rejects.toThrow(/Kit KIT-9/);
  });

  test("asset path throws ASSET_DOUBLE_BOOKED on a dated overlap (via a line booking)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY });
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Festival", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW + DAY, rentalEndDate: NOW + 3 * DAY });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "A-2", status: "AVAILABLE", isActive: true });
      // A2 already booked on the overlapping project P2 via a legacy line.assetId row.
      await ctx.db.insert("projectLineItems", { id: "lp2", organizationId: ORG, projectId: "p2", modelId: "m1", assetId: "a2", type: "EQUIPMENT", quantity: 1, status: "CONFIRMED", isKitChild: false });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, enfArgs({ modelId: "m1", assetId: "a2", quantity: 1 })),
    ).rejects.toThrow(/booked on P2 — Festival during those dates/);
  });

  test("asset path throws ASSET_UNAVAILABLE for a RETIRED asset (not kit, not double-booked)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a3", organizationId: ORG, modelId: "m1", assetTag: "A-3", status: "RETIRED", isActive: true });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, enfArgs({ modelId: "m1", assetId: "a3", quantity: 1 })),
    ).rejects.toThrow(/marked retired/);
  });
});

describe("lineItemWrites.patchNative availability enforcement", () => {
  const pargs = { id: "li1", orgId: ORG, entityName: "Light", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW };
  // Dateless project, SERIALIZED model with 3 active assets, one existing line (li1)
  // on the project booking `oldQty` of the model.
  async function seed(t: ReturnType<typeof makeT>, oldQty: number) {
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("assets", { id: `a${i}`, organizationId: ORG, modelId: "m1", assetTag: `A-${i}`, status: "AVAILABLE", isActive: true });
      }
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: oldQty, status: "CONFIRMED", isKitChild: false });
    });
  }

  test("throws on a qty increase that exceeds available (delta > free)", async () => {
    const t = makeT();
    await seed(t, 1); // 3 stock, this line booked 1 → 2 free; delta 5-1=4 > 2
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 5, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/Only 2 of 4 requested are free/);
  });

  test("allows a resize that exactly fills stock (boundary: delta == free)", async () => {
    const t = makeT();
    await seed(t, 1); // 3 stock, 1 booked → 2 free; delta 3-1=2 == 2 → allowed
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 3, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(3);
    });
  });

  test("allows a qty DECREASE without an availability check", async () => {
    const t = makeT();
    await seed(t, 3); // decrease 3 → 1: gate is newQty > currentQty, so it's skipped
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 1, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(1);
    });
  });

  test("qty increase SUCCEEDS with allowOverbook:true", async () => {
    const t = makeT();
    await seed(t, 1);
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, allowOverbook: true, set: { quantity: 9, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(9);
    });
  });

  test("model CHANGE compares FULL newQty (not delta) against the new model", async () => {
    const t = makeT();
    await seed(t, 1); // line is on m1 (3 stock)
    await t.run(async (ctx) => {
      // A second model with only 2 stock; the line is NOT booked against it.
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Fresnel", assetType: "SERIALIZED" });
      for (let i = 0; i < 2; i++) await ctx.db.insert("assets", { id: `b${i}`, organizationId: ORG, modelId: "m2", assetTag: `B-${i}`, status: "AVAILABLE", isActive: true });
    });
    // Switch to m2 and request 3 — m2 has 2 free, line not in m2's booked → full 3 > 2 → throw.
    // (A delta check 3-1=2 would have WRONGLY allowed it.)
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 3, modelId: "m2", updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/Only 2 of 3 requested are free/);
  });

  test("CLEARING modelId skips enforcement (converting to a custom line)", async () => {
    const t = makeT();
    await seed(t, 3); // fully booked on m1
    // Clear modelId + bump qty: the server skips enforcement when there's no model, so must we.
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 8, updatedAt: NOW }, clear: ["modelId"] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(8);
      expect(li?.modelId).toBeUndefined();
    });
  });
});

describe("lineItemWrites availability org-isolation", () => {
  test("a cross-org asset sharing the modelId does NOT inflate available stock", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      // Our org: exactly 1 active asset for the model.
      await ctx.db.insert("assets", { id: "mine", organizationId: ORG, modelId: "m1", assetTag: "A-0", status: "AVAILABLE", isActive: true });
      // ANOTHER org: an asset with the SAME modelId (by_modelId is global). Must not count.
      await ctx.db.insert("assets", { id: "theirs", organizationId: "org_other", modelId: "m1", assetTag: "X-0", status: "AVAILABLE", isActive: true });
    });
    // Adding qty 2 must fail — only 1 unit is ours, despite 2 assets sharing the modelId.
    const aargs = { id: "new1", organizationId: ORG, projectId: "p1", fields: { type: "EQUIPMENT" as const, modelId: "m1", description: "PAR", quantity: 2 }, includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW };
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, aargs),
    ).rejects.toThrow(/Only 1 of 2 requested are free/);
  });
});

describe("lineItemWrites.addKitNative", () => {
  const kargs = { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", pricingMode: "KIT_PRICE" as const, unitPrice: 500, kitLabel: "KIT-1 - Lighting", emitActivity: true, actor: ACTOR, auditId: "log1", now: NOW };
  test("member adds a kit (parent + member child lines) + CREATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, kargs);
    await t.run(async (ctx) => {
      const parent = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kl1")).first();
      expect(parent?.kitId).toBe("k1");
      expect(parent?.isKitChild).toBeUndefined();
      const children = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "kl1")).collect();
      expect(children).toHaveLength(1); // the serialized member
      expect(children[0].assetId).toBe("a1");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      expect(log?.kitId).toBe("k1");
      // Collab feed folded into the mutation — one member → "1 item".
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      const added = events.find((e) => e.action === "kit_added");
      expect(added?.summary).toBe('added kit "KIT-1 - Lighting" (1 item)');
      expect(added?.targetId).toBe("kl1");
    });
  });
  test("emitActivity:false suppresses the kit_added collab event", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, { ...kargs, emitActivity: false });
    await t.run(async (ctx) => {
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      expect(events.find((e) => e.action === "kit_added")).toBeUndefined();
      // The CREATE audit still fires (only the collab feed is gated).
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await t.run(async (ctx) => { await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, kargs)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a non-finite unitPrice (would poison recalc to NaN)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => { await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, { ...kargs, unitPrice: Number.NaN }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      const parent = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kl1")).first();
      expect(parent).toBeNull(); // nothing inserted
    });
  });

  test("throws KIT_UNAVAILABLE when the kit is IN_MAINTENANCE (unconditional)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "IN_MAINTENANCE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, kargs),
    ).rejects.toThrow(/KIT-1 is in maintenance/i);
  });

  test("throws KIT_DOUBLE_BOOKED on a dated overlap with another project", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      // Target project (dated).
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 86_400_000 });
      // Another overlapping project already has the kit booked (parent line).
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Other", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 86_400_000 });
      await ctx.db.insert("projectLineItems", { id: "kl0", organizationId: ORG, projectId: "p2", kitId: "k1", type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, kargs),
    ).rejects.toThrow(/KIT-1 is on P2/i);
  });
});

describe("lineItemWrites bulk-size cap", () => {
  // Array size, not per-item body, so build cheap oversized arrays inline.
  const bigIds = Array.from({ length: 501 }, (_, i) => `id-${i}`);

  test("removeManyNative rejects an oversized ids array (DoS amplification guard)", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.removeManyNative, { ids: bigIds, orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW }),
    ).rejects.toThrow(/exceeds the 500-item limit/i);
  });

  test("patchManyNative rejects an oversized ids array", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchManyNative, { ids: bigIds, orgId: ORG, patch: {}, actor: ACTOR, auditId: "log1", now: NOW }),
    ).rejects.toThrow(/exceeds the 500-item limit/i);
  });

  test("reorderNative rejects an oversized items array", async () => {
    const t = makeT();
    await member(t, "member");
    const items = bigIds.map((id, i) => ({ id, sortOrder: i }));
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.reorderNative, { orgId: ORG, items, now: NOW }),
    ).rejects.toThrow(/exceeds the 500-item limit/i);
  });
});

describe("lineItemWrites.reorderNative", () => {
  test("member reorders lines (sortOrder/groupName) + org-scoped", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "l2", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, sortOrder: 1 });
      await ctx.db.insert("projectLineItems", { id: "lOther", organizationId: "org_other", projectId: "p9", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, sortOrder: 5 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.reorderNative, { orgId: ORG, items: [{ id: "l2", sortOrder: 0 }, { id: "l1", sortOrder: 1, groupName: "Stage" }, { id: "lOther", sortOrder: 0 }], now: NOW });
    await t.run(async (ctx) => {
      const l1 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "l1")).first();
      const l2 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "l2")).first();
      const other = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "lOther")).first();
      expect(l1?.sortOrder).toBe(1);
      expect(l1?.groupName).toBe("Stage");
      expect(l2?.sortOrder).toBe(0);
      expect(other?.sortOrder).toBe(5); // cross-org row untouched
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.reorderNative, { orgId: ORG, items: [], now: NOW })).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.addLineItemSmartNative", () => {
  const smartArgs = (
    fields: Record<string, unknown>,
    opts?: { over?: boolean; sep?: boolean; acc?: boolean; id?: string },
  ) => ({
    id: opts?.id ?? "sm1",
    organizationId: ORG,
    projectId: "p1",
    fields: { type: "EQUIPMENT" as const, quantity: 1, pricingType: "PER_DAY" as const, ...fields },
    allowOverbook: opts?.over ?? false,
    forceSeparate: opts?.sep ?? false,
    includeAccessories: opts?.acc ?? false,
    actor: ACTOR,
    auditId: "log1",
    // The new app passes this so the mutation emits the folded collab/webhook side
    // effects; the collab/webhook assertions below depend on it firing.
    emitSideEffects: true,
    now: NOW,
  });

  const seedProjectModel = async (
    t: ReturnType<typeof makeT>,
    modelExtra: Record<string, unknown> = {},
    projExtra: Record<string, unknown> = {},
  ) => {
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0, ...projExtra });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED", ...modelExtra });
    });
  };

  test("auto-pricing: PER_DAY, no manual price → dailyRate × rentalQuantity → lineTotal", async () => {
    const t = makeT();
    // dailyRate 20, project default rental quantity 3.
    await seedProjectModel(t, { dailyRate: 20 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 3 });
    const res = await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 2 }, { over: true }),
    );
    expect(res.merged).toBe(false);
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "sm1")).first();
      expect(li?.unitPrice).toBe(20);
      expect(li?.duration).toBe(3); // rentalQuantity
      expect(li?.lineTotal).toBe(120); // 20 × 2 × 3
      // Collab feed folded into the mutation (insert path).
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      const added = events.find((e) => e.action === "line_item_added");
      expect(added?.targetId).toBe("sm1");
      expect(added?.summary).toBe("added a line item"); // no description → fallback
    });
  });

  test("auto-pricing: WEEKLY period uses weeklyRate", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 20, weeklyRate: 50 }, { defaultRentalPeriod: "WEEKLY", defaultRentalQuantity: 1 });
    await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 2 }, { over: true }),
    );
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "sm1")).first();
      expect(li?.unitPrice).toBe(50);
      expect(li?.lineTotal).toBe(100); // 50 × 2 × 1
    });
  });

  test("manual price is kept (no auto-pricing)", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 20 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 3 });
    await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 2, unitPrice: 15, duration: 1 }, { over: true }),
    );
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "sm1")).first();
      expect(li?.unitPrice).toBe(15); // manual kept, not auto 20
      expect(li?.duration).toBe(1);
      expect(li?.lineTotal).toBe(30); // 15 × 2 × 1
    });
  });

  test("merge-dedup: same model/group/category merges quantity + recomputes lineTotal + joins notes", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 20 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Stage", suggestedPrice: 0, sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "ex", organizationId: ORG, projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: 2, unitPrice: 10, duration: 1, groupId: "g1", status: "CONFIRMED", isKitChild: false, notes: "first" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 3, groupId: "g1", notes: "second" }, { over: true }),
    );
    expect(res.merged).toBe(true);
    expect(res.id).toBe("ex");
    await t.run(async (ctx) => {
      const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect()).filter((l) => l.modelId === "m1");
      expect(lines).toHaveLength(1); // merged, no new row
      const ex = lines[0];
      expect(ex.quantity).toBe(5); // 2 + 3
      expect(ex.lineTotal).toBe(50); // 10 × 5 × 1
      expect(ex.notes).toBe("first; second");
      // No sm1 row was inserted.
      const sm = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "sm1")).first();
      expect(sm).toBeNull();
      // Collab feed folded into the mutation — merge path emits line_item_added on the
      // EXISTING line id (parity with the server, which read back existing.id).
      const events = await ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", "p1")).collect();
      const added = events.find((e) => e.action === "line_item_added");
      expect(added?.targetId).toBe("ex");
    });
  });

  test("webhook: line_item.added is enqueued to an active subscription (insert path)", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 20 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      // An active endpoint subscribed to line_item.added.
      await ctx.db.insert("webhooks", { id: "wh1", organizationId: ORG, description: "Zapier", url: "https://example.test/hook", events: JSON.stringify(["line_item.added"]), secret: "s", isActive: true, createdById: USER, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 2, description: "PAR Can" }, { over: true }),
    );
    await t.run(async (ctx) => {
      const deliveries = await ctx.db.query("webhookDeliveries").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].event).toBe("line_item.added");
      expect(deliveries[0].status).toBe("PENDING");
      const payload = JSON.parse(deliveries[0].payload);
      expect(payload).toMatchObject({ projectId: "p1", lineItemId: "sm1", modelId: "m1", quantity: 2, type: "EQUIPMENT", description: "PAR Can" });
    });
  });

  test("webhook: nothing enqueued when no active subscription matches", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 20 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 1 }, { over: true }),
    );
    await t.run(async (ctx) => {
      const deliveries = await ctx.db.query("webhookDeliveries").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect();
      expect(deliveries).toHaveLength(0);
    });
  });

  test("forceSeparate: inserts a new row instead of merging", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 20 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "ex", organizationId: ORG, projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: 2, unitPrice: 10, duration: 1, status: "CONFIRMED", isKitChild: false });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 3 }, { over: true, sep: true }),
    );
    expect(res.merged).toBe(false);
    await t.run(async (ctx) => {
      const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect()).filter((l) => l.modelId === "m1");
      expect(lines).toHaveLength(2); // separate row created
    });
  });

  test("group-suggested-price is recomputed + persisted onto the group", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 10 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Stage", suggestedPrice: 0, sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 2, groupId: "g1" }, { over: true }),
    );
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.suggestedPrice).toBe(20); // dailyRate 10 × qty 2 × rentalQuantity 1
    });
  });

  test("availability: throws INSUFFICIENT_STOCK when qty exceeds free stock", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED", dailyRate: 10 });
      for (let i = 0; i < 3; i++) await ctx.db.insert("assets", { id: `a${i}`, organizationId: ORG, modelId: "m1", assetTag: `A-${i}`, status: "AVAILABLE", isActive: true });
      await ctx.db.insert("projectLineItems", { id: "booked", organizationId: ORG, projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: 3, status: "CONFIRMED", isKitChild: false });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, smartArgs({ modelId: "m1", quantity: 1 })),
    ).rejects.toThrow(/Only 0 of 1 requested are free/);
  });

  test("availability: allowOverbook bypasses enforcement", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED", dailyRate: 10 });
      for (let i = 0; i < 3; i++) await ctx.db.insert("assets", { id: `a${i}`, organizationId: ORG, modelId: "m1", assetTag: `A-${i}`, status: "AVAILABLE", isActive: true });
      await ctx.db.insert("projectLineItems", { id: "booked", organizationId: ORG, projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: 3, status: "CONFIRMED", isKitChild: false });
    });
    // forceSeparate so we exercise the insert path (not a merge into the booked line).
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, smartArgs({ modelId: "m1", quantity: 1 }, { over: true, sep: true }));
    expect(res.merged).toBe(false);
  });

  test("accessory expansion: model bulk accessory becomes a child line (qty × parent)", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 10 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, modelId: "m2", assetTag: "BA-1", isActive: true });
      await ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: ORG, modelId: "m1", bulkAssetId: "ba1", quantity: 2, addedById: USER });
    });
    await t.withIdentity(asUser(ORG)).mutation(
      api.lineItemWrites.addLineItemSmartNative,
      smartArgs({ modelId: "m1", quantity: 3 }, { over: true, acc: true }),
    );
    await t.run(async (ctx) => {
      const children = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "sm1")).collect();
      expect(children).toHaveLength(1);
      expect(children[0].childKind).toBe("ACCESSORY");
      expect(children[0].bulkAssetId).toBe("ba1");
      expect(children[0].quantity).toBe(6); // 2 × parent qty 3
    });
  });

  test("cross-org modelId is rejected (by_cuid is global)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      // Model belongs to ANOTHER org.
      await ctx.db.insert("models", { id: "m1", organizationId: "org_other", name: "PAR", assetType: "SERIALIZED", dailyRate: 10 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, smartArgs({ modelId: "m1", quantity: 1 }, { over: true })),
    ).rejects.toThrow(/not found in your organization/);
  });

  test("cross-org groupId is rejected", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 10 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: "org_other", projectId: "px", title: "X", suggestedPrice: 0, sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, smartArgs({ modelId: "m1", quantity: 1, groupId: "g1" }, { over: true })),
    ).rejects.toThrow(/not found in your organization/);
  });

  test("dup-guard: a reused client id is rejected", async () => {
    const t = makeT();
    await seedProjectModel(t, { dailyRate: 10 }, { defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "sm1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, status: "CONFIRMED", isKitChild: false, description: "existing" });
    });
    // forceSeparate so we skip the merge path and reach the insert dup-guard.
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, smartArgs({ modelId: "m1", quantity: 1 }, { over: true, sep: true })),
    ).rejects.toThrow(/already exists/);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, smartArgs({ modelId: "m1", quantity: 1 }, { over: true })),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.recalcNative", () => {
  test("member recomputes + persists project totals (one round-trip)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 100 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.recalcNative, { projectId: "p1", orgId: ORG, now: NOW + 5 });
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.subtotal).toBe(100);
    expect(p?.taxAmount).toBe(10); // 10% of 100
    expect(p?.total).toBe(110);
    expect(p?.updatedAt).toBe(NOW + 5);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.recalcNative, { projectId: "p1", orgId: ORG, now: NOW })).rejects.toThrow(/insufficient permissions/i);
  });
});
