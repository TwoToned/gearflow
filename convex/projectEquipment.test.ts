// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// import.meta.glob typed via convex/import-meta-glob.d.ts (see convex/rbac.test.ts).
const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });

/** Recursively assert no forbidden key appears anywhere in the returned bundle. */
function assertNoKeyDeep(value: unknown, forbidden: string[], path = "$") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoKeyDeep(v, forbidden, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      expect(forbidden, `${path}.${k}`).not.toContain(k);
      assertNoKeyDeep(v, forbidden, `${path}.${k}`);
    }
  }
}

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", quantity: 1 });
  });
}

describe("projectEquipment.browserBundle — no sensitive leak (§3.5)", () => {
  test("equipment bundle never carries user PII / file storageKey", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.projectEquipment.browserBundle, { projectId: "p1", orgId: ORG });
    // The bundle joins no `users`/`fileUploads`; guard the boundary against a future
    // join accidentally re-exposing an S3 storage key or Better-Auth PII.
    expect(res).not.toHaveProperty("users");
    expect(res).not.toHaveProperty("files");
    assertNoKeyDeep(res, ["storageKey", "email", "emailVerified", "banReason", "twoFactorEnabled"]);
  });
});
