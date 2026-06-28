// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// `import.meta.glob` (Vite/Vitest) loads all Convex modules for the in-memory
// backend. It must be called as a literal expression so Vite can statically
// transform it; its type comes from convex/import-meta-glob.d.ts (a local ambient
// decl, so tsc doesn't need `vite/client` types, which don't resolve under CI's
// pnpm hoisting).

/**
 * Integration coverage for the native read-layer RBAC guard + mirror, exercising
 * the real ctx/db inside convex-test (docs/designs/convex-native-read-layer.md §8).
 * Complements the pure decideOrgPermission unit tests (#298) by validating the
 * ctx-level paths: identity resolution, the (org,user) member lookup, custom-role
 * org-scoping + JSON.parse, and service-only mutation gating — through the public
 * `browserBundle` query and the `members` mirror mutations.
 */

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";

const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string | null, role: string | null = null) => ({
  subject: USER,
  ...(orgId ? { orgId } : {}),
  ...(role ? { role } : {}),
});

describe("requireOrgPermission (via projectEquipment.browserBundle)", () => {
  test("denies an anonymous caller", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/authentication required/i);
  });

  test("denies a user who is not a member of the org", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t
        .withIdentity(asUser(ORG))
        .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/not a member/i);
  });

  test("denies on org mismatch (token org ≠ requested org)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    });
    await expect(
      t
        .withIdentity(asUser("org_other"))
        .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("allows a viewer (has project:read) and returns the bundle shape", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    });
    const res = await t
      .withIdentity(asUser(ORG))
      .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG });
    expect(res).toHaveProperty("lineItems");
    expect(res).toHaveProperty("units");
    expect(Array.isArray(res.lineItems)).toBe(true);
  });

  test("allows the service identity unconditionally", async () => {
    const t = convexTest(schema, modules);
    const res = await t
      .withIdentity(SERVICE)
      .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG });
    expect(res).toHaveProperty("lineItems");
  });

  test("custom role WITH project:read is allowed", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("customRoles", {
        id: "cr_reader",
        organizationId: ORG,
        name: "Reader",
        permissions: JSON.stringify({ project: ["read"] }),
      });
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "custom:cr_reader" });
    });
    const res = await t
      .withIdentity(asUser(ORG))
      .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG });
    expect(res).toHaveProperty("lineItems");
  });

  test("custom role WITHOUT project:read is denied", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("customRoles", {
        id: "cr_noproj",
        organizationId: ORG,
        name: "NoProject",
        permissions: JSON.stringify({ asset: ["read"] }),
      });
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "custom:cr_noproj" });
    });
    await expect(
      t
        .withIdentity(asUser(ORG))
        .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("custom role from a DIFFERENT org does not grant (org-scoped lookup)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Same role id, but it belongs to another org — must NOT grant here.
      await ctx.db.insert("customRoles", {
        id: "cr_cross",
        organizationId: "org_other",
        name: "Reader",
        permissions: JSON.stringify({ project: ["read"] }),
      });
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "custom:cr_cross" });
    });
    await expect(
      t
        .withIdentity(asUser(ORG))
        .query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("members mirror mutations", () => {
  test("upsert requires the service identity", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t
        .withIdentity(asUser(ORG))
        .mutation(api.members.upsert, { id: "m1", organizationId: ORG, userId: USER, role: "viewer" }),
    ).rejects.toThrow(/requires the GearFlow server/i);
  });

  test("upsert is idempotent and replaces the role (one row by org+user)", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(SERVICE).mutation(api.members.upsert, {
      id: "m1", organizationId: ORG, userId: USER, role: "viewer",
    });
    await t.withIdentity(SERVICE).mutation(api.members.upsert, {
      id: "m1", organizationId: ORG, userId: USER, role: "manager",
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("manager");
  });

  test("removeByOrgAndUser clears the mirror (revocation)", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(SERVICE).mutation(api.members.upsert, {
      id: "m1", organizationId: ORG, userId: USER, role: "viewer",
    });
    await t.withIdentity(SERVICE).mutation(api.members.removeByOrgAndUser, {
      organizationId: ORG, userId: USER,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });
});
