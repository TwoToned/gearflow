// @vitest-environment node
//
// UX Phase 13 slice 4 review, HIGH 1: the exact Undo of a create deletes the new record only when NOTHING references
// it, decided from ONE table to foreign-key map (`lib/peopleReferences.ts`). Two guards:
//  - a SCHEMA WALK: every field in `convex/schema.ts` that points at a client, supplier, crew member or supplier order
//    must be in the map, as a blocker or as `ignored` with a reason (a new referencing table fails this until added);
//  - one test PER BLOCKER, seeding exactly ONE referencing row, so no blocker can hide behind another.
import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { PEOPLE_REFERENCES, type PeopleKind } from "./lib/peopleReferences";

type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1";
const NOW = Date.now();
const actor = { userId: USER, userName: "Alice" };
const as = (t: T) => t.withIdentity({ subject: USER, orgId: ORG, role: "admin" });

function makeT(): T {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

// ─── The schema walk ───────────────────────────────────────────────────────────

/** Every `(table, field)` in the schema whose NAME says it points at one of the four kinds. */
function schemaForeignKeys(): { table: string; field: string; kind: PeopleKind }[] {
  const src = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
  const out: { table: string; field: string; kind: PeopleKind }[] = [];
  const tables = [...src.matchAll(/\n {2}(\w+): defineTable\(\{/g)];
  tables.forEach((m, i) => {
    const body = src.slice(m.index! + m[0].length, tables[i + 1]?.index ?? src.length).split("\n  })")[0];
    for (const f of body.matchAll(/\n {4}(\w+): v\./g)) {
      const field = f[1];
      const lower = field.toLowerCase();
      let kind: PeopleKind | null = null;
      if (lower.endsWith("supplierorderid")) kind = "supplierOrder";
      else if (lower.endsWith("crewmemberid")) kind = "crew";
      else if (lower.endsWith("supplierid")) kind = "supplier";
      else if (lower.endsWith("clientid")) kind = "client";
      else if (lower === "orderid" && m[1].startsWith("supplierOrder")) kind = "supplierOrder";
      if (kind && m[1] !== kindTable(kind)) out.push({ table: m[1], field, kind });
    }
  });
  return out;
}
const kindTable = (k: PeopleKind) => ({ client: "clients", supplier: "suppliers", crew: "crewMembers", supplierOrder: "supplierOrders" })[k];

describe("the schema walk", () => {
  const found = schemaForeignKeys();

  test("the walk really sees the foreign keys (a sanity floor, so it cannot pass by finding nothing)", () => {
    expect(found.length).toBeGreaterThan(25);
    expect(found).toContainEqual({ table: "subHires", field: "supplierId", kind: "supplier" });
    expect(found).toContainEqual({ table: "xeroSyncLogs", field: "clientId", kind: "client" });
  });

  test("every field pointing at a client, supplier, crew member or order is in the map (a blocker, or ignored with a reason)", () => {
    const missing = found.filter((f) => !PEOPLE_REFERENCES[f.kind].some((r) => r.table === f.table && r.field === f.field));
    expect(missing).toEqual([]);
  });

  test("the map names no table or field that is not in the schema, and every `ignored` has a reason", () => {
    const real = new Set(found.map((f) => `${f.table}.${f.field}`));
    for (const refs of Object.values(PEOPLE_REFERENCES)) {
      for (const r of refs) {
        expect(real.has(`${r.table}.${r.field}`), `${r.table}.${r.field}`).toBe(true);
        if ("ignored" in r) expect(r.ignored.length).toBeGreaterThan(10);
      }
    }
  });

  test("an indexed blocker names an index that exists on its table", () => {
    const src = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
    for (const refs of Object.values(PEOPLE_REFERENCES)) {
      for (const r of refs) {
        if ("ignored" in r || !r.index) continue;
        const at = src.indexOf(`\n  ${r.table}: defineTable(`);
        const next = src.indexOf("defineTable(", at + 30);
        expect(src.slice(at, next < 0 ? undefined : next), `${r.table}.${r.index}`).toContain(`.index("${r.index}"`);
      }
    }
  });
});

// ─── One test per blocker ───────────────────────────────────────────────────────

const create = {
  client: (t: T) => as(t).mutation(api.clientWrites.createNative, { id: "r1", organizationId: ORG, name: "Hilton", createdAt: NOW, updatedAt: NOW, actor, auditId: "a1" }),
  supplier: (t: T) => as(t).mutation(api.suppliersWrites.createNative, { id: "r1", orgId: ORG, name: "Scene", now: NOW, actor, auditId: "a1" }),
  crew: (t: T) => as(t).mutation(api.crewWrites.createNative, { id: "r1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", createdAt: NOW, updatedAt: NOW, actor, auditId: "a1" }),
  supplierOrder: async (t: T) => {
    await t.run(async (ctx) => { await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true, tags: [] }); });
    return as(t).mutation(api.supplierOrdersWrites.createNative, { id: "r1", orgId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", now: NOW, actor, auditId: "a1" });
  },
} as const;
const undo = (t: T, kind: PeopleKind) => as(t).mutation(api.peopleCreateUndo.undoCreateNative, { orgId: ORG, kind, id: "r1", forwardAuditId: "a1", now: NOW + 1, actor });
const TABLE = { client: "clients", supplier: "suppliers", crew: "crewMembers", supplierOrder: "supplierOrders" } as const;
const exists = (t: T, kind: PeopleKind) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t.run(async (ctx) => !!(await ctx.db.query(TABLE[kind]).withIndex("by_cuid" as any, (q: any) => q.eq("id", "r1")).first()));

/** ONE row that references the new record through `table.field`, with that table's required fields. */
const ROW: Record<string, (fk: string, field: string) => Record<string, unknown>> = {
  projects: (fk) => ({ id: "x", organizationId: ORG, projectNumber: "P1", name: "J", clientId: fk }),
  invoices: (fk) => ({ id: "x", organizationId: ORG, projectId: "p", clientId: fk, subtotal: 1, taxAmount: 0, total: 1, kind: "FULL", status: "DRAFT" }),
  clientMedia: (fk) => ({ id: "x", organizationId: ORG, clientId: fk, fileId: "f" }),
  clientContacts: (fk) => ({ id: "x", organizationId: ORG, clientId: fk, name: "Later", createdAt: NOW + 99, updatedAt: NOW + 99 }),
  projectVersions: (fk) => ({ id: "x", organizationId: ORG, projectId: "p", number: 1, createdAt: NOW, createdById: USER, contentState: "ready", clientId: fk }),
  xeroSyncLogs: (fk) => ({ id: "x", organizationId: ORG, direction: "SYNC_CONTACT", status: "SUCCESS", clientId: fk }),
  wooCommerceOrderLogs: (fk) => ({ id: "x", organizationId: ORG, wooOrderId: 1, payload: {}, status: "RECEIVED", clientId: fk }),
  activityEvents: (fk) => ({ orgId: ORG, actorUserId: USER, actorName: "A", actorColor: "#000", entityType: "client", entityId: fk, action: "x", summary: "s", createdAt: NOW, clientId: fk }),
  supplierOrders: (fk) => ({ id: "x", organizationId: ORG, supplierId: fk, orderNumber: "PO-2", type: "PURCHASE", status: "DRAFT" }),
  assets: (fk, field) => ({ id: "x", organizationId: ORG, modelId: "m", assetTag: "T1", [field]: fk }),
  supplierContacts: (fk) => ({ id: "x", organizationId: ORG, supplierId: fk }),
  supplierDocuments: (fk) => ({ id: "x", organizationId: ORG, supplierId: fk, fileId: "f", name: "d" }),
  supplierModelRates: (fk) => ({ id: "x", organizationId: ORG, supplierId: fk, modelId: "m", lastUnitCost: 1 }),
  subHires: (fk, field) => ({ id: "x", organizationId: ORG, supplierId: field === "supplierId" ? fk : "other", createdById: USER, orderNumber: "SH-1", ...(field === "supplierOrderId" ? { supplierOrderId: fk } : {}) }),
  projectLineItems: (fk, field) => ({ id: "x", organizationId: ORG, projectId: "p", [field]: fk }),
  crewAssignments: (fk) => ({ id: "x", organizationId: ORG, projectId: "p", crewMemberId: fk }),
  crewTimeEntries: (fk) => ({ id: "x", organizationId: ORG, crewMemberId: fk, date: NOW, startTime: "09:00", endTime: "10:00" }),
  crewAvailabilities: (fk) => ({ id: "x", crewMemberId: fk, startDate: NOW, endDate: NOW }),
  crewDocuments: (fk) => ({ id: "x", organizationId: ORG, crewMemberId: fk, fileId: "f", kind: "ID", createdAt: NOW, createdById: USER }),
  supplierOrderItems: (fk) => ({ id: "x", orderId: fk, description: "d" }),
  supplierOrderFiles: (fk) => ({ id: "x", organizationId: ORG, orderId: fk, fileId: "f", kind: "PO" }),
};

const cases = (Object.keys(PEOPLE_REFERENCES) as PeopleKind[]).flatMap((kind) =>
  PEOPLE_REFERENCES[kind].filter((r) => !("ignored" in r)).map((r) => [kind, r.table, r.field, "why" in r ? r.why : ""] as const),
);

describe("each blocker alone refuses the Undo, names itself, and removes nothing", () => {
  test.each(cases)("%s: %s.%s", async (kind, table, field, why) => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" }); });
    await create[kind](t);
    // The control: exactly as created, it goes. Then re-create and add the ONE referencing row.
    const c = makeT();
    await c.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" }); });
    await create[kind](c);
    expect(await undo(c, kind)).toEqual({ removed: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await t.run(async (ctx) => { await ctx.db.insert(table as any, ROW[table]("r1", field) as never); });
    await expect(undo(t, kind)).rejects.toThrow(new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(await exists(t, kind)).toBe(true);
  });

  test("the control for the contact blocker: the primary contact the create wrote does NOT block", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" }); });
    await create.client(t);
    await t.run(async (ctx) => { await ctx.db.insert("clientContacts", { id: "pc", organizationId: ORG, clientId: "r1", name: "Primary", createdAt: NOW, updatedAt: NOW } as never); });
    expect(await undo(t, "client")).toEqual({ removed: true });
  });

  test("another org's row with the same foreign key never blocks (the global indexes are org-checked)", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" }); });
    await create.supplier(t);
    await t.run(async (ctx) => { await ctx.db.insert("supplierContacts", { id: "fx", organizationId: OTHER, supplierId: "r1" } as never); });
    expect(await undo(t, "supplier")).toEqual({ removed: true });
  });

  test("an unindexed blocker that cannot be read to the end refuses, fail closed", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" }); });
    await create.client(t);
    await t.run(async (ctx) => { for (let i = 0; i < 1001; i++) await ctx.db.insert("xeroSyncLogs", { id: `l${i}`, organizationId: ORG, direction: "SYNC_CONTACT", status: "SUCCESS" }); });
    await expect(undo(t, "client")).rejects.toThrow(/too many xeroSyncLogs/);
    expect(await exists(t, "client")).toBe(true);
  });
});
