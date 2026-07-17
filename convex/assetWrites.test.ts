// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
// Mount both components: the rate limiter (updateNotesNative) and the sharded counter
// (create/archive/delete go through bumpAssetCounters → the sharded counter, gate #3).
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

const baseArgs = {
  id: "a1",
  orgId: ORG,
  notes: "checked bulb",
  actor: ACTOR,
  auditId: "log1",
  now: NOW,
};

async function seedAsset(t: ReturnType<typeof convexTest>, role?: string, orgOfAsset = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", {
      id: "a1",
      organizationId: orgOfAsset,
      modelId: "m1",
      assetTag: "TAG-1",
      status: "AVAILABLE",
      condition: "GOOD",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    if (role) {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
    }
  });
}

describe("assetWrites.updateNotesNative — RBAC (5a)", () => {
  test("service identity is allowed and patches notes + writes the audit row (5c)", async () => {
    const t = makeT();
    await seedAsset(t);
    const res = await t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, baseArgs);
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.notes).toBe("checked bulb");
      expect(asset?.updatedAt).toBe(NOW);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log).toMatchObject({
        action: "UPDATE",
        entityType: "asset",
        entityId: "a1",
        entityName: "TAG-1",
        assetId: "a1",
        userId: USER,
        userName: "Alice",
        organizationId: ORG,
      });
    });
  });

  test("a member (has asset:update) is allowed", async () => {
    const t = makeT();
    await seedAsset(t, "member");
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, baseArgs);
    expect(res.ok).toBe(true);
  });

  test("a viewer (read-only) is denied asset:update", async () => {
    const t = makeT();
    await seedAsset(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("a non-member is denied", async () => {
    const t = makeT();
    await seedAsset(t); // no member row
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/not a member/i);
  });

  test("a user whose token org != the requested org is denied (org-scoping)", async () => {
    const t = makeT();
    await seedAsset(t, "member");
    await expect(
      t.withIdentity(asUser("org_other")).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("clears notes when null", async () => {
    const t = makeT();
    await seedAsset(t);
    await t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, { ...baseArgs, notes: null });
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.notes).toBeUndefined();
    });
  });
});

describe("assetWrites.updateNotesNative — invariants (5b)", () => {
  test("rejects when the asset belongs to a different org than requested", async () => {
    const t = makeT();
    // Caller is a service token (RBAC passes), but the asset row is in another org.
    await seedAsset(t, undefined, "org_other");
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("throws a ConvexError when the asset is missing", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/not found/i);
  });
});

const archiveArgs = { id: "a1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };

describe("assetWrites.archiveNative", () => {
  test("retires the asset + linked T&T and writes an audit row", async () => {
    const t = makeT();
    await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, assetId: "a1", testTagId: "TAG-1", description: "TAG-1", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(SERVICE).mutation(api.assetWrites.archiveNative, archiveArgs);
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.isActive).toBe(false);
      expect(asset?.status).toBe("RETIRED");
      const tt = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first();
      expect(tt?.status).toBe("RETIRED");
      expect(tt?.isActive).toBe(false);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toMatch(/Archived asset/);
    });
  });

  test("a viewer is denied (asset:update)", async () => {
    const t = makeT();
    await seedAsset(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.archiveNative, archiveArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

const deleteArgs = { id: "a1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };

describe("assetWrites.deleteNative — RBAC + orphan guards (5b)", () => {
  test("owner deletes a free asset + writes the DELETE audit", async () => {
    const t = makeT();
    await seedAsset(t, "owner");
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.deleteNative, deleteArgs);
    expect(res.id).toBe("a1");
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset).toBeNull();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
    });
  });

  test("a manager (no asset:delete) is denied", async () => {
    const t = makeT();
    await seedAsset(t, "manager");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.deleteNative, deleteArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("blocked when referenced by a project line item (ASSET_IN_USE)", async () => {
    const t = makeT();
    await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", assetId: "a1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.deleteNative, deleteArgs),
    ).rejects.toThrow(/referenced by project line items/i);
  });

  test("blocked when the asset is a kit member (ASSET_IN_KIT)", async () => {
    const t = makeT();
    await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.deleteNative, deleteArgs),
    ).rejects.toThrow(/part of a kit/i);
  });

  test("blocked when the asset has accessory children (ASSET_HAS_ACCESSORIES)", async () => {
    const t = makeT();
    await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "child", organizationId: ORG, modelId: "m1", assetTag: "CHILD", parentAssetId: "a1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.deleteNative, deleteArgs),
    ).rejects.toThrow(/accessories attached/i);
  });
});

