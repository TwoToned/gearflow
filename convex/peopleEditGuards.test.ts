// @vitest-environment node
//
// UX Phase 13 slice 4 review (MEDIUM 2-5 and the window nit): the exact Undo of a People SHEET edit.
//  2. only allow-listed fields are restorable, and a crew member's pay only for a caller who can see crew pay;
//  3. a server-owned field (`icalToken`) is refused on write and can never land in an audit snapshot;
//  4. an order's Undo cannot step the status machine backwards or leave a not-yet-received order with a return date;
//  5. a client edit can CLEAR a field, and its Undo restores the cleared value;
//  and the 10-minute server window applies to an edit Undo.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { CLIENT_CLEARABLE_FIELDS, PEOPLE_EDIT_FIELDS } from "./lib/peopleEditFields";
import { JOB_COST_FIELDS } from "./lib/crewPayFields";

type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const NOW = Date.now();
const actor = { userId: USER, userName: "Alice" };
const asUser = (t: T) => t.withIdentity({ subject: USER, orgId: ORG, role: "owner" });
const asAgent = (t: T) => t.withIdentity({ subject: USER, orgId: ORG, role: "owner", akid: KEY });

function makeT(): T {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    // A key that acts as USER but may not see money (`noFinancials`): it has crew:update, never the pay line.
    await ctx.db.insert("apiKeys", { id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", status: "ACTIVE", isActive: true, defaultDayRate: 600, icalToken: "SECRET-TOKEN", icalEnabled: true, department: "Rigging" });
    await ctx.db.insert("clients", {
      id: "k1", organizationId: ORG, name: "Hilton", isActive: true, tags: [], billingAddress: "1 Main St", billingLatitude: 1, billingLongitude: 2, shippingAddress: "2 Side St",
      shippingLatitude: 3, shippingLongitude: 4, taxId: "ABN1", taxExemptReason: "gov", paymentTerms: "Net 30", defaultDiscount: 10, notes: "n", profileDepositPercent: 25,
    });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true, tags: [] });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "SUBHIRE", status: "DRAFT", notes: "n0" });
  });
}
const doc = (t: T, table: "clients" | "crewMembers" | "supplierOrders" | "suppliers", id: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t.run(async (ctx) => (ctx.db.query(table).withIndex("by_cuid" as any, (q: any) => q.eq("id", id)).first()) as any) as Promise<Record<string, unknown> | null>;
const log = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const undoPeople = (t: T, kind: "client" | "supplier" | "crew", id: string, auditId: string, who = asUser(t)) =>
  who.mutation(api.peopleBulkWrites.undoManyNative, { orgId: ORG, kind, items: [{ id, auditId }], now: NOW + 1, actor });
const editCrew = (t: T, set: Record<string, unknown>, clear: string[] = [], auditId = "e1", who = asUser(t)) =>
  who.mutation(api.crewWrites.updateNative, { id: "c1", orgId: ORG, set, clear, actor, auditId, now: NOW });
/** Rewrite a forward audit row's snapshot (a tampered or future row), keeping its author and window. */
const tamper = (t: T, auditId: string, fn: (fe: { before: Record<string, unknown>; after: Record<string, unknown> }) => void) =>
  t.run(async (ctx) => {
    const row = (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", auditId)).first())!;
    const d = JSON.parse(JSON.stringify(row.details));
    fn(d.fieldEdit);
    await ctx.db.patch(row._id, { details: d });
  });

// ─── 2. the allow-list and the pay guard ─────────────────────────────────────────

describe("the edit Undo only restores allow-listed fields, and pay only for a caller who sees pay", () => {
  test("a crew edit that changed pay is NOT undone by a caller who cannot see crew pay, and is by one who can", async () => {
    const t = makeT(); await seed(t);
    await editCrew(t, { defaultDayRate: 700, firstName: "Robert" });
    const blocked = await undoPeople(t, "crew", "c1", "e1", asAgent(t));
    expect(blocked.restored).toEqual([]);
    expect(blocked.kept).toEqual([{ id: "c1", reason: expect.stringMatching(/pay.*can't see/) }]);
    expect(await doc(t, "crewMembers", "c1")).toMatchObject({ defaultDayRate: 700, firstName: "Robert" }); // nothing was written
    expect((await undoPeople(t, "crew", "c1", "e1")).restored).toEqual(["c1"]);
    expect(await doc(t, "crewMembers", "c1")).toMatchObject({ defaultDayRate: 600, firstName: "Bob" });
  });

  test("a snapshot that names a field outside the kind's allow-list is refused whole, for crew, client and supplier", async () => {
    const t = makeT(); await seed(t);
    await editCrew(t, { firstName: "Robert" });
    await tamper(t, "e1", (fe) => { fe.before.icalToken = "stolen"; fe.after.icalToken = "SECRET-TOKEN"; });
    const r = await undoPeople(t, "crew", "c1", "e1");
    expect(r.kept).toEqual([{ id: "c1", reason: expect.stringMatching(/can't be undone/) }]);
    expect(await doc(t, "crewMembers", "c1")).toMatchObject({ firstName: "Robert", icalToken: "SECRET-TOKEN" });

    await asUser(t).mutation(api.clientWrites.updateNative, { id: "k1", orgId: ORG, patch: { name: "Hilton Sydney" }, actor, auditId: "e2", now: NOW });
    await tamper(t, "e2", (fe) => { fe.before.xeroContactId = "x"; fe.after.xeroContactId = null; });
    expect((await undoPeople(t, "client", "k1", "e2")).kept[0].reason).toMatch(/can't be undone/);
    expect(await doc(t, "clients", "k1")).toMatchObject({ name: "Hilton Sydney" });

    await asUser(t).mutation(api.suppliersWrites.updateNative, { id: "s1", orgId: ORG, name: "Scene 2", now: NOW, actor, auditId: "e3" });
    await tamper(t, "e3", (fe) => { fe.before.organizationId = "org_x"; fe.after.organizationId = "org_1"; });
    expect((await undoPeople(t, "supplier", "s1", "e3")).kept[0].reason).toMatch(/can't be undone/);
    expect(await doc(t, "suppliers", "s1")).toMatchObject({ name: "Scene 2", organizationId: ORG });
  });

  test("no client or supplier field sits on the job-cost line (so no pay guard is owed for them)", () => {
    for (const kind of ["client", "supplier"] as const) {
      for (const f of PEOPLE_EDIT_FIELDS[kind]) expect((JOB_COST_FIELDS as readonly string[]).includes(f), `${kind}.${f}`).toBe(false);
    }
  });
});

// ─── 3. icalToken ────────────────────────────────────────────────────────────────

describe("server-owned crew fields", () => {
  test("updateNative refuses to set or clear icalToken, icalEnabled or any field outside the member form", async () => {
    const t = makeT(); await seed(t);
    await expect(editCrew(t, { icalToken: "x" })).rejects.toThrow(/can't be edited here: icalToken/);
    await expect(editCrew(t, { icalEnabled: false })).rejects.toThrow(/icalEnabled/);
    await expect(editCrew(t, { firstName: "Robert" }, ["icalToken"])).rejects.toThrow(/icalToken/);
    await expect(editCrew(t, { skillIds: ["s"] })).rejects.toThrow(/skillIds/);
    expect(await doc(t, "crewMembers", "c1")).toMatchObject({ icalToken: "SECRET-TOKEN", icalEnabled: true, firstName: "Bob" });
  });

  test("an ordinary edit never copies the member's icalToken into its audit row", async () => {
    const t = makeT(); await seed(t);
    await editCrew(t, { firstName: "Robert", updatedAt: NOW });
    expect(JSON.stringify(await log(t, "e1"))).not.toMatch(/SECRET-TOKEN|icalToken/);
    // The snapshot holds the allow-listed fields the edit changed and nothing else (`updatedAt` is not an audited field).
    const fe = (await log(t, "e1"))!.details as { fieldEdit: { before: object; after: object } };
    expect(Object.keys(fe.fieldEdit.after)).toEqual(["firstName"]);
    expect(Object.keys(fe.fieldEdit.before)).toEqual(["firstName"]);
  });
});

// ─── 4. the order Undo and the status machine ────────────────────────────────────

describe("an order's Undo cannot bypass the status machine", () => {
  const edit = (t: T, status: string, auditId: string, now = NOW) =>
    asUser(t).mutation(api.supplierOrdersWrites.updateNative, { id: "o1", orgId: ORG, status: status as never, notes: "n0", now, actor, auditId });
  const undo = (t: T, auditId: string) => asUser(t).mutation(api.supplierOrdersWrites.undoHireChangeNative, { id: "o1", orgId: ORG, forwardAuditId: auditId, now: NOW + 9, actor });
  const received = async (t: T) => { await edit(t, "ORDERED", "e1", NOW); await edit(t, "RECEIVED", "e2", NOW + 1); };

  test("the control: an untouched status change is undone, including out of RECEIVED (the forward write is still the last thing)", async () => {
    const t = makeT(); await seed(t);
    await received(t);
    await undo(t, "e2");
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "ORDERED" });
    expect((await doc(t, "supplierOrders", "o1"))?.receivedDate).toBeUndefined();
  });

  test("after Mark returned, undoing the receipt is refused and the order keeps RECEIVED and its return date", async () => {
    const t = makeT(); await seed(t);
    await received(t);
    await asUser(t).mutation(api.supplierOrdersWrites.markReturnedNative, { id: "o1", orgId: ORG, returnedDate: NOW, now: NOW + 2, actor, auditId: "h1" });
    await expect(undo(t, "e2")).rejects.toThrow(/changed since|marked returned/);
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "RECEIVED", returnedDate: NOW });
  });

  test("ANY later write to the order refuses the step back (here an extension), even one that leaves status and the return date alone", async () => {
    const t = makeT(); await seed(t);
    await received(t);
    await asUser(t).mutation(api.supplierOrdersWrites.extendHireNative, { id: "o1", orgId: ORG, returnDueDate: NOW + 86_400_000, now: NOW + 2, actor, auditId: "h1" });
    await expect(undo(t, "e2")).rejects.toThrow(/changed since/);
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "RECEIVED" });
  });

  test("an order that is not on hire can never be left holding a return date, even when nothing bumped updatedAt", async () => {
    const t = makeT(); await seed(t);
    await received(t);
    await t.run(async (ctx) => { const o = (await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first())!; await ctx.db.patch(o._id, { returnedDate: NOW }); }); // updatedAt untouched
    await expect(undo(t, "e2")).rejects.toThrow(/marked returned/);
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "RECEIVED", returnedDate: NOW });
  });

  test("an asset linked since the receipt refuses the step back", async () => {
    const t = makeT(); await seed(t);
    await received(t);
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, modelId: "m", assetTag: "T1", supplierOrderId: "o1" } as never); });
    await expect(undo(t, "e2")).rejects.toThrow(/asset was linked/);
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "RECEIVED" });
  });

  test("Undo of a Mark returned is unaffected (it restores the empty return date)", async () => {
    const t = makeT(); await seed(t);
    await received(t);
    await asUser(t).mutation(api.supplierOrdersWrites.markReturnedNative, { id: "o1", orgId: ORG, returnedDate: NOW, now: NOW + 2, actor, auditId: "h1" });
    await undo(t, "h1");
    expect((await doc(t, "supplierOrders", "o1"))?.returnedDate).toBeUndefined();
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "RECEIVED" });
  });
});

