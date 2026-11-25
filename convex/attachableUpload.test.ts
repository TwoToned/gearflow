// @vitest-environment node
//
// The ONE rule for attaching a stored file to a record (convex/lib/attachableUpload.ts): the file is the
// actor's own recent upload, in the surface's folder, in this org, and held by nothing. Every holder is
// proven, and a schema walk fails when a new file-holding table is not registered.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect, vi } from "vitest";
import schema from "./schema";
import type { DatabaseReader } from "./_generated/server";
import { ATTACH_UPLOAD_MAX_AGE_MS, FILE_HOLDERS, NOT_FILE_HOLDERS, FINANCE_FOLDER_PREFIX, INVOICE_UPLOAD_FOLDER, assertAttachableUpload, isFileReferenced } from "./lib/attachableUpload";

type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1";
const FOLDER = "things";

const makeT = (): T => convexTest(schema, import.meta.glob("./**/*.ts"));
const db = (ctx: unknown) => (ctx as { db: DatabaseReader }).db;

async function addFile(t: T, id: string, over: { org?: string; by?: string; folder?: string; thumb?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("fileUploads", { id, organizationId: over.org ?? ORG, fileName: `${id}.pdf`, fileSize: 1, mimeType: "application/pdf", storageKey: `k_${id}`, url: `/api/files/k_${id}`, uploadedById: over.by ?? USER, ...(over.thumb ? { thumbnailUrl: over.thumb } : {}) });
    await ctx.db.insert("storedFiles", { storageId: `k_${id}`, organizationId: over.org ?? ORG, folder: over.folder ?? FOLDER });
  });
}
const referenced = (t: T, id: string, org = ORG) => t.run(async (ctx) => isFileReferenced(db(ctx), org, id));
const attach = (t: T, over: Partial<{ orgId: string; actorUserId: string; fileId: string; folder: string }> = {}) =>
  t.run(async (ctx) => assertAttachableUpload(db(ctx), { orgId: ORG, actorUserId: USER, fileId: "f", folder: FOLDER, ...over }));

describe("assertAttachableUpload", () => {
  test("passes for the actor's own fresh upload in the folder, held by nothing", async () => {
    const t = makeT(); await addFile(t, "f");
    await expect(attach(t)).resolves.not.toThrow();
  });

  test("refuses a missing file, another org's file, another user's, another folder, an old upload and a held file", async () => {
    const t = makeT();
    await addFile(t, "f"); await addFile(t, "foreign", { org: OTHER }); await addFile(t, "theirs", { by: "someone" }); await addFile(t, "elsewhere", { folder: "misc" });
    await expect(attach(t, { fileId: "nope" })).rejects.toThrow(/File not found/);
    await expect(attach(t, { fileId: "foreign" })).rejects.toThrow(/File not found/);
    await expect(attach(t, { fileId: "theirs" })).rejects.toThrow(/not uploaded by you/);
    await expect(attach(t, { fileId: "elsewhere" })).rejects.toThrow(/not uploaded for this/);
    await t.run(async (ctx) => { await ctx.db.insert("clientMedia", { id: "cm", organizationId: ORG, clientId: "c", fileId: "f" }); });
    await expect(attach(t)).rejects.toThrow(/already attached/);
    const t2 = makeT(); await addFile(t2, "f");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + ATTACH_UPLOAD_MAX_AGE_MS + 1000);
      await expect(attach(t2)).rejects.toThrow(/too old/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the file's stored record must be THIS org's too", async () => {
    const t = makeT(); await addFile(t, "f");
    await t.run(async (ctx) => { const s = (await ctx.db.query("storedFiles").first())!; await ctx.db.patch(s._id, { organizationId: OTHER }); });
    await expect(attach(t)).rejects.toThrow(/not uploaded for this/);
  });
});

