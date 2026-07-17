// @vitest-environment node
//
// convex/clients.ts `listPage` — the client table's server-side replacement
// for the whole-org useClients live subscription it used to filter/sort in
// the browser (Finding #1, docs/designs/perf-convex-efficiency-2026-06.md).
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
    await ctx.db.insert("clients", {
      id: "C1", organizationId: ORG, name: "Acme Corp", type: "COMPANY",
      contactName: "Jane Doe", contactEmail: "jane@acme.test", isActive: true,
    });
    await ctx.db.insert("clients", {
      id: "C2", organizationId: ORG, name: "Bob Smith", type: "INDIVIDUAL", isActive: true,
    });
    await ctx.db.insert("clients", {
      id: "C3", organizationId: ORG, name: "Archived Co", type: "COMPANY", isActive: false,
    });
  });
}

describe("clients.listPage", () => {
  test("excludes archived (isActive:false) clients", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG });
    expect(result.items.map((c) => c.id).sort()).toEqual(["C1", "C2"]);
  });

  test("filters by type", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG, type: "INDIVIDUAL" });
    expect(result.items.map((c) => c.id)).toEqual(["C2"]);
  });

  test("search matches name, contactName, and contactEmail", async () => {
    const t = makeT();
    await seed(t);
    const byName = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG, search: "acme" });
    expect(byName.items.map((c) => c.id)).toEqual(["C1"]);
    const byContact = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG, search: "jane" });
    expect(byContact.items.map((c) => c.id)).toEqual(["C1"]);
    const byEmail = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG, search: "jane@acme.test" });
    expect(byEmail.items.map((c) => c.id)).toEqual(["C1"]);
  });

  test("sorts by name ascending by default", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG });
    expect(result.items.map((c) => c.id)).toEqual(["C1", "C2"]); // Acme before Bob
  });

  test("cross-org isolation", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: "org_2", userId: "user_2", role: "owner" });
    });
    const result = await t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.clients.listPage, { orgId: "org_2" });
    expect(result.items).toEqual([]);
  });
});
