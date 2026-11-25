import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import { diffFields, recordFieldEdit, undoFieldEdit, type FieldValue } from "./lib/fieldEditUndo";
import { claimRowOpUndo, recordRowOp } from "./lib/rowOpUndo";
import { deleteStoredFileIfUnreferenced } from "./lib/deleteStoredFile";
import { writeActivityLog } from "./lib/audit";
import { collectCapped } from "./lib/pagination";
import { assertAttachableUpload } from "./lib/attachableUpload";
import {
  SUPPLIER_DOCUMENTS_FOLDER,
  SUPPLIER_ORDER_FILES_FOLDER,
  MAX_CONTACTS_PER_SUPPLIER,
  MAX_DOCUMENTS_PER_SUPPLIER,
  MAX_FILES_PER_ORDER,
  contactHasSubstance,
  orderFileKind,
} from "./lib/supplierRecordCore";

/**
 * The supplier record's Contacts and Documents, and the order's Files (UX Phase 13, B3).
 * Browser-direct, gated on `supplier:update` (they are sub-resources of a supplier / its
 * order; no new RBAC resource). Standard shape: 4 guards + per-row org re-check (every
 * parent and child is fetched by the GLOBAL `by_cuid` index) + atomic audit.
 *
 * UNDO (ids only, server-side, author + window + once; see `fieldEditUndo` / `rowOpUndo`):
 *  - an ADD is undone by detaching the row (a document's / file's stored bytes STAY: an Undo
 *    never deletes a stored file);
 *  - a contact REMOVAL is undone by re-creating the row from the audit snapshot;
 *  - an EDIT is undone by the shared per-field compare-and-set;
 *  - removing a DOCUMENT or ORDER FILE deletes the stored bytes for good, so it is a confirmed
 *    verb with NO Undo (the same rule as removing an order's invoice).
 * Add/remove audit rows fold under the supplier (or order) so they show in its History; an
 * edit's row is under the row itself, so its Undo cannot be pointed at a different row.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function guards(ctx: MutationCtx, orgId: string) {
  await assertWritesEnabled(ctx, "supplier");
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, "supplier", "update");
}

async function loadSupplier(ctx: MutationCtx, orgId: string, id: string) {
  const s = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!s || s.organizationId !== orgId) throw new ConvexError("Supplier not found");
  return s;
}

async function loadOrder(ctx: MutationCtx, orgId: string, id: string) {
  const o = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!o || o.organizationId !== orgId) throw new ConvexError("Order not found");
  return o;
}

/**
 * A document's file must be the ACTOR's own recent upload into the `supplier-documents` folder and held by
 * nothing (`assertAttachableUpload`, the one shared rule): a confirmed removal deletes the bytes of the file a
 * row points at, so a row may only ever point at a file it just received. The folder is also what keeps an
 * order's invoice, a check photo or another surface's file from being attached here.
 */
const assertDocumentFile = (ctx: MutationCtx, a: { orgId: string; userId: string; fileId: string }) =>
  assertAttachableUpload(ctx.db, { orgId: a.orgId, actorUserId: a.userId, fileId: a.fileId, folder: SUPPLIER_DOCUMENTS_FOLDER });

/** An order file's file: the same proof, in the `supplier-order-files` folder. */
const assertOrderFile = (ctx: MutationCtx, a: { orgId: string; userId: string; fileId: string }) =>
  assertAttachableUpload(ctx.db, { orgId: a.orgId, actorUserId: a.userId, fileId: a.fileId, folder: SUPPLIER_ORDER_FILES_FOLDER });

// ─── Contacts ───────────────────────────────────────────────────────────────────────

const CONTACT_FIELDS = ["name", "role", "email", "phone", "notes"] as const;
const contactArgs = {
  name: v.optional(v.string()),
  role: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  notes: v.optional(v.string()),
};

/** Mirrors the contact form's bounds (R-8.6.2: the browser's Zod parse is bypassable). */
function assertContact(f: { name?: string; role?: string; email?: string; phone?: string; notes?: string }): void {
  assertStrLen(f.name, "name", { max: 200 });
  assertStrLen(f.role, "role", { max: 100 });
  assertStrLen(f.email, "email", { max: 200 });
  assertStrLen(f.phone, "phone", { max: 50 });
  assertStrLen(f.notes, "notes", { max: 500 });
  if (!contactHasSubstance(f)) throw new ConvexError({ code: "INVALID_FIELD", message: "Provide at least a name, email, or phone number." });
}

