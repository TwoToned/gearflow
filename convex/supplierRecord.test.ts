// @vitest-environment node
//
// UX Phase 13 B3: supplier Contacts, supplier Documents (with expiry) and the order's Files.
// Writes gated on supplier:update, org-checked on every parent and file, exact SERVER-side
// Undo (author / once / window-by-server-clock / compare-and-set), an Undo that NEVER deletes
// a stored file, confirmed removals that do, delete cascades, and cross-tenant reads.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { documentExpiry } from "./lib/supplierRecordCore";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1";
const actor = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const DAY = 86_400_000;
const as = (t: T, role = "admin", userId = USER) => t.withIdentity({ subject: userId, orgId: ORG, role });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true });
    await ctx.db.insert("suppliers", { id: "sx", organizationId: OTHER, name: "Foreign", isActive: true });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", status: "ORDERED" });
    for (const [id, org] of [["f1", ORG], ["f2", ORG], ["fx", OTHER]] as const) {
      await ctx.db.insert("fileUploads", { id, organizationId: org, fileName: `${id}.pdf`, fileSize: 10, mimeType: "application/pdf", storageKey: `k_${id}`, url: `/api/files/k_${id}`, uploadedById: USER });
      await ctx.db.insert("storedFiles", { storageId: `k_${id}`, organizationId: org });
    }
  });
}
const rows = (t: T, table: "supplierContacts" | "supplierDocuments" | "supplierOrderFiles") =>
  t.run(async (ctx) => (await ctx.db.query(table).collect()) as Array<Record<string, unknown> & { id: string }>);
const fileRow = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const addContact = (t: T, over: Record<string, unknown> = {}, who = as(t)) =>
  who.mutation(api.supplierRecordWrites.addContactNative, { id: "c1", orgId: ORG, supplierId: "s1", name: "Priya", email: "p@x.test", now: NOW, actor, auditId: "a1", ...over });
const addDoc = (t: T, over: Record<string, unknown> = {}, who = as(t)) =>
  who.mutation(api.supplierRecordWrites.addDocumentNative, { id: "d1", orgId: ORG, supplierId: "s1", fileId: "f1", name: "Insurance", kind: "Insurance", expiryDate: NOW + 10 * DAY, now: NOW, actor, auditId: "a2", ...over });
const addOrderFile = (t: T, over: Record<string, unknown> = {}, who = as(t)) =>
  who.mutation(api.supplierRecordWrites.addOrderFileNative, { id: "of1", orgId: ORG, orderId: "o1", fileId: "f1", kind: "PO", now: NOW, actor, auditId: "a3", ...over });

describe("documentExpiry (pure)", () => {
  test("derived, never stored", () => {
    expect(documentExpiry(null, NOW).state).toBe("none");
    expect(documentExpiry(NOW - DAY, NOW).state).toBe("expired");
    expect(documentExpiry(NOW + 5 * DAY, NOW).state).toBe("soon");
    expect(documentExpiry(NOW + 90 * DAY, NOW).state).toBe("ok");
  });
});