describe("assetWrites.createNative", () => {
  const createArgs = {
    id: "new1", organizationId: ORG, modelId: "m1", assetTag: "NEW-1",
    status: "AVAILABLE" as const, condition: "GOOD" as const,
    createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1",
  };

  test("member creates an asset + writes the CREATE audit", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "M1" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, createArgs);
    expect(res.id).toBe("new1");
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "new1")).first();
      expect(asset?.assetTag).toBe("NEW-1");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
    });
  });

  test("rejects a duplicate asset tag (DUPLICATE_ASSET_TAG)", async () => {
    const t = makeT();
    await seedAsset(t); // seeds TAG-1
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.createNative, { ...createArgs, assetTag: "TAG-1" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (asset:create)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "viewer" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, createArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a duplicate cuid (DUPLICATE_ASSET) — replay can't insert a 2nd by_cuid row", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "M1" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, createArgs);
    // Same id, different tag (so it's the id guard firing, not the tag guard).
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, { ...createArgs, assetTag: "NEW-2", auditId: "log2" }),
    ).rejects.toThrow(/already exists/i);
    const rows = await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "new1")).collect());
    expect(rows).toHaveLength(1); // still exactly one row
  });

  test("rejects a non-finite purchasePrice", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, { ...createArgs, purchasePrice: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(/finite/i);
  });
});

describe("assetWrites.updateNative", () => {
  const updArgs = { id: "a1", orgId: ORG, set: { assetTag: "TAG-1", status: "IN_MAINTENANCE" as const, updatedAt: NOW }, clear: [] as string[], actor: ACTOR, auditId: "log1", now: NOW };

  test("applies set + writes the UPDATE audit", async () => {
    const t = makeT();
    await seedAsset(t);
    await t.withIdentity(SERVICE).mutation(api.assetWrites.updateNative, updArgs);
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.status).toBe("IN_MAINTENANCE");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
    });
  });

  test("clear removes an optional field", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", condition: "GOOD", isActive: true, notes: "old", createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(SERVICE).mutation(api.assetWrites.updateNative, { ...updArgs, set: { updatedAt: NOW }, clear: ["notes"] });
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(asset?.notes).toBeUndefined();
    });
  });

  test("rejects a tag change that collides with another asset (DUPLICATE_ASSET_TAG)", async () => {
    const t = makeT();
    await seedAsset(t); // a1 / TAG-1
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "TAKEN", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.updateNative, { ...updArgs, set: { assetTag: "TAKEN", updatedAt: NOW } }),
    ).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (asset:update)", async () => {
    const t = makeT();
    await seedAsset(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNative, updArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("assetWrites — Phase 3 folds (counter + T&T)", () => {
  const createArgs = {
    id: "cA", organizationId: ORG, modelId: "mTT", assetTag: "PA-1", status: "AVAILABLE" as const,
    condition: "GOOD" as const, isActive: true, createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1",
  };
  async function seedManager(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" }); });
  }

  test("createNative advances the tag counter + auto-registers T&T for a T&T model", async () => {
    const t = makeT(); await seedManager(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mTT", organizationId: ORG, name: "PA", requiresTestAndTag: true, testAndTagIntervalDays: 90 }); });
    await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, createArgs);
    const settings = await t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first());
    expect(JSON.parse(settings!.settings!).assetTagCounter).toBe(1);
    const tt = await t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", "cA")).collect());
    expect(tt).toHaveLength(1);
    expect(tt[0].testTagId).toBe("PA-1");
    expect(tt[0].testIntervalMonths).toBe(3);
  });

  test("createNative does NOT register T&T when the model doesn't require it", async () => {
    const t = makeT(); await seedManager(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mTT", organizationId: ORG, name: "Cam", requiresTestAndTag: false }); });
    await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createNative, createArgs);
    const tt = await t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", "cA")).collect());
    expect(tt).toHaveLength(0);
  });
});

describe("assetWrites.updateNative updatedAt", () => {
  test("stamps updatedAt from the mutation now (both patch + clear branches)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m", assetTag: "A1", status: "AVAILABLE", condition: "GOOD", notes: "keep", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    // patch branch (no clear)
    await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNative, { id: "a1", orgId: ORG, set: { assetTag: "A1", status: "IN_MAINTENANCE", tags: [], images: [] }, clear: [], actor: ACTOR, auditId: "l1", now: NOW + 1000 });
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first()))?.updatedAt).toBe(NOW + 1000);
    // clear branch (clears notes)
    await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNative, { id: "a1", orgId: ORG, set: { assetTag: "A1", tags: [], images: [] }, clear: ["notes"], actor: ACTOR, auditId: "l2", now: NOW + 2000 });
    const d = await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(d?.updatedAt).toBe(NOW + 2000);
    expect(d?.notes).toBeUndefined();
  });
});

