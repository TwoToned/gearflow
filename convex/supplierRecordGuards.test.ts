// @vitest-environment node
//
// UX Phase 13 B3: the guards behind the supplier Contacts / Documents / order Files. The BLOCKER (a
// confirmed removal deletes the bytes of the file a row points at, so a row may only ever point at a file
// it just received) and every guard the verify found unpinned: each test below fails when that guard alone
// is removed.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { deleteStoredFile } from "./lib/deleteStoredFile";
import {
  MAX_CONTACTS_PER_SUPPLIER,
  MAX_DOCUMENTS_PER_SUPPLIER,
  MAX_FILES_PER_ORDER,
  SUPPLIER_DOCUMENTS_FOLDER as DOCS,
  SUPPLIER_INVOICE_FOLDER as INVOICES,
  SUPPLIER_ORDER_FILES_FOLDER as FILES,
} from "./lib/supplierRecordCore";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1";
const actor = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const as = (t: T, role = "admin", userId = USER) => t.withIdentity({ subject: userId, orgId: ORG, role });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const FILE_SEED = [
  ["f1", ORG, USER, DOCS], ["f2", ORG, USER, DOCS], ["g1", ORG, USER, FILES], ["g2", ORG, USER, FILES], ["f3", ORG, "someone-else", DOCS],
  ["f4", ORG, USER, "misc"], ["f5", ORG, USER, INVOICES], ["f6", ORG, USER, INVOICES], ["fx", OTHER, USER, DOCS], ["fy", OTHER, USER, FILES],
] as const;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: false });
    await ctx.db.insert("suppliers", { id: "s2", organizationId: ORG, name: "Second", isActive: true });
    await ctx.db.insert("suppliers", { id: "sx", organizationId: OTHER, name: "Foreign", isActive: true });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", status: "ORDERED", invoiceFileId: "f5" });
    for (const [id, org, by, folder] of FILE_SEED) {
      await ctx.db.insert("fileUploads", { id, organizationId: org, fileName: `${id}.pdf`, fileSize: 10, mimeType: "application/pdf", storageKey: `k_${id}`, url: `/api/files/k_${id}`, uploadedById: by });
      await ctx.db.insert("storedFiles", { storageId: `k_${id}`, organizationId: org, folder });
    }
  });
}
const rows = (t: T, table: "supplierContacts" | "supplierDocuments" | "supplierOrderFiles") =>
  t.run(async (ctx) => (await ctx.db.query(table).collect()) as Array<Record<string, unknown> & { id: string }>);
const fileRow = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const files = async (t: T, ids: string[]) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await fileRow(t, id)) != null])));