describe("contacts", () => {
  test("add / edit / remove, each with an exact Undo", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    expect(await as(t).query(api.supplierRecord.contacts, { orgId: ORG, supplierId: "s1" })).toEqual([expect.objectContaining({ id: "c1", name: "Priya" })]);

    await as(t).mutation(api.supplierRecordWrites.updateContactNative, { orgId: ORG, supplierId: "s1", contactId: "c1", name: "Priya S", email: "p@x.test", now: NOW, actor, auditId: "a4" });
    expect((await rows(t, "supplierContacts"))[0].name).toBe("Priya S");
    await as(t).mutation(api.supplierRecordWrites.undoRowEditNative, { orgId: ORG, kind: "contact", rowId: "c1", forwardAuditId: "a4", now: NOW, actor });
    expect((await rows(t, "supplierContacts"))[0].name).toBe("Priya");

    await as(t).mutation(api.supplierRecordWrites.removeContactNative, { orgId: ORG, supplierId: "s1", contactId: "c1", now: NOW, actor, auditId: "a5" });
    expect(await rows(t, "supplierContacts")).toHaveLength(0);
    const res = await as(t).mutation(api.supplierRecordWrites.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "a5", now: NOW, actor });
    expect(res.restored).toBe(true);
    expect(await rows(t, "supplierContacts")).toEqual([expect.objectContaining({ id: "c1", name: "Priya", email: "p@x.test", supplierId: "s1", organizationId: ORG })]);
  });

  test("Undo of an add removes the row once; a second Undo, another user and an edited row are refused", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    const undo = (who = as(t)) => who.mutation(api.supplierRecordWrites.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "a1", now: NOW, actor });
    await expect(undo(as(t, "admin", "user_2"))).rejects.toThrow(/person who made/);
    expect((await undo()).restored).toBe(true);
    await expect(undo()).rejects.toThrow(/already undone/);

    await addContact(t, { id: "c2", auditId: "b1" });
    await as(t).mutation(api.supplierRecordWrites.updateContactNative, { orgId: ORG, supplierId: "s1", contactId: "c2", name: "Changed", now: NOW + 5, actor, auditId: "b2" });
    await expect(as(t).mutation(api.supplierRecordWrites.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "b1", now: NOW, actor })).rejects.toThrow(/edited since/);
  });

  test("an Undo is refused outside the server-clock window, whatever `now` the caller sends", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await expect(as(t).mutation(api.supplierRecordWrites.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "a1", now: NOW, actor })).rejects.toThrow(/10 minutes/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a viewer cannot write, a contact needs a name/email/phone, and a foreign supplier is not found", async () => {
    const t = makeT(); await seed(t, "viewer");
    await expect(addContact(t, {}, as(t, "viewer"))).rejects.toThrow();
    const t2 = makeT(); await seed(t2);
    await expect(addContact(t2, { name: undefined, email: undefined })).rejects.toThrow(/at least a name/);
    await expect(addContact(t2, { supplierId: "sx" })).rejects.toThrow(/Supplier not found/);
    expect(await rows(t2, "supplierContacts")).toHaveLength(0);
  });

  test("reads never cross tenants", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("supplierContacts", { id: "cx", organizationId: OTHER, supplierId: "sx", name: "Foreign contact" }); });
    expect(await as(t).query(api.supplierRecord.contacts, { orgId: ORG, supplierId: "sx" })).toEqual([]);
    // A foreign row planted under MY supplier's id is still dropped by the per-row org check.
    await t.run(async (ctx) => { await ctx.db.insert("supplierContacts", { id: "cy", organizationId: OTHER, supplierId: "s1", name: "Planted" }); });
    expect(await as(t).query(api.supplierRecord.contacts, { orgId: ORG, supplierId: "s1" })).toEqual([]);
  });
});