describe("assetWrites.createManyNative", () => {
  async function seedManager(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("models", { id: "mTT", organizationId: ORG, name: "PA", requiresTestAndTag: true });
    });
  }
  test("creates N assets + counter(N) + per-asset T&T + dup-tag guard", async () => {
    const t = makeT(); await seedManager(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createManyNative, {
      orgId: ORG, now: NOW, actor: ACTOR,
      assets: [
        { id: "b1", auditId: "l1", modelId: "mTT", assetTag: "PA-1" },
        { id: "b2", auditId: "l2", modelId: "mTT", assetTag: "PA-2" },
      ],
    });
    expect(res.ids).toEqual(["b1", "b2"]);
    const settings = await t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first());
    expect(JSON.parse(settings!.settings!).assetTagCounter).toBe(2);
    const tt = await t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
    expect(tt).toHaveLength(2);
    // dup tag rejected
    await expect(t.withIdentity(asUser(ORG)).mutation(api.assetWrites.createManyNative, { orgId: ORG, now: NOW, actor: ACTOR, assets: [{ id: "b3", auditId: "l3", modelId: "mTT", assetTag: "PA-1" }] })).rejects.toThrow(/already exists/i);
  });
});

describe("assetWrites.bulkUpdateNative / bulkTagNative", () => {
  async function seed(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m", assetTag: "A1", status: "AVAILABLE", condition: "GOOD", tags: ["x"], isActive: true });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m", assetTag: "A2", status: "AVAILABLE", condition: "GOOD", isActive: true });
      await ctx.db.insert("assets", { id: "aX", organizationId: "org_2", modelId: "m", assetTag: "Z", status: "AVAILABLE", condition: "GOOD", isActive: true });
    });
  }
  test("bulkUpdate applies set + org re-check (foreign skipped)", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.bulkUpdateNative, { orgId: ORG, ids: ["a1", "a2", "aX"], set: { status: "IN_MAINTENANCE" }, clear: [], now: NOW });
    expect(res.count).toBe(2);
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first()))?.status).toBe("IN_MAINTENANCE");
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "aX")).first()))?.status).toBe("AVAILABLE");
  });
  test("bulkTag unions tags idempotently", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.bulkTagNative, { orgId: ORG, ids: ["a1", "a2"], tags: ["x", "y"], now: NOW });
    expect(res.count).toBe(2);
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first()))?.tags).toEqual(["x", "y"]);
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a2")).first()))?.tags).toEqual(["x", "y"]);
  });
});

describe("assets reads (listPage / registryPhotos)", () => {
  test("listPage: active + tag asc, model+location attached", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Cam" });
      await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "WH", type: "WAREHOUSE" });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "B", status: "AVAILABLE", condition: "GOOD", locationId: "loc1", isActive: true });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A", status: "AVAILABLE", condition: "GOOD", isActive: true });
      await ctx.db.insert("assets", { id: "a3", organizationId: ORG, modelId: "m1", assetTag: "C", status: "AVAILABLE", condition: "GOOD", isActive: false });
      await ctx.db.insert("assets", { id: "aX", organizationId: "org_2", modelId: "m1", assetTag: "Z", status: "AVAILABLE", condition: "GOOD", isActive: true });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.assets.listPage, { orgId: ORG, pageSize: 100 });
    expect(res.total).toBe(2);
    expect(res.assets.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(res.assets[0].model?.name).toBe("Cam");
    expect(res.assets[1].location?.name).toBe("WH");
  });
  test("registryPhotos: asset + model primary photo maps", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "a.jpg", fileSize: 1, mimeType: "image/jpeg", storageKey: "k", url: "http://x/a.jpg", uploadedById: USER, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assetMedia", { id: "am1", organizationId: ORG, assetId: "a1", fileId: "f1", type: "PHOTO", isPrimary: true });
      await ctx.db.insert("fileUploads", { id: "f2", organizationId: ORG, fileName: "m.jpg", fileSize: 1, mimeType: "image/jpeg", storageKey: "k2", url: "http://x/m.jpg", uploadedById: USER, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("modelMedia", { id: "mm1", organizationId: ORG, modelId: "mdl1", fileId: "f2", type: "PHOTO", isPrimary: true });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.assets.registryPhotos, { orgId: ORG });
    expect(res.assetPhotos["a1"].url).toBe("http://x/a.jpg");
    expect(res.modelPhotos["mdl1"].url).toBe("http://x/m.jpg");
  });
});
