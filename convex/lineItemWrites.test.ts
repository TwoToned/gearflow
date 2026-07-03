// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };
const args = { id: "li1", orgId: ORG, orgDefaultTaxRate: null, actor: ACTOR, auditId: "log1", now: NOW };

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role }); });
}

describe("lineItemWrites.removeNative", () => {
  test("member removes a leaf line + its units + DELETE audit", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Light", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", assetId: "a1", ordinal: 0 });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.removeNative, args);
    expect(res.projectId).toBe("p1");
    await t.run(async (ctx) => {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(line).toBeNull();
      const units = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "li1")).collect();
      expect(units).toHaveLength(0);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
      expect(log?.entityType).toBe("lineItem");
    });
  });

  test("cascade-removes children (+ their units)", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: true, childKind: "KIT" });
    });
    await expect(t.withIdentity(SERVICE).mutation(api.lineItemWrites.removeNative, args)).rejects.toThrow(/part of a Kit/i);
  });

  test("blocks removing an accessory child directly (ACCESSORY_CHILD)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: true, childKind: "ACCESSORY" });
    });
    await expect(t.withIdentity(SERVICE).mutation(api.lineItemWrites.removeNative, args)).rejects.toThrow(/accessory/i);
  });

  test("a viewer is denied (project:manage_line_items)", async () => {
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.removeNative, args)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.patchNative", () => {
  const pargs = { id: "li1", orgId: ORG, orgDefaultTaxRate: null, entityName: "Light", actor: ACTOR, auditId: "log1", now: NOW };
  test("member patches fields + UPDATE audit", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Light", quantity: 1, status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { quantity: 3, unitPrice: 50, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.quantity).toBe(3);
      expect(li?.unitPrice).toBe(50);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.entityType).toBe("lineItem");
    });
  });
  test("clear removes a field", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, { ...pargs, set: { updatedAt: NOW }, clear: [] })).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.addCustomNative", () => {
  const cargs = { id: "cust1", organizationId: ORG, projectId: "p1", fields: { description: "Rigging labour", quantity: 1, unitPrice: 200 }, orgDefaultTaxRate: null, actor: ACTOR, auditId: "log1", now: NOW };
  test("member adds a custom line (sortOrder computed) + CREATE audit", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "existing", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, sortOrder: 4 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addCustomNative, cargs);
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "cust1")).first();
      expect(li?.isCustomItem).toBe(true);
      expect(li?.sortOrder).toBe(5); // max(4)+1
      expect(li?.description).toBe("Rigging labour");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
    });
  });
  test("viewer denied", async () => {
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addCustomNative, cargs)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.addNative", () => {
  const aargs = { id: "new1", organizationId: ORG, projectId: "p1", fields: { type: "EQUIPMENT" as const, description: "PAR Can", quantity: 2, unitPrice: 15 }, includeAccessories: false, orgDefaultTaxRate: null, actor: ACTOR, auditId: "log1", now: NOW };
  test("member adds an inventory line (sortOrder in-mutation) + CREATE audit", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, aargs)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.addKitNative", () => {
  const kargs = { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", pricingMode: "KIT_PRICE" as const, unitPrice: 500, kitLabel: "KIT-1 - Lighting", orgDefaultTaxRate: null, actor: ACTOR, auditId: "log1", now: NOW };
  test("member adds a kit (parent + member child lines) + CREATE audit", async () => {
    const t = convexTest(schema, modules);
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
    });
  });
  test("viewer denied", async () => {
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await t.run(async (ctx) => { await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addKitNative, kargs)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.reorderNative", () => {
  test("member reorders lines (sortOrder/groupName) + org-scoped", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.reorderNative, { orgId: ORG, items: [], now: NOW })).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("lineItemWrites.recalcNative", () => {
  test("member recomputes + persists project totals (one round-trip)", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 100 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.recalcNative, { projectId: "p1", orgId: ORG, orgDefaultTaxRate: null, now: NOW + 5 });
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.subtotal).toBe(100);
    expect(p?.taxAmount).toBe(10); // 10% of 100
    expect(p?.total).toBe(110);
    expect(p?.updatedAt).toBe(NOW + 5);
  });

  test("viewer denied", async () => {
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.recalcNative, { projectId: "p1", orgId: ORG, orgDefaultTaxRate: null, now: NOW })).rejects.toThrow(/insufficient permissions/i);
  });
});
