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
const args = { id: "li1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };

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
