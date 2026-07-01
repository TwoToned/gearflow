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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await seedAsset(t, "member");
    const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, baseArgs);
    expect(res.ok).toBe(true);
  });

  test("a viewer (read-only) is denied asset:update", async () => {
    const t = convexTest(schema, modules);
    await seedAsset(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("a non-member is denied", async () => {
    const t = convexTest(schema, modules);
    await seedAsset(t); // no member row
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/not a member/i);
  });

  test("a user whose token org != the requested org is denied (org-scoping)", async () => {
    const t = convexTest(schema, modules);
    await seedAsset(t, "member");
    await expect(
      t.withIdentity(asUser("org_other")).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("clears notes when null", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    // Caller is a service token (RBAC passes), but the asset row is in another org.
    await seedAsset(t, undefined, "org_other");
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("throws a ConvexError when the asset is missing", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, baseArgs),
    ).rejects.toThrow(/not found/i);
  });
});
