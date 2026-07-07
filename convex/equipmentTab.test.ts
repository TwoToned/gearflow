// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// import.meta.glob typed via convex/import-meta-glob.d.ts (see convex/rbac.test.ts).
const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string | null) => ({ subject: USER, ...(orgId ? { orgId } : {}) });

async function seedViewer(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
  });
}

describe("equipmentTab.bundle — auth gating + shape", () => {
  test("denies anonymous", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.equipmentTab.bundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/authentication required/i);
  });

  test("denies a non-member", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser(ORG)).query(api.equipmentTab.bundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/not a member/i);
  });

  test("allows a viewer (project:read) and returns all view-data keys", async () => {
    const t = convexTest(schema, modules);
    await seedViewer(t);
    const res = await t
      .withIdentity(asUser(ORG))
      .query(api.equipmentTab.bundle, { projectId: "p1", orgId: ORG });
    for (const k of [
      "lineItems", "categories", "groups", "categorySlots", "subHires",
      "subHireGroups", "subHireItems", "assets", "bulkAssets", "kits",
      "models", "suppliers", "orgCategories",
    ]) {
      expect(res).toHaveProperty(k);
      expect(Array.isArray((res as Record<string, unknown>)[k])).toBe(true);
    }
  });

  test("service identity is allowed", async () => {
    const t = convexTest(schema, modules);
    const res = await t
      .withIdentity(SERVICE)
      .query(api.equipmentTab.bundle, { projectId: "p1", orgId: ORG });
    expect(res.lineItems).toEqual([]);
  });

  test("never carries user PII / file storageKey (§3.5 no-leak guard)", async () => {
    const t = convexTest(schema, modules);
    await seedViewer(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.equipmentTab.bundle, { projectId: "p1", orgId: ORG });
    // No `users`/`fileUploads` are joined here; guard against a future one leaking
    // an S3 storage key or Better-Auth PII.
    expect(res).not.toHaveProperty("users");
    expect(res).not.toHaveProperty("files");
    const forbidden = ["storageKey", "email", "emailVerified", "banReason", "twoFactorEnabled"];
    const scan = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(scan);
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          expect(forbidden).not.toContain(k);
          scan(v);
        }
      }
    };
    scan(res);
  });
});