describe("isFileReferenced: every holder", () => {
  const MEDIA: [string, Record<string, unknown>][] = [
    ["modelMedia", { modelId: "m" }], ["assetMedia", { assetId: "a" }], ["kitMedia", { kitId: "k" }], ["projectMedia", { projectId: "p" }],
    ["clientMedia", { clientId: "c" }], ["locationMedia", { locationId: "l" }], ["subHireMedia", { subHireId: "s" }],
    ["supplierDocuments", { supplierId: "s", name: "d" }], ["supplierOrderFiles", { orderId: "o", kind: "PO" }],
  ];
  test.each(MEDIA)("%s holds it", async (table, extra) => {
    const t = makeT(); await addFile(t, "f");
    expect(await referenced(t, "f")).toBe(false);
    await t.run(async (ctx) => { await ctx.db.insert(table as "clientMedia", { id: "h", organizationId: ORG, fileId: "f", ...extra } as never); });
    expect(await referenced(t, "f")).toBe(true);
  });

  test("an order's invoice holds it (invoice-folder file); an order scan too large to read counts as held", async () => {
    const t = makeT(); await addFile(t, "f", { folder: INVOICE_UPLOAD_FOLDER });
    expect(await referenced(t, "f")).toBe(false);
    await t.run(async (ctx) => { await ctx.db.insert("supplierOrders", { id: "o", organizationId: ORG, supplierId: "s", orderNumber: "PO", type: "PURCHASE", invoiceFileId: "f" }); });
    expect(await referenced(t, "f")).toBe(true);
    const t2 = makeT(); await addFile(t2, "f", { folder: INVOICE_UPLOAD_FOLDER });
    await t2.run(async (ctx) => { for (let i = 0; i < 5001; i++) await ctx.db.insert("supplierOrders", { id: `o${i}`, organizationId: ORG, supplierId: "s", orderNumber: `P${i}`, type: "PURCHASE" }); });
    expect(await referenced(t2, "f")).toBe(true); // fail closed: it cannot be proven unreferenced
  });

  test("finance PDFs are never attachable", async () => {
    const t = makeT(); await addFile(t, "f", { folder: `${FINANCE_FOLDER_PREFIX}quotes` });
    expect(await referenced(t, "f")).toBe(true);
  });

  test("maintenance photos and attachments hold it by URL, thumbnail or storage id, even on a record created BEFORE the file", async () => {
    const t = makeT();
    // A record that existed before the file did, then PATCHED later to hold it (maintenanceWrites update does this).
    await t.run(async (ctx) => { await ctx.db.insert("maintenanceRecords", { id: "old", organizationId: ORG, type: "REPAIR", title: "before", photos: [] } as never); });
    await addFile(t, "f", { thumb: "/api/files/k_f_thumb" });
    expect(await referenced(t, "f")).toBe(false);
    await t.run(async (ctx) => { const r = (await ctx.db.query("maintenanceRecords").first())!; await ctx.db.patch(r._id, { photos: ["/api/files/k_f"] } as never); });
    expect(await referenced(t, "f")).toBe(true);

    const t2 = makeT(); await addFile(t2, "f", { thumb: "/api/files/k_f_thumb" });
    await t2.run(async (ctx) => { await ctx.db.insert("maintenanceRecords", { id: "m2", organizationId: ORG, type: "REPAIR", title: "x", attachments: ["/api/files/k_f_thumb"] } as never); });
    expect(await referenced(t2, "f")).toBe(true);
  });

  test("check photos hold it (records created since the file; bounded, not claimed exact)", async () => {
    const t = makeT(); await addFile(t, "f");
    await t.run(async (ctx) => {
      await ctx.db.insert("checkRecords", { id: "cr", organizationId: ORG, context: "AD_HOC", checkItemId: "ci", checkItemLabelSnapshot: "l", checkItemTypeSnapshot: "PASS_FAIL", result: "FAIL", performedById: "u", photos: ["/api/files/k_f"] } as never);
    });
    expect(await referenced(t, "f")).toBe(true);
  });

  test("fail closed: a maintenance set too large to read, or more check records than the cap, counts as held", async () => {
    const t = makeT(); await addFile(t, "f");
    await t.run(async (ctx) => { for (let i = 0; i < 5001; i++) await ctx.db.insert("maintenanceRecords", { id: `m${i}`, organizationId: ORG, type: "REPAIR", title: "x" } as never); });
    expect(await referenced(t, "f")).toBe(true);
    const t2 = makeT(); await addFile(t2, "f");
    await t2.run(async (ctx) => {
      for (let i = 0; i < 2001; i++) await ctx.db.insert("checkRecords", { id: `c${i}`, organizationId: ORG, context: "AD_HOC", checkItemId: "ci", checkItemLabelSnapshot: "l", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: "u" } as never);
    });
    expect(await referenced(t2, "f")).toBe(true);
  });

  test("a missing or foreign file is held by nothing, and another org's holder never counts against an org's own check", async () => {
    const t = makeT(); await addFile(t, "f");
    expect(await referenced(t, "missing")).toBe(false);
    expect(await referenced(t, "f", OTHER)).toBe(false);
    await t.run(async (ctx) => { await ctx.db.insert("maintenanceRecords", { id: "mx", organizationId: OTHER, type: "REPAIR", title: "x", photos: ["/api/files/k_f"] } as never); });
    expect(await referenced(t, "f")).toBe(false); // a record of another org is not read for this org's file
  });
});

describe("the holder registry", () => {
  test("every file-shaped field in the schema belongs to a registered holder", () => {
    const FILE_FIELD = /(^fileId$|FileId$|FileIds$|^photos$|^attachments$|^image$|^images$|^logo$|^avatar$)/;
    const found: string[] = [];
    for (const [table, def] of Object.entries(schema.tables)) {
      const fields = (def as unknown as { validator: { fields: Record<string, unknown> } }).validator.fields;
      for (const f of Object.keys(fields)) if (FILE_FIELD.test(f)) found.push(`${table}.${f}`);
    }
    const registered = new Set<string>([...FILE_HOLDERS, ...Object.keys(NOT_FILE_HOLDERS)]);
    expect(found.filter((h) => !registered.has(h)), "register these in FILE_HOLDERS and isFileReferenced").toEqual([]);
    expect([...registered].filter((h) => !found.includes(h)), "FILE_HOLDERS / NOT_FILE_HOLDERS names a field that no longer exists").toEqual([]);
    for (const [field, reason] of Object.entries(NOT_FILE_HOLDERS)) expect(reason.length, `${field} needs a reason`).toBeGreaterThan(20);
  });
});