describe("documents", () => {
  test("add reads back with its file; Undo of the add detaches the row but NEVER deletes the file", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    const docs = await as(t).query(api.supplierRecord.documents, { orgId: ORG, supplierId: "s1" });
    expect(docs).toEqual([expect.objectContaining({ id: "d1", name: "Insurance", file: expect.objectContaining({ id: "f1", fileName: "f1.pdf" }) })]);
    const res = await as(t).mutation(api.supplierRecordWrites.undoDocumentAddNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "a2", now: NOW, actor });
    expect(res.restored).toBe(true);
    expect(await rows(t, "supplierDocuments")).toHaveLength(0);
    expect(await fileRow(t, "f1")).not.toBeNull();
  });

  test("an edited expiry is undone exactly, and refused when changed since", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    const renew = NOW + 400 * DAY;
    await as(t).mutation(api.supplierRecordWrites.updateDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", name: "Insurance", kind: "Insurance", expiryDate: renew, now: NOW, actor, auditId: "e1" });
    expect((await rows(t, "supplierDocuments"))[0].expiryDate).toBe(renew);
    await as(t).mutation(api.supplierRecordWrites.undoRowEditNative, { orgId: ORG, kind: "document", rowId: "d1", forwardAuditId: "e1", now: NOW, actor });
    expect((await rows(t, "supplierDocuments"))[0].expiryDate).toBe(NOW + 10 * DAY);

    await as(t).mutation(api.supplierRecordWrites.updateDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", name: "Insurance", kind: "Insurance", expiryDate: renew, now: NOW, actor, auditId: "e2" });
    await t.run(async (ctx) => { const d = (await ctx.db.query("supplierDocuments").collect())[0]; await ctx.db.patch(d._id, { expiryDate: renew + DAY }); });
    await expect(as(t).mutation(api.supplierRecordWrites.undoRowEditNative, { orgId: ORG, kind: "document", rowId: "d1", forwardAuditId: "e2", now: NOW, actor })).rejects.toThrow(/changed since/);
  });

  test("an Undo aimed at a different row than the edit's cannot restore it", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    await addDoc(t, { id: "d2", fileId: "f2", auditId: "a9" });
    await as(t).mutation(api.supplierRecordWrites.updateDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", name: "Renamed", now: NOW, actor, auditId: "e1" });
    await expect(as(t).mutation(api.supplierRecordWrites.undoRowEditNative, { orgId: ORG, kind: "document", rowId: "d2", forwardAuditId: "e1", now: NOW, actor })).rejects.toThrow(/not found/);
  });

  test("removing a document is the confirmed verb that deletes the stored file", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    await as(t).mutation(api.supplierRecordWrites.removeDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", now: NOW, actor, auditId: "r1" });
    expect(await rows(t, "supplierDocuments")).toHaveLength(0);
    expect(await fileRow(t, "f1")).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", "k_f1")).first())).toBeNull();
  });

  test("a foreign file cannot be attached, and a foreign supplier's documents read as empty", async () => {
    const t = makeT(); await seed(t);
    await expect(addDoc(t, { fileId: "fx" })).rejects.toThrow(/File not found/);
    expect(await rows(t, "supplierDocuments")).toHaveLength(0);
    await t.run(async (ctx) => { await ctx.db.insert("supplierDocuments", { id: "dx", organizationId: OTHER, supplierId: "sx", fileId: "fx", name: "Theirs" }); });
    expect(await as(t).query(api.supplierRecord.documents, { orgId: ORG, supplierId: "sx" })).toEqual([]);
  });

  test("deleting the supplier takes its contacts and documents (and their files) with it", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    await addDoc(t);
    await as(t).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW, actor, auditId: "x1" }).catch(() => undefined);
    // The seeded order blocks the delete (guard), so remove it first.
    await t.run(async (ctx) => { const o = await ctx.db.query("supplierOrders").first(); if (o) await ctx.db.delete(o._id); });
    await as(t).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW, actor, auditId: "x2" });
    expect(await rows(t, "supplierContacts")).toHaveLength(0);
    expect(await rows(t, "supplierDocuments")).toHaveLength(0);
    expect(await fileRow(t, "f1")).toBeNull();
  });
});

describe("order files", () => {
  test("add reads back; Undo detaches the row and keeps the file; remove deletes the file", async () => {
    const t = makeT(); await seed(t);
    await addOrderFile(t);
    await addOrderFile(t, { id: "of2", fileId: "f2", kind: "DOCKET", auditId: "a8" });
    const files = await as(t).query(api.supplierRecord.orderFiles, { orgId: ORG, orderId: "o1" });
    expect(files.map((f) => f.kind)).toEqual(["PO", "DOCKET"]);
    expect((await as(t).mutation(api.supplierRecordWrites.undoOrderFileAddNative, { orgId: ORG, orderId: "o1", forwardAuditId: "a3", now: NOW, actor })).restored).toBe(true);
    expect(await fileRow(t, "f1")).not.toBeNull();
    await as(t).mutation(api.supplierRecordWrites.removeOrderFileNative, { orgId: ORG, orderId: "o1", fileRowId: "of2", now: NOW, actor, auditId: "r2" });
    expect(await fileRow(t, "f2")).toBeNull();
    expect(await rows(t, "supplierOrderFiles")).toHaveLength(0);
  });

  test("an unknown kind and a foreign order are refused; foreign orders read as empty", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("supplierOrders", { id: "ox", organizationId: OTHER, supplierId: "sx", orderNumber: "X", type: "PURCHASE" }); });
    await expect(addOrderFile(t, { kind: "INVOICE" })).rejects.toThrow();
    await expect(addOrderFile(t, { orderId: "ox" })).rejects.toThrow(/Order not found/);
    expect(await as(t).query(api.supplierRecord.orderFiles, { orgId: ORG, orderId: "ox" })).toEqual([]);
  });

  test("deleting the order takes its files (and their stored bytes) with it", async () => {
    const t = makeT(); await seed(t);
    await addOrderFile(t);
    await as(t).mutation(api.supplierOrdersWrites.deleteNative, { id: "o1", orgId: ORG, now: NOW, actor, auditId: "d9" });
    expect(await rows(t, "supplierOrderFiles")).toHaveLength(0);
    expect(await fileRow(t, "f1")).toBeNull();
  });
});