// ─── 5. a client edit can clear a field ──────────────────────────────────────────

describe("a client edit clears a blank field", () => {
  const save = (t: T, patch: Record<string, unknown>, clear: string[], auditId = "e1") =>
    asUser(t).mutation(api.clientWrites.updateNative, { id: "k1", orgId: ORG, patch: { name: "Hilton", ...patch } as never, clear, actor, auditId, now: NOW });

  test.each(CLIENT_CLEARABLE_FIELDS.map((f) => [f]))("%s: cleared by an edit, restored by its Undo", async (field) => {
    const t = makeT(); await seed(t);
    const before = (await doc(t, "clients", "k1"))![field];
    expect(before).not.toBeUndefined();
    await save(t, {}, [field]);
    expect((await doc(t, "clients", "k1"))![field]).toBeUndefined();
    const fe = (await log(t, "e1"))!.details as { fieldEdit: { before: Record<string, unknown>; after: Record<string, unknown> } };
    expect(fe.fieldEdit.after[field]).toBeNull();
    expect((await undoPeople(t, "client", "k1", "e1")).restored).toEqual(["k1"]);
    expect((await doc(t, "clients", "k1"))![field]).toEqual(before);
  });

  test("a key absent from the patch and from `clear` keeps its stored value; a value in the patch replaces it", async () => {
    const t = makeT(); await seed(t);
    await save(t, { notes: "changed" }, []);
    expect(await doc(t, "clients", "k1")).toMatchObject({ notes: "changed", taxId: "ABN1", defaultDiscount: 10 });
  });

  test("clearing a field that always carries a value, an unknown field, or a field also being set is refused", async () => {
    const t = makeT(); await seed(t);
    await expect(save(t, {}, ["name"])).rejects.toThrow(/can't be cleared here: name/);
    await expect(save(t, {}, ["xeroContactId"])).rejects.toThrow(/xeroContactId/);
    await expect(save(t, { notes: "x" }, ["notes"])).rejects.toThrow(/notes/);
    expect(await doc(t, "clients", "k1")).toMatchObject({ notes: "n" });
  });
});

// ─── the 10-minute server window ─────────────────────────────────────────────────

describe("the edit Undo's server window", () => {
  const stale = (t: T, auditId: string) => tamper(t, auditId, () => undefined).then(() => t.run(async (ctx) => {
    const row = (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", auditId)).first())!;
    const d = JSON.parse(JSON.stringify(row.details));
    d.fieldEdit.serverSavedAt = Date.now() - 11 * 60 * 1000;
    await ctx.db.patch(row._id, { details: d });
  }));

  test("a people edit older than 10 minutes on the server clock is kept as it is, with the reason named", async () => {
    const t = makeT(); await seed(t);
    await asUser(t).mutation(api.clientWrites.updateNative, { id: "k1", orgId: ORG, patch: { name: "Hilton Sydney" }, actor, auditId: "e1", now: NOW });
    await stale(t, "e1");
    const r = await undoPeople(t, "client", "k1", "e1");
    expect(r.restored).toEqual([]);
    expect(r.kept[0].reason).toMatch(/within 10 minutes/);
    expect(await doc(t, "clients", "k1")).toMatchObject({ name: "Hilton Sydney" });
  });

  test("so is an order edit", async () => {
    const t = makeT(); await seed(t);
    await asUser(t).mutation(api.supplierOrdersWrites.updateNative, { id: "o1", orgId: ORG, status: "ORDERED", notes: "n0", now: NOW, actor, auditId: "e1" });
    await stale(t, "e1");
    await expect(asUser(t).mutation(api.supplierOrdersWrites.undoHireChangeNative, { id: "o1", orgId: ORG, forwardAuditId: "e1", now: NOW + 1, actor })).rejects.toThrow(/within 10 minutes/);
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "ORDERED" });
  });
});
