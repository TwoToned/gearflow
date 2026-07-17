// @vitest-environment node
//
// convex/suppliers.ts `listPage` — the supplier table's server-side
// replacement for the whole-org useSuppliers live subscription it used to
// filter/sort in the browser (Finding #1,
// docs/designs/perf-convex-efficiency-2026-06.md).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("suppliers", {
      id: "S1", organizationId: ORG, name: "Acme Rentals", contactName: "Jane Doe",
      email: "jane@acme.test", accountNumber: "ACC-100", tags: ["Preferred"], isActive: true,
    });
    await ctx.db.insert("suppliers", {
      id: "S2", organizationId: ORG, name: "Backup Gear Co", isActive: false,
    });
  });
}

describe("suppliers.listPage", () => {
  test("no isActive filter shows both active and archived (unlike clients/kits)", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG });
    expect(result.items.map((s) => s.id).sort()).toEqual(["S1", "S2"]);
  });

  test("isActive:true/false filters explicitly", async () => {
    const t = makeT();
    await seed(t);
    const active = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG, isActive: "true" });
    expect(active.items.map((s) => s.id)).toEqual(["S1"]);
    const archived = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG, isActive: "false" });
    expect(archived.items.map((s) => s.id)).toEqual(["S2"]);
  });

  test("search matches name, contactName, email, accountNumber, and tags (case-insensitively)", async () => {
    const t = makeT();
    await seed(t);
    const byName = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG, search: "acme" });
    expect(byName.items.map((s) => s.id)).toEqual(["S1"]);
    const byAccount = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG, search: "ACC-100" });
    expect(byAccount.items.map((s) => s.id)).toEqual(["S1"]);
    const byTag = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG, search: "preferred" });
    expect(byTag.items.map((s) => s.id)).toEqual(["S1"]);
  });

  test("sorts by name ascending by default", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.suppliers.listPage, { orgId: ORG });
    expect(result.items.map((s) => s.id)).toEqual(["S1", "S2"]); // Acme before Backup
  });

  test("cross-org isolation", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: "org_2", userId: "user_2", role: "owner" });
    });
    const result = await t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.suppliers.listPage, { orgId: "org_2" });
    expect(result.items).toEqual([]);
  });
});
