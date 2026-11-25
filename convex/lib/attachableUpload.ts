import { ConvexError } from "convex/values";
import type { DatabaseReader } from "../_generated/server";
import { collectCapped } from "./pagination";
import { storageIdOf } from "./checkPhotos";

/**
 * THE rule for attaching a stored file to a record (the `checkPhotos` proof, generalised).
 *
 * Attaching is the dangerous half of a file's life: removing a record (or replacing a file on it)
 * deletes the bytes of whatever file the row points at. A row must therefore only ever point at a file
 * it just received, and never at one something else holds. `assertAttachableUpload` proves, for a
 * `fileUploads` id fetched by the GLOBAL `by_cuid` index, that the file is:
 *  - this org's;
 *  - the ACTOR's own upload (`uploadedById`), never someone else's;
 *  - recent: uploaded within {@link ATTACH_UPLOAD_MAX_AGE_MS} on the SERVER clock (`_creationTime`), i.e. the
 *    upload the form that is attaching it just made, not a file found lying around;
 *  - in the `storedFiles` folder the attaching surface uploads into (this org's), which is what keeps an
 *    invoice, a check photo, a quote PDF or model media from being attached somewhere else;
 *  - referenced by NOTHING ({@link isFileReferenced}), so one file is never held by two rows that could
 *    each delete it.
 * Every refusal is a ConvexError and writes nothing. Both Phase 13 (supplier documents and files) and
 * Phase 10 (`mediaWrites`) use this one function.
 *
 * HOLDERS: `isFileReferenced` knows every place a `fileUploads` file can be held. They are listed in
 * {@link FILE_HOLDERS}; a test walks `convex/schema.ts` for every `fileId`-shaped, `photos` and
 * `attachments` field and fails when a table is not registered, so a new holder cannot be forgotten.
 */
export const ATTACH_UPLOAD_MAX_AGE_MS = 10 * 60 * 1000;

/** Quote and invoice PDFs are stored by the server under these folders and are never attachable. */
export const FINANCE_FOLDER_PREFIX = "finance/";
/** The folder an order's invoice is uploaded into (`supplierOrders.invoiceFileId`). */
export const INVOICE_UPLOAD_FOLDER = "supplier-order-invoices";

/** Every `table.field` that can hold a file; the schema test requires each file-shaped field to be listed. */
/**
 * File-ish fields that are NOT holders of a `fileUploads` file, each with the reason it is safe to leave out.
 * The schema-walk test requires every `image` / `images` / `logo` / `avatar` field to be listed here or in
 * {@link FILE_HOLDERS}, so a new one cannot be silently missed.
 */
export const NOT_FILE_HOLDERS: Record<string, string> = {
  "users.image": "Better Auth profile image: set by the account flow from its own upload, never from a fileUploads row.",
  "organizations.logo": "Organisation logo: written by the settings flow from its own upload, never from a fileUploads row.",
  "crewMembers.image": "Crew avatar: `/api/crew/avatar` stores it in storedFiles without a fileUploads row, so there is no fileId to attach.",
  "models.image": "Denormalised primary-image URL; the attachable holder is `modelMedia.fileId` (indexed, in FILE_HOLDERS).",
  "models.images": "Denormalised image URLs; the attachable holder is `modelMedia.fileId` (indexed, in FILE_HOLDERS).",
  "kits.image": "Denormalised primary-image URL; the attachable holder is `kitMedia.fileId` (indexed, in FILE_HOLDERS).",
  "kits.images": "Denormalised image URLs; the attachable holder is `kitMedia.fileId` (indexed, in FILE_HOLDERS).",
  "assets.images": "Denormalised image URLs; the attachable holder is `assetMedia.fileId` (indexed, in FILE_HOLDERS).",
};

export const FILE_HOLDERS = [
  "modelMedia.fileId", "assetMedia.fileId", "kitMedia.fileId", "projectMedia.fileId", "clientMedia.fileId", "locationMedia.fileId", "subHireMedia.fileId",
  "supplierDocuments.fileId", "supplierOrderFiles.fileId",
  "supplierOrders.invoiceFileId",
  "maintenanceRecords.photos", "maintenanceRecords.attachments", "checkRecords.photos",
  "quotes.pdfFileId", "quotes.recalledPdfFileIds", "invoices.pdfFileId",
] as const;

const INVOICE_SCAN_CAP = 5000;