const W = api.supplierRecordWrites;
const addContact = (t: T, over: Record<string, unknown> = {}, who = as(t)) => who.mutation(W.addContactNative, { id: "c1", orgId: ORG, supplierId: "s1", name: "Priya", now: NOW, actor, auditId: "a1", ...over });
const addDoc = (t: T, over: Record<string, unknown> = {}, who = as(t)) => who.mutation(W.addDocumentNative, { id: "d1", orgId: ORG, supplierId: "s1", fileId: "f1", name: "Insurance", now: NOW, actor, auditId: "a2", ...over });
const addFile = (t: T, over: Record<string, unknown> = {}, who = as(t)) => who.mutation(W.addOrderFileNative, { id: "of1", orgId: ORG, orderId: "o1", fileId: "g1", kind: "PO", now: NOW, actor, auditId: "a3", ...over });
const log = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("BLOCKER: a row may only point at a file it just received", () => {
  test("a document refuses another user's upload, another folder, the order's invoice, an order file and another org's file", async () => {
    const t = makeT(); await seed(t);
    await expect(addDoc(t, { fileId: "f3" })).rejects.toThrow(/not uploaded by you/);
    await expect(addDoc(t, { fileId: "f4" })).rejects.toThrow(/not uploaded for this/);
    await expect(addDoc(t, { fileId: "f5" })).rejects.toThrow(/not uploaded for this/); // the order's invoice
    await expect(addDoc(t, { fileId: "g1" })).rejects.toThrow(/not uploaded for this/); // another order's file folder
    await expect(addDoc(t, { fileId: "fx" })).rejects.toThrow(/File not found/);
    expect(await rows(t, "supplierDocuments")).toHaveLength(0);
    expect(await files(t, ["f3", "f4", "f5", "g1", "fx"])).toEqual({ f3: true, f4: true, f5: true, g1: true, fx: true });
  });

  test("an order file refuses the same, an invoice file and a document file included", async () => {
    const t = makeT(); await seed(t);
    await expect(addFile(t, { fileId: "f3" })).rejects.toThrow(/not uploaded by you/);
    await expect(addFile(t, { fileId: "f4" })).rejects.toThrow(/not uploaded for this/);
    await expect(addFile(t, { fileId: "f5" })).rejects.toThrow(/not uploaded for this/);
    await expect(addFile(t, { fileId: "f1" })).rejects.toThrow(/not uploaded for this/);
    await expect(addFile(t, { fileId: "fy" })).rejects.toThrow(/File not found/);
    expect(await rows(t, "supplierOrderFiles")).toHaveLength(0);
  });

  test("an OLD upload is refused (the server clock decides)", async () => {
    const t = makeT(); await seed(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await expect(addDoc(t)).rejects.toThrow(/too old/);
      await expect(addFile(t)).rejects.toThrow(/too old/);
    } finally {
      vi.useRealTimers();
    }
    expect(await rows(t, "supplierDocuments")).toHaveLength(0);
  });

  test("a file already attached is refused, and the first row still owns it", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    await expect(addDoc(t, { id: "d2", auditId: "b1" })).rejects.toThrow(/already attached/);
    await expect(addDoc(t, { id: "d3", supplierId: "s2", auditId: "b2" })).rejects.toThrow(/already attached/); // even on another supplier
    await addFile(t);
    await expect(addFile(t, { id: "of2", auditId: "b3" })).rejects.toThrow(/already attached/);
    expect((await rows(t, "supplierDocuments")).map((d) => d.id)).toEqual(["d1"]);
  });

  test("the order's invoice: only the actor's own fresh invoice-folder upload can replace it; removing an attachment never touches it", async () => {
    const t = makeT(); await seed(t);
    const attach = (fileId: string, who = as(t)) => who.mutation(api.supplierOrdersWrites.attachInvoiceNative, { id: "o1", orgId: ORG, fileId, now: NOW, actor, auditId: `i_${fileId}` });
    await expect(attach("f1")).rejects.toThrow(/not uploaded for this/); // a document file
    await expect(attach("f3")).rejects.toThrow(/not uploaded by you/);
    await expect(attach("fx")).rejects.toThrow(/File not found/);
    await attach("f5"); // the file it already holds: idempotent
    expect(await files(t, ["f1", "f5"])).toEqual({ f1: true, f5: true });
    await attach("f6"); // a real replace: the superseded invoice goes, the new one stays
    expect(await files(t, ["f5", "f6"])).toEqual({ f5: false, f6: true });
    // A document / order-file removal deletes only its own file, never the invoice.
    await addDoc(t);
    await addFile(t);
    await as(t).mutation(W.removeDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", now: NOW, actor, auditId: "r1" });
    await as(t).mutation(W.removeOrderFileNative, { orgId: ORG, orderId: "o1", fileRowId: "of1", now: NOW, actor, auditId: "r2" });
    expect(await files(t, ["f1", "g1", "f6", "f2", "g2"])).toEqual({ f1: false, g1: false, f6: true, f2: true, g2: true });
  });

  test("removing one row deletes only that row's own file", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    await addDoc(t, { id: "d2", fileId: "f2", auditId: "b1" });
    await as(t).mutation(W.removeDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", now: NOW, actor, auditId: "r1" });
    expect(await files(t, ["f1", "f2", "f5", "g1"])).toEqual({ f1: false, f2: true, f5: true, g1: true });
    expect((await rows(t, "supplierDocuments")).map((d) => d.id)).toEqual(["d2"]);
  });
});

