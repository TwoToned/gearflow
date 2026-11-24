// @vitest-environment node
//
// suppliersWrites.patchNative (UX Phase 13): tags / isActive only, other fields untouched,
// per-row org re-check, RBAC, and an audit row.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Acme", email: "a@b.co", phone: "123", tags: ["old"], isActive: true });
    await ctx.db.insert("suppliers", { id: "sx", organizationId: OTHER, name: "Foreign", isActive: true });
  });
}
const get = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const as = (t: T, role: string) => t.withIdentity({ subject: USER, orgId: ORG, role });

describe("suppliersWrites.patchNative", () => {
  test("changes only tags and isActive; every other field stands; one audit row", async () => {
    const t = makeT(); await seed(t, "admin");
    await as(t, "admin").mutation(api.suppliersWrites.patchNative, { id: "s1", orgId: ORG, patch: { tags: ["Old", "VIP"], isActive: false }, now: NOW, actor, auditId: "a1" });
    expect(await get(t, "s1")).toMatchObject({ name: "Acme", email: "a@b.co", phone: "123", tags: ["old", "vip"], isActive: false });
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.summary).toBe("Archived supplier Acme");
  });
  test("reactivates", async () => {
    const t = makeT(); await seed(t, "admin");
    await as(t, "admin").mutation(api.suppliersWrites.patchNative, { id: "s1", orgId: ORG, patch: { isActive: false }, now: NOW, actor, auditId: "a1" });
    await as(t, "admin").mutation(api.suppliersWrites.patchNative, { id: "s1", orgId: ORG, patch: { isActive: true }, now: NOW + 1, actor, auditId: "a2" });
    expect((await get(t, "s1"))?.isActive).toBe(true);
  });
  test("another org's supplier, a viewer, and an over-long tag are refused", async () => {
    const t = makeT(); await seed(t, "admin");
    await expect(as(t, "admin").mutation(api.suppliersWrites.patchNative, { id: "sx", orgId: ORG, patch: { isActive: false }, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await expect(as(t, "admin").mutation(api.suppliersWrites.patchNative, { id: "s1", orgId: ORG, patch: { tags: ["x".repeat(41)] }, now: NOW, actor, auditId: "a1" })).rejects.toThrow();
    const t2 = makeT(); await seed(t2, "viewer");
    await expect(as(t2, "viewer").mutation(api.suppliersWrites.patchNative, { id: "s1", orgId: ORG, patch: { isActive: false }, now: NOW, actor, auditId: "a1" })).rejects.toThrow();
    expect((await get(t2, "s1"))?.isActive).toBe(true);
  });
});
