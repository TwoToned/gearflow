// @vitest-environment node
//
// Cross-tenant isolation on the browser-direct line-item surface (Phase 3 security
// audit fixes). by_cuid/by_projectId are GLOBAL indexes and requireOrgRead/
// requireOrgPermission only authorize the CALLER's org — so every row fetched by a
// caller-supplied id/projectId must be re-checked against the caller's org, and the
// create paths must verify the target project belongs to the caller's org (else a
// phantom cross-org line corrupts the victim's recalculated totals).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_A";
const OTHER = "org_B";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    // A project + line item belonging to ANOTHER org.
    await ctx.db.insert("projects", { id: "projB", organizationId: OTHER, projectNumber: "B-1", name: "Foreign", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectLineItems", { id: "liB", organizationId: OTHER, projectId: "projB", description: "secret", lineTotal: 999, sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    // A project belonging to the CALLER's org.
    await ctx.db.insert("projects", { id: "projA", organizationId: ORG, projectNumber: "A-1", name: "Mine", createdAt: NOW, updatedAt: NOW });
  });
}

describe("line-item cross-tenant isolation", () => {
  test("listByIds skips a foreign-org line item", async () => {
    const t = makeT();
    await seed(t);
    const rows = await t.withIdentity(asUser).query(api.projectLineItems.listByIds, { orgId: ORG, ids: ["liB"] });
    expect(rows).toHaveLength(0); // liB belongs to org_B → not leaked
  });

  test("listByProjectIds skips a foreign-org project's line items", async () => {
    const t = makeT();
    await seed(t);
    const rows = await t.withIdentity(asUser).query(api.projectLineItems.listByProjectIds, { orgId: ORG, projectIds: ["projB"] });
    expect(rows).toHaveLength(0); // projB is org_B's → its lines not leaked
  });

  test("addCustomNative rejects inserting into a foreign-org project", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.addCustomNative, {
        id: "new1", organizationId: ORG, projectId: "projB",
        fields: { quantity: 1, lineTotal: 9_999_999 },
        actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/forbidden|another organization/i);
    // No phantom row was written into the foreign project.
    const count = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "projB")).collect()).length,
    );
    expect(count).toBe(1); // only the original liB
  });

  test("addCustomNative succeeds for the caller's own project", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.lineItemWrites.addCustomNative, {
      id: "new2", organizationId: ORG, projectId: "projA",
      fields: { quantity: 1, lineTotal: 100 },
      actor, auditId: "a2", now: NOW,
    });
    const row = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "new2")).unique());
    expect(row?.organizationId).toBe(ORG);
  });
});
