// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
// Mount both components: the rate limiter (enforceBrowserWriteLimit) and the sharded
// counter (counted writes). Both are required whenever a kit mutation runs with a USER identity.
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
    const t = makeT();
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
    const t = makeT();
    await seedKit(t); // KIT-1
    await expect(
      t.withIdentity(SERVICE).mutation(api.kitWrites.createNative, { ...createArgs, assetTag: "KIT-1" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (kit:create)", async () => {
    const t = makeT();
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
    const t = makeT();
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
    const t = makeT();
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k2", organizationId: ORG, assetTag: "TAKEN", name: "Other", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.kitWrites.updateNative, { ...updArgs, patch: { assetTag: "TAKEN", updatedAt: NOW } }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (kit:update)", async () => {
    const t = makeT();
    await seedKit(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.kitWrites.updateNative, updArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("kitWrites.updateNotesNative", () => {
  test("patches notes + audit; clears on null", async () => {
    const t = makeT();
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
    const t = makeT();
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
    const t = makeT();
    await seedKit(t, "owner");
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.deleteNative, args);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first()).toBeNull();
    });
  });
  test("blocks archive of a non-AVAILABLE kit", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(SERVICE).mutation(api.kitWrites.archiveNative, args)).rejects.toThrow(/AVAILABLE/i);
  });
  test("a manager (no kit:delete) is denied", async () => {
    const t = makeT();
    await seedKit(t, "manager");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.kitWrites.deleteNative, args)).rejects.toThrow(/insufficient permissions/i);
  });

  test("createNative advances the asset-tag counter", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" }); });
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.createNative, {
      id: "kc1", organizationId: ORG, assetTag: "KIT-9", name: "K", status: "AVAILABLE", condition: "GOOD",
      createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1",
    });
    const settings = await t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first());
    expect(JSON.parse(settings!.settings!).assetTagCounter).toBe(1);
  });

  test("deleteNative blocked by a referencing line item, and cleans up checkItems/media", async () => {
    const t = makeT();
    await seedKit(t, "owner");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p", kitId: "k1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.kitWrites.deleteNative, args)).rejects.toThrow(/referenced by/i);
    // remove the reference + add kit-scoped metadata, then delete cleans them up
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first(); if (li) await ctx.db.delete(li._id);
      await ctx.db.insert("kitCheckItems", { id: "kci1", organizationId: ORG, kitId: "k1", checkItemId: "ci1", sortOrder: 0 });
      await ctx.db.insert("kitMedia", { id: "km1", organizationId: ORG, kitId: "k1", fileId: "f1" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.deleteNative, { ...args, auditId: "log2" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect()).toHaveLength(0);
      expect(await ctx.db.query("kitMedia").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect()).toHaveLength(0);
    });
  });
});

describe("kitWrites member ops", () => {
  test("addSerializedItemsNative: guards + assigns asset kitId + audit", async () => {
    const t = makeT();
    await seedKit(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m", status: "AVAILABLE", isActive: true });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.addSerializedItemsNative, {
      orgId: ORG, kitId: "k1", items: [{ assetId: "a1" }], actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect(res.ids).toHaveLength(1);
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.kitId).toBe("k1"); // coupled
      const member = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).first();
      expect(member?.assetId).toBe("a1");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
    });
  });

  test("addSerializedItemsNative rejects a non-AVAILABLE / already-kitted asset", async () => {
    const t = makeT();
    await seedKit(t, "manager");
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m", status: "CHECKED_OUT", isActive: true }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.kitWrites.addSerializedItemsNative, { orgId: ORG, kitId: "k1", items: [{ assetId: "a1" }], actor: ACTOR, auditId: "l", now: NOW })).rejects.toThrow(/not AVAILABLE/i);
  });

  test("removeSerializedItemNative releases the asset", async () => {
    const t = makeT();
    await seedKit(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m", status: "CHECKED_OUT", kitId: "k1", isActive: true });
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.removeSerializedItemNative, { orgId: ORG, kitId: "k1", assetId: "a1", actor: ACTOR, auditId: "l", now: NOW });
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.status).toBe("AVAILABLE");
      expect(asset?.kitId).toBeUndefined();
    });
  });

  test("addBulkItemNative decrements availableQuantity; removeBulkItemNative restores it", async () => {
    const t = makeT();
    await seedKit(t, "manager");
    await t.run(async (ctx) => { await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "B1", modelId: "m", status: "ACTIVE", totalQuantity: 10, availableQuantity: 10, isActive: true }); });
    const { id: memberId } = await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.addBulkItemNative, { orgId: ORG, kitId: "k1", bulkAssetId: "b1", quantity: 3, actor: ACTOR, auditId: "l1", now: NOW });
    expect((await t.run(async (ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "b1")).first()))?.availableQuantity).toBe(7);
    await t.withIdentity(asUser(ORG)).mutation(api.kitWrites.removeBulkItemNative, { orgId: ORG, kitId: "k1", bulkItemId: memberId, actor: ACTOR, auditId: "l2", now: NOW });
    expect((await t.run(async (ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "b1")).first()))?.availableQuantity).toBe(10);
  });

  test("member ops reject when the kit is not AVAILABLE", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m", status: "AVAILABLE", isActive: true });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.kitWrites.addSerializedItemsNative, { orgId: ORG, kitId: "k1", items: [{ assetId: "a1" }], actor: ACTOR, auditId: "l", now: NOW })).rejects.toThrow(/AVAILABLE/i);
  });
});

describe("kits availability reads", () => {
  test("availableAssets: AVAILABLE + unkitted + model filter, model attached", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Cam" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m1", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, assetTag: "A2", modelId: "m1", status: "AVAILABLE", kitId: "kX", isActive: true }); // kitted → excluded
      await ctx.db.insert("assets", { id: "a3", organizationId: ORG, assetTag: "A3", modelId: "m1", status: "CHECKED_OUT", isActive: true }); // not available
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.kits.availableAssets, { orgId: ORG });
    expect(res.map((a) => a.id)).toEqual(["a1"]);
    expect(res[0].model?.name).toBe("Cam");
  });

  test("availableBulkAssets: ACTIVE + availableQuantity > 0", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "B1", modelId: "m", status: "ACTIVE", availableQuantity: 5, isActive: true });
      await ctx.db.insert("bulkAssets", { id: "b2", organizationId: ORG, assetTag: "B2", modelId: "m", status: "ACTIVE", availableQuantity: 0, isActive: true }); // none available
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.kits.availableBulkAssets, { orgId: ORG });
    expect(res.map((b) => b.id)).toEqual(["b1"]);
  });
});