/** An empty string means cleared (Convex optionals reject null). */
const blank = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);
const contactValues = (f: { name?: string; role?: string; email?: string; phone?: string; notes?: string }) => ({
  name: blank(f.name), role: blank(f.role), email: blank(f.email), phone: blank(f.phone), notes: blank(f.notes),
});

const contactLabel = (c: { name?: string; email?: string; phone?: string }) => c.name || c.email || c.phone || "contact";

export const addContactNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), supplierId: v.string(), ...contactArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const f = contactValues(a);
    assertContact(f);
    const supplier = await loadSupplier(ctx, a.orgId, a.supplierId);
    if (await ctx.db.query("supplierContacts").withIndex("by_cuid", (q) => q.eq("id", a.id)).first()) throw new ConvexError("Supplier contact already exists");
    const existing = await collectCapped(ctx.db.query("supplierContacts").withIndex("by_supplierId", (q) => q.eq("supplierId", a.supplierId)), MAX_CONTACTS_PER_SUPPLIER + 1);
    if (existing.rows.filter((c) => c.organizationId === a.orgId).length >= MAX_CONTACTS_PER_SUPPLIER) {
      throw new ConvexError(`A supplier can have at most ${MAX_CONTACTS_PER_SUPPLIER} contacts.`);
    }
    await ctx.db.insert("supplierContacts", { id: a.id, organizationId: a.orgId, supplierId: a.supplierId, ...f, createdAt: a.now, updatedAt: a.now });
    await recordRowOp(ctx, {
      orgId: a.orgId, entityType: "supplier", entityId: a.supplierId, entityName: supplier.name, auditId: a.auditId, actor, now: a.now, action: "UPDATE",
      summary: `Added contact ${contactLabel(f)} to supplier ${supplier.name}`, op: { op: "add", table: "supplierContacts", rowId: a.id, snapshot: null },
    });
    return { id: a.id };
  },
});

async function loadContact(ctx: MutationCtx, orgId: string, supplierId: string, contactId: string) {
  const c = await ctx.db.query("supplierContacts").withIndex("by_cuid", (q) => q.eq("id", contactId)).first();
  if (!c || c.organizationId !== orgId || c.supplierId !== supplierId) throw new ConvexError("That contact is not on this supplier.");
  return c;
}

export const updateContactNative = mutation({
  returns: v.object({ changed: v.boolean() }),
  args: { orgId: v.string(), supplierId: v.string(), contactId: v.string(), ...contactArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const f = contactValues(a);
    assertContact(f);
    const contact = await loadContact(ctx, a.orgId, a.supplierId, a.contactId);
    const diff = diffFields(contact, { ...contact, ...f }, CONTACT_FIELDS);
    if (!diff) return { changed: false };
    const patch: Record<string, unknown> = { ...f, updatedAt: a.now };
    await ctx.db.patch(contact._id, patch);
    await recordFieldEdit(ctx, {
      orgId: a.orgId, entityType: "supplierContact", entityId: a.contactId, entityName: contactLabel(f), auditId: a.auditId, actor, now: a.now, diff,
      summary: `Edited contact ${contactLabel(f)}`,
    });
    return { changed: true };
  },
});

export const removeContactNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), supplierId: v.string(), contactId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const supplier = await loadSupplier(ctx, a.orgId, a.supplierId);
    const contact = await loadContact(ctx, a.orgId, a.supplierId, a.contactId);
    const snapshot: Record<string, FieldValue> = { id: contact.id, createdAt: contact.createdAt ?? null, updatedAt: contact.updatedAt ?? null };
    for (const k of CONTACT_FIELDS) snapshot[k] = contact[k] ?? null;
    await ctx.db.delete(contact._id);
    await recordRowOp(ctx, {
      orgId: a.orgId, entityType: "supplier", entityId: a.supplierId, entityName: supplier.name, auditId: a.auditId, actor, now: a.now, action: "UPDATE",
      summary: `Removed contact ${contactLabel(contact)} from supplier ${supplier.name}`, op: { op: "remove", table: "supplierContacts", rowId: a.contactId, snapshot },
    });
    return { id: a.contactId };
  },
});

