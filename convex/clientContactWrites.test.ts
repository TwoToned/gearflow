// @vitest-environment node
//
// convex/clientContactWrites.ts — browser-direct client-contact writes (WS9 #948).
// Verifies: usefulness floor (name/email/phone), duplicate-email allowed, first
// contact auto-primary, setPrimary exclusivity, promote-on-delete, cap, per-row org
// re-check, RBAC (client:update), and atomic audit under entityType "client".
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T, opts: { clientOrg?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("clients", { id: "c1", organizationId: opts.clientOrg ?? ORG, name: "Acme Productions" });
  });
}

const add = (t: T, over: Record<string, unknown> = {}, id: { subject: string; orgId: string; role?: string } = asUser) =>
  t.withIdentity(id).mutation(api.clientContactWrites.addNative, {
    id: "cc1", orgId: ORG, clientId: "c1", name: "Jane Doe", email: "jane@acme.com", now: NOW, actor, auditId: "a1", ...over,
  });

const listContacts = (t: T) =>
  t.run(async (ctx) => ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", "c1")).collect());

describe("clientContactWrites", () => {
  test("add assigns sortOrder + auto-primary on the first contact, both audit under entityType client", async () => {
    const t = makeT(); await seed(t);
    await add(t, { id: "cc1", name: "Jane Doe", email: "jane@acme.com" });
    await add(t, { id: "cc2", name: "Bob Smith", email: "bob@acme.com", auditId: "a2" });
    const rows = (await listContacts(t)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(rows.map((r) => [r.name, r.sortOrder, r.isPrimary ?? false])).toEqual([
      ["Jane Doe", 0, true],
      ["Bob Smith", 1, false],
    ]);

    const logs = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    expect(logs.every((l) => l.entityType === "client" && l.entityId === "c1")).toBe(true);
    expect(logs.filter((l) => /contact/i.test(l.summary ?? "")).length).toBe(2);
  });

  test("rejects a contact with no name/email/phone (usefulness floor)", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, { name: undefined, email: undefined, phone: undefined })).rejects.toThrow(/at least a name/i);
  });

  test("allows a duplicate email on the same client (spec decision — no hard uniqueness)", async () => {
    const t = makeT(); await seed(t);
    await add(t, { id: "cc1", name: "Jane Doe", email: "dup@acme.com" });
    await add(t, { id: "cc2", name: "Jane Two", email: "dup@acme.com", auditId: "a2" });
    const rows = await listContacts(t);
    expect(rows.filter((r) => r.email === "dup@acme.com")).toHaveLength(2);
  });

  test("rejects an over-long note at the boundary", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, { notes: "x".repeat(501) })).rejects.toThrow(/500 characters/i);
  });

  test("rejects a client in another org", async () => {
    const t = makeT(); await seed(t, { clientOrg: OTHER });
    await expect(add(t)).rejects.toThrow(/Client not found/i);
  });

  test("enforces the 50-contact cap", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        await ctx.db.insert("clientContacts", {
          id: `pre${i}`, organizationId: ORG, clientId: "c1", name: `Contact ${i}`, sortOrder: i,
        });
      }
    });
    await expect(add(t, { id: "cc-overflow" })).rejects.toThrow(/at most 50 contacts/i);
  });

  test("rejects a member without client:update permission", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(add(t, {}, { subject: USER, orgId: ORG, role: "viewer" })).rejects.toThrow(/Forbidden|permission/i);
  });

  describe("setPrimaryNative", () => {
    test("exclusively sets one contact primary, clearing siblings", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane" });
      await add(t, { id: "cc2", name: "Bob", auditId: "a2" });
      await t.withIdentity(asUser).mutation(api.clientContactWrites.setPrimaryNative, { orgId: ORG, clientId: "c1", contactId: "cc2" });
      const rows = await listContacts(t);
      expect(rows.find((r) => r.id === "cc1")?.isPrimary).toBe(false);
      expect(rows.find((r) => r.id === "cc2")?.isPrimary).toBe(true);
    });

    test("rejects a contact whose org/client doesn't match", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane" });
      await t.run(async (ctx) => {
        await ctx.db.insert("clientContacts", { id: "ccX", organizationId: OTHER, clientId: "c1", name: "Ghost" });
      });
      await expect(
        t.withIdentity(asUser).mutation(api.clientContactWrites.setPrimaryNative, { orgId: ORG, clientId: "c1", contactId: "ccX" }),
      ).rejects.toThrow(/not on this client/i);
    });
  });

  describe("removeNative", () => {
    test("promotes the next-lowest-sortOrder contact when the primary is removed", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane" }); // auto-primary (first contact)
      await add(t, { id: "cc2", name: "Bob", auditId: "a2" });
      await t.withIdentity(asUser).mutation(api.clientContactWrites.removeNative, {
        orgId: ORG, clientId: "c1", contactId: "cc1", now: NOW + 1, actor, auditId: "a3",
      });
      const rows = await listContacts(t);
      expect(rows.map((r) => r.id)).toEqual(["cc2"]);
      expect(rows[0].isPrimary).toBe(true);
    });

    test("removing a non-primary contact leaves the primary untouched", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane" });
      await add(t, { id: "cc2", name: "Bob", auditId: "a2" });
      await t.withIdentity(asUser).mutation(api.clientContactWrites.removeNative, {
        orgId: ORG, clientId: "c1", contactId: "cc2", now: NOW + 1, actor, auditId: "a3",
      });
      const rows = await listContacts(t);
      expect(rows.map((r) => r.id)).toEqual(["cc1"]);
      expect(rows[0].isPrimary).toBe(true);
    });

    test("rejects a contact whose org/client doesn't match", async () => {
      const t = makeT(); await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("clientContacts", { id: "ccX", organizationId: OTHER, clientId: "c1", name: "Ghost" });
      });
      await expect(
        t.withIdentity(asUser).mutation(api.clientContactWrites.removeNative, {
          orgId: ORG, clientId: "c1", contactId: "ccX", now: NOW, actor, auditId: "a9",
        }),
      ).rejects.toThrow(/not on this client/i);
    });
  });

  describe("updateNative", () => {
    test("edits fields, leaves omitted fields alone", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane", email: "jane@acme.com", notes: "keep me" });
      await t.withIdentity(asUser).mutation(api.clientContactWrites.updateNative, {
        orgId: ORG, clientId: "c1", contactId: "cc1", role: "Ops Manager", now: NOW, actor, auditId: "u1",
      });
      const row = (await listContacts(t)).find((r) => r.id === "cc1");
      expect(row?.role).toBe("Ops Manager");
      expect(row?.name).toBe("Jane");
      expect(row?.notes).toBe("keep me");
    });

    test("rejects an edit that would leave the contact with no name/email/phone", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane", email: undefined, phone: undefined });
      await expect(
        t.withIdentity(asUser).mutation(api.clientContactWrites.updateNative, {
          orgId: ORG, clientId: "c1", contactId: "cc1", name: "", now: NOW, actor, auditId: "u1",
        }),
      ).rejects.toThrow(/at least a name/i);
    });

    test("rejects a contact whose org/client doesn't match", async () => {
      const t = makeT(); await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("clientContacts", { id: "ccX", organizationId: OTHER, clientId: "c1", name: "Ghost" });
      });
      await expect(
        t.withIdentity(asUser).mutation(api.clientContactWrites.updateNative, {
          orgId: ORG, clientId: "c1", contactId: "ccX", name: "New name", now: NOW, actor, auditId: "u2",
        }),
      ).rejects.toThrow(/not on this client/i);
    });
  });

  describe("reorderNative", () => {
    test("re-sorts contacts, skipping foreign ids", async () => {
      const t = makeT(); await seed(t);
      await add(t, { id: "cc1", name: "Jane" });
      await add(t, { id: "cc2", name: "Bob", auditId: "a2" });
      await t.run(async (ctx) => {
        await ctx.db.insert("clientContacts", { id: "ccX", organizationId: OTHER, clientId: "c1", name: "Ghost" });
      });
      await t.withIdentity(asUser).mutation(api.clientContactWrites.reorderNative, {
        orgId: ORG, clientId: "c1", orderedIds: ["cc2", "cc1", "ccX"],
      });
      const rows = (await listContacts(t))
        .filter((r) => r.organizationId === ORG)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      expect(rows.map((r) => r.id)).toEqual(["cc2", "cc1"]);
      // The foreign-org row is untouched — reorderNative never re-checked (much
      // less patched) a row outside the caller's org.
      const ghost = (await listContacts(t)).find((r) => r.id === "ccX");
      expect(ghost?.sortOrder).toBeUndefined();
    });
  });
});