/** The media-style tables, each indexed `by_fileId`. */
async function heldByIndexedTable(db: DatabaseReader, fileId: string): Promise<boolean> {
  const hits = await Promise.all([
    db.query("modelMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("assetMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("kitMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("projectMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("clientMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("locationMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("subHireMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("supplierDocuments").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
    db.query("supplierOrderFiles").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
  ]);
  return hits.some((h) => h != null);
}

/** `supplierOrders.invoiceFileId` has no index, so the org's orders are scanned (bounded; unprovable = referenced). */
async function heldAsInvoice(db: DatabaseReader, orgId: string, fileId: string): Promise<boolean> {
  const orders = await collectCapped(db.query("supplierOrders").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), INVOICE_SCAN_CAP);
  return orders.truncated || orders.rows.some((o) => o.invoiceFileId === fileId);
}

/**
 * Photo / attachment arrays hold URLs, so they are scanned. NOT bounded by the file's age: a record can be
 * PATCHED later to hold a file that did not exist when it was created (`maintenanceWrites` update and
 * `maintenanceRecords.update` both take `photos` / `attachments`), so the only exact answer for
 * `maintenanceRecords` is the org's whole set, read bounded (when the cap bites we cannot prove it
 * unreferenced, so the file counts as referenced: fail closed).
 *
 * `checkRecords.photos` is set when a check is saved (the app never patches it; only the service-only generic
 * `checkRecords.update` could), so only this org's records created at or after the file are read. That bound
 * is deliberately NOT claimed exact: a service-token patch of an older check record would be missed.
 */
const MAINTENANCE_SCAN_CAP = 5000;
const CHECK_SCAN_CAP = 2000;

async function heldInPhotoArrays(db: DatabaseReader, orgId: string, file: { id: string; url: string; thumbnailUrl?: string; storageKey: string; _creationTime: number }): Promise<boolean> {
  const needles = new Set([file.id, file.url, file.storageKey, ...(file.thumbnailUrl ? [file.thumbnailUrl] : [])]);
  const holds = (values: string[] | undefined) => (values ?? []).some((v) => needles.has(v) || needles.has(storageIdOf(v) ?? ""));
  const maintenance = await collectCapped(db.query("maintenanceRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), MAINTENANCE_SCAN_CAP);
  if (maintenance.truncated) return true; // cannot prove it unreferenced: fail closed
  if (maintenance.rows.some((r) => holds(r.photos) || holds(r.attachments))) return true;
  const checks = await collectCapped(db.query("checkRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId).gte("_creationTime", file._creationTime)), CHECK_SCAN_CAP);
  if (checks.truncated) return true; // fail closed
  return checks.rows.some((r) => holds(r.photos));
}

/** Is this org's `fileUploads` file held by anything (see {@link FILE_HOLDERS})? A missing or foreign file holds nothing. */
export async function isFileReferenced(db: DatabaseReader, orgId: string, fileId: string): Promise<boolean> {
  const file = await db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  if (!file || file.organizationId !== orgId) return false;
  if (await heldByIndexedTable(db, fileId)) return true;
  const stored = await db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).unique();
  // Finance PDFs are written by the server (`pdfFileId` holds their storage id): never attachable.
  if (stored?.folder?.startsWith(FINANCE_FOLDER_PREFIX)) return true;
  if (stored?.folder === INVOICE_UPLOAD_FOLDER && (await heldAsInvoice(db, orgId, fileId))) return true;
  return await heldInPhotoArrays(db, orgId, file);
}

/** Prove `fileId` may be attached by `actorUserId` for a surface that uploads into `folder`; throws otherwise. */
export async function assertAttachableUpload(
  db: DatabaseReader,
  a: { orgId: string; actorUserId: string; fileId: string; folder: string },
): Promise<void> {
  const file = await db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", a.fileId)).first();
  if (!file || file.organizationId !== a.orgId) throw new ConvexError("File not found");
  if (file.uploadedById !== a.actorUserId) throw new ConvexError("That file was not uploaded by you.");
  if (Date.now() - file._creationTime > ATTACH_UPLOAD_MAX_AGE_MS) throw new ConvexError("That upload is too old: upload the file again.");
  const stored = await db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).unique();
  if (!stored || stored.organizationId !== a.orgId || stored.folder !== a.folder) throw new ConvexError("That file was not uploaded for this.");
  if (await isFileReferenced(db, a.orgId, a.fileId)) throw new ConvexError("That file is already attached to something.");
}
