// @vitest-environment node
//
// WS9 #948 — WooCommerce client matching, Convex-native path
// (convex/wooCommerceActions.ts findOrCreateClient). Behaviour-pinned via the
// TEST-ONLY `_findOrCreateClientForTest` action wrapper (see its docstring):
// email match widens to ANY contact's email (not just the legacy embedded
// clients.contactEmail), and a fuzzy-company match with an unknown billing email
// auto-creates an additional (non-primary) contact tagged from the order.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

function billing(over: Record<string, unknown> = {}) {
  return {
    first_name: "Jordan",
    last_name: "Lee",
    email: "jordan@example.com",
    ...over,
  };
}

const contactsFor = (t: T, clientId: string) =>
  t.run(async (ctx) => ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).collect());

describe("wooCommerceActions findOrCreateClient (WS9 #948)", () => {
  test("matches on a NON-primary contact's email, not just the legacy embedded field", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions", type: "COMPANY", isActive: true });
      // The client's own embedded contactEmail is different — only a secondary
      // contact row carries the order's billing email.
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "c1", name: "Jordan Lee", email: "jordan@example.com", isPrimary: false, sortOrder: 0 });
    });
    const result = await t.action(internal.wooCommerceActions._findOrCreateClientForTest, {
      orgId: ORG,
      billing: billing(),
    });
    expect(result.id).toBe("c1");
  });

  test("fuzzy company match with an unknown billing email auto-creates an additional contact", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions Pty Ltd", type: "COMPANY", isActive: true });
    });
    const result = await t.action(internal.wooCommerceActions._findOrCreateClientForTest, {
      orgId: ORG,
      billing: billing({ company: "Acme Productions" }),
    });
    expect(result.id).toBe("c1"); // fuzzy-matched the existing company, not a new client
    const contacts = await contactsFor(t, "c1");
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ email: "jordan@example.com", name: "Jordan Lee", isPrimary: false });
    expect(contacts[0].notes).toMatch(/WooCommerce/i);
  });

  test("fuzzy company match with an ALREADY-known billing email does not duplicate the contact", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions Pty Ltd", type: "COMPANY", isActive: true });
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "c1", name: "Jordan Lee", email: "jordan@example.com", isPrimary: true, sortOrder: 0 });
    });
    const result = await t.action(internal.wooCommerceActions._findOrCreateClientForTest, {
      orgId: ORG,
      billing: billing({ company: "Acme Productions" }),
    });
    expect(result.id).toBe("c1");
    expect(await contactsFor(t, "c1")).toHaveLength(1); // no new contact created
  });

  test("no match at all creates a brand-new client (unaffected by the contacts widen)", async () => {
    const t = makeT();
    const result = await t.action(internal.wooCommerceActions._findOrCreateClientForTest, {
      orgId: ORG,
      billing: billing(),
    });
    expect(result.name).toBe("Jordan Lee");
    expect(result.contactEmail).toBe("jordan@example.com");
  });
});
