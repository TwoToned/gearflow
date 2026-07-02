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

async function seedKit(t: ReturnType<typeof convexTest>, role?: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("kits", {
      id: "k1",
      organizationId: ORG,
      assetTag: "KIT-1",
      name: "Lighting Kit",
      status: "AVAILABLE",
      condition: "GOOD",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    if (role) await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
  });
}

describe("kitWrites.createNative", () => {
  const createArgs = {
    id: "new1", organizationId: ORG, assetTag: "KIT-2", name: "Audio Kit",
    status: "AVAILABLE" as const, condition: "GOOD" as const,
    createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1",
  };

  test("a manager creates a kit + writes the CREATE audit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.createNative, createArgs);
    expect(res.id).toBe("new1");
    await t.run(async (ctx) => {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "new1")).first();
      expect(kit?.name).toBe("Audio Kit");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      expect(log?.kitId).toBe("new1");
    });
  });

  test("rejects a duplicate asset tag", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t); // KIT-1
    await expect(
      t.withIdentity(SERVICE).mutation(api.kitWrites.createNative, { ...createArgs, assetTag: "KIT-1" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (kit:create)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "viewer" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.kitWrites.createNative, createArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("kitWrites.updateNative", () => {
  const updArgs = { id: "k1", orgId: ORG, patch: { name: "Renamed", status: "IN_MAINTENANCE" as const, updatedAt: NOW }, actor: ACTOR, auditId: "log1", now: NOW };

  test("applies patch + writes the UPDATE audit", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.withIdentity(SERVICE).mutation(api.kitWrites.updateNative, updArgs);
    await t.run(async (ctx) => {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      expect(kit?.name).toBe("Renamed");
      expect(kit?.status).toBe("IN_MAINTENANCE");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
    });
  });

  test("rejects a tag change that collides", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k2", organizationId: ORG, assetTag: "TAKEN", name: "Other", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.kitWrites.updateNative, { ...updArgs, patch: { assetTag: "TAKEN", updatedAt: NOW } }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (kit:update)", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.kitWrites.updateNative, updArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("kitWrites.updateNotesNative", () => {
  test("patches notes + audit; clears on null", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.withIdentity(SERVICE).mutation(api.kitWrites.updateNotesNative, { id: "k1", orgId: ORG, notes: "spare fuse inside", actor: ACTOR, auditId: "log1", now: NOW });
    await t.run(async (ctx) => {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      expect(kit?.notes).toBe("spare fuse inside");
    });
    await t.withIdentity(SERVICE).mutation(api.kitWrites.updateNotesNative, { id: "k1", orgId: ORG, notes: null, actor: ACTOR, auditId: "log2", now: NOW });
    await t.run(async (ctx) => {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      expect(kit?.notes).toBeUndefined();
    });
  });
});

describe("kitWrites.archiveNative / deleteNative", () => {
  const args = { id: "k1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };
  test("owner archives an AVAILABLE kit + releases members + audit", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t, "owner");
    await t.run(async (ctx) => { await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER }); });
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.archiveNative, args);
    await t.run(async (ctx) => {
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      expect(kit?.status).toBe("RETIRED");
      expect(kit?.isActive).toBe(false);
      const members = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect();
      expect(members).toHaveLength(0); // released
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
    });
  });
  test("owner deletes an AVAILABLE kit", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t, "owner");
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.deleteNative, args);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first()).toBeNull();
    });
  });
  test("blocks archive of a non-AVAILABLE kit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => { await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(SERVICE).mutation(api.kitWrites.archiveNative, args)).rejects.toThrow(/AVAILABLE/i);
  });
  test("a manager (no kit:delete) is denied", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t, "manager");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.kitWrites.deleteNative, args)).rejects.toThrow(/insufficient permissions/i);
  });
});
