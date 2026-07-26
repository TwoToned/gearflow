// @vitest-environment node
//
// WS9 #948 backfill (convex/backfillClientContacts.ts). Verifies: a client with any
// embedded contact field gets one primary ClientContact row; name synthesizes from
// the email local-part only when contactName is absent; an entirely-empty embedded
// contact gets no row; idempotent re-runs create nothing new; a client that already
// has a (possibly manually-added) contact row is left alone; dry-run writes nothing.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  for (;;) {
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillClientContacts.backfillClientContactsPage, { cursor, apply });
    scanned += r.scanned;
    created += r.created;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, created };
}

const contactsFor = (t: T, clientId: string) =>
  t.run(async (ctx) => ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).collect());

describe("backfillClientContacts", () => {
  test("full embedded contact → one primary row", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", contactName: "Jane Doe", contactEmail: "jane@acme.com", contactPhone: "0400000000" });
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(created).toBe(1);
    const [contact] = await contactsFor(t, "c1");
    expect(contact.name).toBe("Jane Doe");
    expect(contact.email).toBe("jane@acme.com");
    expect(contact.phone).toBe("0400000000");
    expect(contact.isPrimary).toBe(true);
  });

  test("name absent, email present → name synthesized from the local-part", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", contactEmail: "bob.smith@acme.com" });
    });
    await runBackfill(t);
    const [contact] = await contactsFor(t, "c1");
    expect(contact.name).toBe("bob.smith");
  });

  test("email-only, name already present → contactName wins, no synthesis", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", contactName: "Jane", contactEmail: "jane@acme.com" });
    });
    await runBackfill(t);
    const [contact] = await contactsFor(t, "c1");
    expect(contact.name).toBe("Jane");
  });

  test("entirely-empty embedded contact → no row created", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme" });
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(created).toBe(0);
    expect(await contactsFor(t, "c1")).toHaveLength(0);
  });

  test("idempotent — re-running creates nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", contactName: "Jane", contactEmail: "jane@acme.com" });
    });
    expect((await runBackfill(t)).created).toBe(1);
    expect((await runBackfill(t)).created).toBe(0);
    expect(await contactsFor(t, "c1")).toHaveLength(1);
  });

  test("a client that already has a (manually-added) contact row is left alone", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", contactName: "Legacy Name", contactEmail: "legacy@acme.com" });
      await ctx.db.insert("clientContacts", { id: "manual1", organizationId: ORG, clientId: "c1", name: "Manually Added", isPrimary: true, sortOrder: 0 });
    });
    const { scanned, created } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(created).toBe(0);
    const contacts = await contactsFor(t, "c1");
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Manually Added");
  });

  test("dry-run scans but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", contactName: "Jane" });
    });
    const { scanned, created } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(created).toBe(0);
    expect(await contactsFor(t, "c1")).toHaveLength(0);
  });
});