/** Undo an add or a removal of a contact. Ids only. */
export const undoContactRowNative = mutation({
  returns: v.object({ restored: v.boolean(), note: v.optional(v.string()) }),
  args: { orgId: v.string(), supplierId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const supplier = await loadSupplier(ctx, a.orgId, a.supplierId);
    const op = await claimRowOpUndo(ctx, { orgId: a.orgId, entityType: "supplier", entityId: a.supplierId, entityName: supplier.name, auditId: a.forwardAuditId, actor, now: a.now, table: "supplierContacts" });
    return op.op === "add" ? await undoContactAdd(ctx, a.orgId, op.rowId) : await undoContactRemove(ctx, a.orgId, a.supplierId, op.snapshot);
  },
});

async function undoContactAdd(ctx: MutationCtx, orgId: string, rowId: string) {
  const row = await ctx.db.query("supplierContacts").withIndex("by_cuid", (q) => q.eq("id", rowId)).first();
  if (!row || row.organizationId !== orgId) return { restored: false, note: "The contact was already removed." };
  if (row.updatedAt !== row.createdAt) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the contact was edited since." });
  await ctx.db.delete(row._id);
  return { restored: true };
}

async function undoContactRemove(ctx: MutationCtx, orgId: string, supplierId: string, snapshot: Record<string, FieldValue> | null) {
  if (!snapshot || typeof snapshot.id !== "string") throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
  if (await ctx.db.query("supplierContacts").withIndex("by_cuid", (q) => q.eq("id", snapshot.id as string)).first()) {
    return { restored: false, note: "The contact already exists." };
  }
  const existing = await collectCapped(ctx.db.query("supplierContacts").withIndex("by_supplierId", (q) => q.eq("supplierId", supplierId)), MAX_CONTACTS_PER_SUPPLIER + 1);
  if (existing.rows.filter((c) => c.organizationId === orgId).length >= MAX_CONTACTS_PER_SUPPLIER) throw new ConvexError("The supplier is at its contact limit, so the contact can't be restored.");
  const str = (k: string) => (typeof snapshot[k] === "string" ? (snapshot[k] as string) : undefined);
  const num = (k: string) => (typeof snapshot[k] === "number" ? (snapshot[k] as number) : undefined);
  await ctx.db.insert("supplierContacts", {
    id: snapshot.id, organizationId: orgId, supplierId, name: str("name"), role: str("role"), email: str("email"), phone: str("phone"), notes: str("notes"),
    createdAt: num("createdAt"), updatedAt: num("updatedAt"),
  });
  return { restored: true };
}

// ─── Documents ──────────────────────────────────────────────────────────────────────

const DOC_FIELDS = ["name", "kind", "expiryDate", "notes"] as const;
const docArgs = { name: v.string(), kind: v.optional(v.string()), expiryDate: v.optional(v.number()), notes: v.optional(v.string()) };

function assertDocument(f: { name: string; kind?: string; notes?: string }): void {
  assertStrLen(f.name, "name", { min: 1, max: 200 });
  assertStrLen(f.kind, "kind", { max: 60 });
  assertStrLen(f.notes, "notes", { max: 500 });
}

const docValues = (f: { name: string; kind?: string; expiryDate?: number; notes?: string }) => ({
  name: f.name.trim(), kind: blank(f.kind), expiryDate: f.expiryDate, notes: blank(f.notes),
});

export const addDocumentNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), supplierId: v.string(), fileId: v.string(), ...docArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const f = docValues(a);
    assertDocument(f);
    const supplier = await loadSupplier(ctx, a.orgId, a.supplierId);
    await assertDocumentFile(ctx, { orgId: a.orgId, userId: actor.userId, fileId: a.fileId });
    if (await ctx.db.query("supplierDocuments").withIndex("by_cuid", (q) => q.eq("id", a.id)).first()) throw new ConvexError("Supplier document already exists");
    const existing = await collectCapped(ctx.db.query("supplierDocuments").withIndex("by_supplierId", (q) => q.eq("supplierId", a.supplierId)), MAX_DOCUMENTS_PER_SUPPLIER + 1);
    if (existing.rows.filter((d) => d.organizationId === a.orgId).length >= MAX_DOCUMENTS_PER_SUPPLIER) throw new ConvexError(`A supplier can have at most ${MAX_DOCUMENTS_PER_SUPPLIER} documents.`);
    await ctx.db.insert("supplierDocuments", { id: a.id, organizationId: a.orgId, supplierId: a.supplierId, fileId: a.fileId, ...f, createdAt: a.now, updatedAt: a.now });
    await recordRowOp(ctx, {
      orgId: a.orgId, entityType: "supplier", entityId: a.supplierId, entityName: supplier.name, auditId: a.auditId, actor, now: a.now, action: "UPDATE",
      summary: `Added document ${f.name} to supplier ${supplier.name}`, op: { op: "add", table: "supplierDocuments", rowId: a.id, snapshot: null },
    });
    return { id: a.id };
  },
});

