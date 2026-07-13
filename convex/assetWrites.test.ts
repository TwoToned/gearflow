// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";

const modules = import.meta.glob("./**/*.ts");
// enforceBrowserWriteLimit (updateNotesNative) calls the rate-limiter component for
// user tokens; mount it so those paths resolve in tests. Service-token calls no-op.
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
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
