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

  // WS9 #948 — contactName/contactEmail become primary-contact-derived.
  test("contactName/contactEmail reflect the PRIMARY contact row, not the legacy embedded fields, once the client has contacts", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "C1", name: "New Primary", email: "new-primary@acme.test", isPrimary: true, sortOrder: 0 });
    });
    const result = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG });
    const c1 = result.items.find((c) => c.id === "C1");
    expect(c1?.contactName).toBe("New Primary");
    expect(c1?.contactEmail).toBe("new-primary@acme.test");
  });

  test("a client with no contacts still falls back to the legacy embedded contactName/contactEmail", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.clients.listPage, { orgId: ORG });
    const c1 = result.items.find((c) => c.id === "C1");
    expect(c1?.contactName).toBe("Jane Doe");
    expect(c1?.contactEmail).toBe("jane@acme.test");
  });
});

describe("clients.detail", () => {
  test("returns the client's contacts, sorted by sortOrder, org-scoped", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clientContacts", { id: "cc2", organizationId: ORG, clientId: "C1", name: "Second", isPrimary: false, sortOrder: 1 });
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "C1", name: "First", isPrimary: true, sortOrder: 0 });
      await ctx.db.insert("clientContacts", { id: "ccOther", organizationId: "org_2", clientId: "C1", name: "Foreign" });
    });
    const result = await t.withIdentity(asUser).query(api.clients.detail, { orgId: ORG, id: "C1" });
    expect(result?.contacts.map((c) => c.name)).toEqual(["First", "Second"]);
  });

  test("a client with zero contacts returns an empty contacts array (fully optional)", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.clients.detail, { orgId: ORG, id: "C2" });
    expect(result?.contacts).toEqual([]);
  });
});