describe("deleteStoredFile and the delete cascades are org-checked", () => {
  test("deleteStoredFile never deletes another org's file, whatever id it is handed", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await deleteStoredFile(ctx as unknown as MutationCtx, "fx", ORG); });
    expect(await fileRow(t, "fx")).not.toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", "k_fx")).first())).not.toBeNull();
    await t.run(async (ctx) => { await deleteStoredFile(ctx as unknown as MutationCtx, "fx", OTHER); });
    expect(await fileRow(t, "fx")).toBeNull();
  });

  test("deleting a supplier leaves a foreign org's rows (and files) planted under the same supplier id", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.delete((await ctx.db.query("supplierOrders").first())!._id);
      await ctx.db.insert("supplierContacts", { id: "cf", organizationId: OTHER, supplierId: "s1", name: "Theirs" });
      await ctx.db.insert("supplierDocuments", { id: "df", organizationId: OTHER, supplierId: "s1", fileId: "fx", name: "Theirs" });
    });
    await addContact(t);
    await addDoc(t);
    await as(t).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW, actor, auditId: "x1" });
    expect((await rows(t, "supplierContacts")).map((c) => c.id)).toEqual(["cf"]);
    expect((await rows(t, "supplierDocuments")).map((d) => d.id)).toEqual(["df"]);
    expect(await files(t, ["f1", "fx"])).toEqual({ f1: false, fx: true });
  });

  test("deleting an order leaves a foreign org's file row (and file) planted under the same order id", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("supplierOrderFiles", { id: "ff", organizationId: OTHER, orderId: "o1", fileId: "fy", kind: "PO" }); });
    await addFile(t);
    await as(t).mutation(api.supplierOrdersWrites.deleteNative, { id: "o1", orgId: ORG, now: NOW, actor, auditId: "d9" });
    expect((await rows(t, "supplierOrderFiles")).map((f) => f.id)).toEqual(["ff"]);
    expect(await files(t, ["g1", "fy"])).toEqual({ g1: false, fy: true });
  });
});

describe("undo guards", () => {
  test("undoing an add of a document is refused once the document was edited", async () => {
    const t = makeT(); await seed(t);
    await addDoc(t);
    await as(t).mutation(W.updateDocumentNative, { orgId: ORG, supplierId: "s1", documentId: "d1", name: "Renamed", now: NOW + 5, actor, auditId: "e1" });
    await expect(as(t).mutation(W.undoDocumentAddNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "a2", now: NOW, actor })).rejects.toThrow(/edited since/);
    expect(await rows(t, "supplierDocuments")).toHaveLength(1);
  });

  test("undoing a contact removal: reports a contact that already exists, and refuses at the contact limit", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    await as(t).mutation(W.removeContactNative, { orgId: ORG, supplierId: "s1", contactId: "c1", now: NOW, actor, auditId: "r1" });
    await addContact(t, { auditId: "a9" }); // the same id comes back by another route
    const undo = () => as(t).mutation(W.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "r1", now: NOW, actor });
    expect(await undo()).toMatchObject({ restored: false, note: expect.stringMatching(/already exists/) });
    expect(await rows(t, "supplierContacts")).toHaveLength(1);

    const t2 = makeT(); await seed(t2);
    await addContact(t2);
    await as(t2).mutation(W.removeContactNative, { orgId: ORG, supplierId: "s1", contactId: "c1", now: NOW, actor, auditId: "r1" });
    await t2.run(async (ctx) => { for (let i = 0; i < MAX_CONTACTS_PER_SUPPLIER; i++) await ctx.db.insert("supplierContacts", { id: `fill${i}`, organizationId: ORG, supplierId: "s1", name: `c${i}` }); });
    await expect(as(t2).mutation(W.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "r1", now: NOW, actor })).rejects.toThrow(/contact limit/);
    expect(await rows(t2, "supplierContacts")).toHaveLength(MAX_CONTACTS_PER_SUPPLIER);
  });

  test("claimRowOpUndo: a forward row of another table, entity, entity type or org cannot be used", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    await addDoc(t);
    const undoContact = (over: Record<string, unknown>) => as(t).mutation(W.undoContactRowNative, { orgId: ORG, supplierId: "s1", forwardAuditId: "a1", now: NOW, actor, ...over });
    await expect(undoContact({ forwardAuditId: "a2" })).rejects.toThrow(/can't be undone/); // the document's add: wrong table
    await expect(undoContact({ supplierId: "s2" })).rejects.toThrow(/not found/); // another supplier of this org: wrong entity id
    const planted = (id: string, over: Record<string, unknown>) =>
      t.run(async (ctx) => {
        const fwd = (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first())!;
        const { _id, _creationTime, ...rest } = fwd;
        void _id; void _creationTime;
        await ctx.db.insert("activityLogs", { ...rest, id, ...over } as never);
      });
    await planted("wrongType", { entityType: "client" });
    await planted("otherOrg", { organizationId: OTHER });
    await expect(undoContact({ forwardAuditId: "wrongType" })).rejects.toThrow(/not found/);
    await expect(undoContact({ forwardAuditId: "otherOrg" })).rejects.toThrow(/not found/);
    expect(await rows(t, "supplierContacts")).toHaveLength(1);
  });

  test("the Undo window runs from the SERVER clock at save, never the caller's `now`", async () => {
    const t = makeT(); await seed(t);
    const before = Date.now();
    await addContact(t, { now: 1 });
    const row = (await log(t, "a1"))?.details as { rowOp: { serverSavedAt: number } };
    expect(row.rowOp.serverSavedAt).toBeGreaterThanOrEqual(before);
    expect(row.rowOp.serverSavedAt).toBeLessThan(Date.now() + 1000);
  });
});

