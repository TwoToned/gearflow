// @vitest-environment node
//
// convex/globalSearch.ts had no prior test coverage; this smoke-tests the client
// scoring block after the WS9 #948 contact widen (a client's `clientContacts`
// names/emails now feed the match, via a per-client `by_clientId` drill instead
// of a 16th org-wide scan).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const asUser = (orgId: string) => ({ subject: "user_1", orgId });

describe("globalSearch.search — client contact widen (WS9 #948)", () => {
  test("matches a client via a NON-primary contact's name, not just the client's own name", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions", isActive: true });
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "c1", name: "Zendaya Rivers", isPrimary: false, sortOrder: 0 });
    });
    const { results } = await t.withIdentity(asUser(ORG)).query(api.globalSearch.search, { orgId: ORG, query: "Zendaya" });
    const client = results.find((r) => r.type === "client" && r.id === "c1");
    expect(client).toBeDefined();
  });

  test("result subtitle prefers the resolved PRIMARY contact over the legacy embedded field", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions", contactName: "Legacy Name", isActive: true });
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "c1", name: "Primary Person", isPrimary: true, sortOrder: 0 });
    });
    const { results } = await t.withIdentity(asUser(ORG)).query(api.globalSearch.search, { orgId: ORG, query: "Acme" });
    const client = results.find((r) => r.type === "client" && r.id === "c1");
    expect(client?.subtitle).toBe("Primary Person");
  });

  test("a client with no contacts at all still matches by name (fully-optional contacts)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Bare Client Co", isActive: true });
    });
    const { results } = await t.withIdentity(asUser(ORG)).query(api.globalSearch.search, { orgId: ORG, query: "Bare Client" });
    expect(results.find((r) => r.type === "client" && r.id === "c1")).toBeDefined();
  });
});