async function loadDocument(ctx: MutationCtx, orgId: string, supplierId: string, documentId: string) {
  const d = await ctx.db.query("supplierDocuments").withIndex("by_cuid", (q) => q.eq("id", documentId)).first();
  if (!d || d.organizationId !== orgId || d.supplierId !== supplierId) throw new ConvexError("That document is not on this supplier.");
  return d;
}

export const updateDocumentNative = mutation({
  returns: v.object({ changed: v.boolean() }),
  args: { orgId: v.string(), supplierId: v.string(), documentId: v.string(), ...docArgs, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const f = docValues(a);
    assertDocument(f);
    const doc = await loadDocument(ctx, a.orgId, a.supplierId, a.documentId);
    const diff = diffFields(doc, { ...doc, ...f }, DOC_FIELDS);
    if (!diff) return { changed: false };
    await ctx.db.patch(doc._id, { ...f, updatedAt: a.now });
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "supplierDocument", entityId: a.documentId, entityName: f.name, auditId: a.auditId, actor, now: a.now, diff, summary: `Edited document ${f.name}` });
    return { changed: true };
  },
});

/** Removing a document deletes its stored file for good: confirmed in the UI, no Undo. */
export const removeDocumentNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), supplierId: v.string(), documentId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const supplier = await loadSupplier(ctx, a.orgId, a.supplierId);
    const doc = await loadDocument(ctx, a.orgId, a.supplierId, a.documentId);
    await ctx.db.delete(doc._id);
    await deleteStoredFileIfUnreferenced(ctx, a.orgId, doc.fileId);
    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "DELETE", entityType: "supplier", entityId: a.supplierId, entityName: supplier.name,
      userId: actor.userId, userName: actor.userName, summary: `Removed document ${doc.name} from supplier ${supplier.name}`, createdAt: a.now,
    });
    return { id: a.documentId };
  },
});

/** Undo an ADD of a document: detach the row; the uploaded file STAYS in storage. */
export const undoDocumentAddNative = mutation({
  returns: v.object({ restored: v.boolean(), note: v.optional(v.string()) }),
  args: { orgId: v.string(), supplierId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const supplier = await loadSupplier(ctx, a.orgId, a.supplierId);
    const op = await claimRowOpUndo(ctx, { orgId: a.orgId, entityType: "supplier", entityId: a.supplierId, entityName: supplier.name, auditId: a.forwardAuditId, actor, now: a.now, table: "supplierDocuments" });
    const row = await ctx.db.query("supplierDocuments").withIndex("by_cuid", (q) => q.eq("id", op.rowId)).first();
    if (!row || row.organizationId !== a.orgId) return { restored: false, note: "The document was already removed." };
    if (row.updatedAt !== row.createdAt) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the document was edited since." });
    await ctx.db.delete(row._id);
    return { restored: true };
  },
});

// ─── Undo of an edit (contact or document) ──────────────────────────────────────────

const planPatch = (plan: { set: Record<string, unknown>; clear: string[] }, now: number) => {
  const patch: Record<string, unknown> = { ...plan.set, updatedAt: now };
  for (const f of plan.clear) patch[f] = undefined;
  return patch;
};

/** The exact Undo of an edit: ids only (the FORWARD `auditId`); refuses as a whole unless still exact. */
export const undoRowEditNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: { orgId: v.string(), kind: v.union(v.literal("contact"), v.literal("document")), rowId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const base = { orgId: a.orgId, entityId: a.rowId, auditId: a.forwardAuditId, actor, now: a.now };
    if (a.kind === "contact") {
      const load = async () => {
        const row = await ctx.db.query("supplierContacts").withIndex("by_cuid", (q) => q.eq("id", a.rowId)).first();
        return row && row.organizationId === a.orgId ? row : null;
      };
      const row = await load();
      return await undoFieldEdit(ctx, { ...base, entityType: "supplierContact", entityName: row ? contactLabel(row) : a.rowId, load, apply: async (doc, plan) => ctx.db.patch(doc._id, planPatch(plan, a.now)) });
    }
    const load = async () => {
      const row = await ctx.db.query("supplierDocuments").withIndex("by_cuid", (q) => q.eq("id", a.rowId)).first();
      return row && row.organizationId === a.orgId ? row : null;
    };
    const row = await load();
    return await undoFieldEdit(ctx, { ...base, entityType: "supplierDocument", entityName: row?.name ?? a.rowId, load, apply: async (doc, plan) => ctx.db.patch(doc._id, planPatch(plan, a.now)) });
  },
});