describe("limits, duplicates and the kill-switch", () => {
  test("the caps are enforced: 50 contacts, 100 documents, 50 files per order", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_CONTACTS_PER_SUPPLIER; i++) await ctx.db.insert("supplierContacts", { id: `c${i}`, organizationId: ORG, supplierId: "s1", name: `c${i}` });
      for (let i = 0; i < MAX_DOCUMENTS_PER_SUPPLIER; i++) await ctx.db.insert("supplierDocuments", { id: `d${i}`, organizationId: ORG, supplierId: "s1", fileId: `none${i}`, name: `d${i}` });
      for (let i = 0; i < MAX_FILES_PER_ORDER; i++) await ctx.db.insert("supplierOrderFiles", { id: `of${i}`, organizationId: ORG, orderId: "o1", fileId: `none${i}`, kind: "PO" });
    });
    await expect(addContact(t, { id: "new" })).rejects.toThrow(/at most 50 contacts/);
    await expect(addDoc(t, { id: "new" })).rejects.toThrow(/at most 100 documents/);
    await expect(addFile(t, { id: "new" })).rejects.toThrow(/at most 50 files/);
  });

  test("a repeated id is refused for contacts, documents and order files", async () => {
    const t = makeT(); await seed(t);
    await addContact(t);
    await expect(addContact(t, { auditId: "b1" })).rejects.toThrow(/already exists/);
    await addDoc(t);
    await expect(addDoc(t, { fileId: "f2", auditId: "b2" })).rejects.toThrow(/already exists/);
    await addFile(t);
    await expect(addFile(t, { fileId: "g2", auditId: "b3" })).rejects.toThrow(/already exists/);
  });

  test("the writes kill-switch stops every one of them", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("systemFlags", { writesDisabled: true, disabledReason: "maintenance" }); });
    await expect(addContact(t)).rejects.toThrow(/temporarily disabled/);
    await expect(addDoc(t)).rejects.toThrow(/temporarily disabled/);
    await expect(addFile(t)).rejects.toThrow(/temporarily disabled/);
    expect(await rows(t, "supplierContacts")).toHaveLength(0);
  });
});

describe("the reads drop foreign rows and foreign files (table-driven)", () => {
  test("contacts, documents and order files never include another org's row, and a foreign file is never returned", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierContacts", { id: "cf", organizationId: OTHER, supplierId: "s1", name: "Planted" });
      await ctx.db.insert("supplierDocuments", { id: "df", organizationId: OTHER, supplierId: "s1", fileId: "fx", name: "Planted" });
      await ctx.db.insert("supplierDocuments", { id: "dm", organizationId: ORG, supplierId: "s1", fileId: "fx", name: "Mine, pointing at a foreign file" });
      await ctx.db.insert("supplierOrderFiles", { id: "ff", organizationId: OTHER, orderId: "o1", fileId: "fy", kind: "PO" });
      await ctx.db.insert("supplierOrderFiles", { id: "fm", organizationId: ORG, orderId: "o1", fileId: "fy", kind: "PO" });
    });
    const reads = {
      contacts: await as(t).query(api.supplierRecord.contacts, { orgId: ORG, supplierId: "s1" }),
      documents: await as(t).query(api.supplierRecord.documents, { orgId: ORG, supplierId: "s1" }),
      orderFiles: await as(t).query(api.supplierRecord.orderFiles, { orgId: ORG, orderId: "o1" }),
    };
    expect(reads.contacts).toEqual([]);
    expect(reads.documents.map((d) => d.id)).toEqual(["dm"]);
    expect(reads.orderFiles.map((f) => f.id)).toEqual(["fm"]);
    expect(reads.documents[0].file).toBeNull();
    expect(reads.orderFiles[0].file).toBeNull();
    expect(JSON.stringify(reads)).not.toMatch(/k_fx|k_fy|Planted/);
  });
});