// ─── Order files (PO / docket / other) ──────────────────────────────────────────────

export const addOrderFileNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), orderId: v.string(), fileId: v.string(), kind: orderFileKind, name: v.optional(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    assertStrLen(a.name, "name", { max: 200 });
    const order = await loadOrder(ctx, a.orgId, a.orderId);
    await assertOrderFile(ctx, { orgId: a.orgId, userId: actor.userId, fileId: a.fileId });
    if (await ctx.db.query("supplierOrderFiles").withIndex("by_cuid", (q) => q.eq("id", a.id)).first()) throw new ConvexError("Order file already exists");
    const existing = await collectCapped(ctx.db.query("supplierOrderFiles").withIndex("by_orderId", (q) => q.eq("orderId", a.orderId)), MAX_FILES_PER_ORDER + 1);
    if (existing.rows.filter((f) => f.organizationId === a.orgId).length >= MAX_FILES_PER_ORDER) throw new ConvexError(`An order can have at most ${MAX_FILES_PER_ORDER} files.`);
    await ctx.db.insert("supplierOrderFiles", { id: a.id, organizationId: a.orgId, orderId: a.orderId, fileId: a.fileId, kind: a.kind, name: blank(a.name), createdAt: a.now });
    await recordRowOp(ctx, {
      orgId: a.orgId, entityType: "supplierOrder", entityId: a.orderId, entityName: order.orderNumber, auditId: a.auditId, actor, now: a.now, action: "UPDATE",
      summary: `Attached a file to order ${order.orderNumber}`, op: { op: "add", table: "supplierOrderFiles", rowId: a.id, snapshot: null },
    });
    return { id: a.id };
  },
});

/** Removing an order file deletes its stored bytes for good: confirmed in the UI, no Undo. */
export const removeOrderFileNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), orderId: v.string(), fileRowId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const order = await loadOrder(ctx, a.orgId, a.orderId);
    const row = await ctx.db.query("supplierOrderFiles").withIndex("by_cuid", (q) => q.eq("id", a.fileRowId)).first();
    if (!row || row.organizationId !== a.orgId || row.orderId !== a.orderId) throw new ConvexError("That file is not on this order.");
    await ctx.db.delete(row._id);
    await deleteStoredFileIfUnreferenced(ctx, a.orgId, row.fileId);
    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "DELETE", entityType: "supplierOrder", entityId: a.orderId, entityName: order.orderNumber,
      userId: actor.userId, userName: actor.userName, summary: `Removed a file from order ${order.orderNumber}`, createdAt: a.now,
    });
    return { id: a.fileRowId };
  },
});

/** Undo an ADD of an order file: detach the row; the uploaded file STAYS in storage. */
export const undoOrderFileAddNative = mutation({
  returns: v.object({ restored: v.boolean(), note: v.optional(v.string()) }),
  args: { orgId: v.string(), orderId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const order = await loadOrder(ctx, a.orgId, a.orderId);
    const op = await claimRowOpUndo(ctx, { orgId: a.orgId, entityType: "supplierOrder", entityId: a.orderId, entityName: order.orderNumber, auditId: a.forwardAuditId, actor, now: a.now, table: "supplierOrderFiles" });
    const row = await ctx.db.query("supplierOrderFiles").withIndex("by_cuid", (q) => q.eq("id", op.rowId)).first();
    if (!row || row.organizationId !== a.orgId) return { restored: false, note: "The file was already removed." };
    await ctx.db.delete(row._id);
    return { restored: true };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addContactNative: { danger: "low" },
  updateContactNative: { danger: "low" },
  removeContactNative: { danger: "medium" },
  undoContactRowNative: { danger: "high" },
  addDocumentNative: { danger: "low" },
  updateDocumentNative: { danger: "low" },
  removeDocumentNative: { danger: "high" },
  undoDocumentAddNative: { danger: "high" },
  undoRowEditNative: { danger: "high" },
  addOrderFileNative: { danger: "low" },
  removeOrderFileNative: { danger: "high" },
  undoOrderFileAddNative: { danger: "high" },
};
