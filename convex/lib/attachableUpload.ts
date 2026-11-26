import { ConvexError } from "convex/values";
import type { DatabaseReader } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
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

/** Every `table.field` that can hold a file; the schema test requires each file-shaped field to be listed. */
/**
 * File-ish URLs inside the `orgSettings.settings` JSON blob (invisible to the schema walk), each with its reason.
 * The test checks the blob field still exists; this list is the record that they were considered.
 */
export const NOT_FILE_HOLDER_SETTINGS: Record<string, string> = {
  "settings.branding.logoUrl": "Organisation logo URL: written by the settings flow from its own upload, never from a fileUploads row.",
  "settings.branding.iconUrl": "Organisation icon URL: written by the settings flow from its own upload, never from a fileUploads row.",
};

export const FILE_HOLDERS = [
  "modelMedia.fileId", "assetMedia.fileId", "kitMedia.fileId", "projectMedia.fileId", "clientMedia.fileId", "locationMedia.fileId", "subHireMedia.fileId",
  "supplierDocuments.fileId", "supplierOrderFiles.fileId", "crewDocuments.fileId",
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
    db.query("crewDocuments").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first(),
  ]);
  return hits.some((h) => h != null);
}

/**
 * What the holders say about a file: `held` by something, `free` of everything, or `unverifiable` (a scan hit its
 * cap, so it cannot be proven unreferenced). Both non-free states fail CLOSED everywhere: nothing attaches and
 * nothing is deleted. They differ only in the message an attach is refused with.
 */
export type FileRefs = "held" | "free" | "unverifiable";

/** `supplierOrders.invoiceFileId` has no index, so the org's orders are scanned (bounded; unprovable = referenced). */
async function heldAsInvoice(db: DatabaseReader, orgId: string, fileId: string): Promise<FileRefs> {
  const orders = await collectCapped(db.query("supplierOrders").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), INVOICE_SCAN_CAP);
  if (orders.rows.some((o) => o.invoiceFileId === fileId)) return "held";
  return orders.truncated ? "unverifiable" : "free";
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

type FileDoc = Pick<Doc<"fileUploads">, "id" | "url" | "thumbnailUrl" | "storageKey" | "_creationTime">;

/**
 * The photo / attachment scans for a SET of files, read ONCE (a cascade that removes many files must not re-read the
 * same 7,000 records per file). The check-record window starts at the OLDEST file's creation: a superset of any one
 * file's window, so never less exact than the single-file read.
 */
async function heldInPhotoArrays(db: DatabaseReader, orgId: string, files: FileDoc[]): Promise<Map<string, FileRefs>> {
  const needlesOf = new Map(files.map((f) => [f.id, new Set([f.id, f.url, f.storageKey, ...(f.thumbnailUrl ? [f.thumbnailUrl] : [])])]));
  const holders = (values: string[] | undefined) => (values ?? []).flatMap((v) => [v, storageIdOf(v) ?? ""]);
  const heldBy = (rows: { photos?: string[]; attachments?: string[] }[]) => {
    const found = new Set<string>();
    for (const r of rows) {
      const values = [...holders(r.photos), ...holders(r.attachments)];
      for (const [id, needles] of needlesOf) if (values.some((v) => needles.has(v))) found.add(id);
    }
    return found;
  };
  const maintenance = await collectCapped(db.query("maintenanceRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), MAINTENANCE_SCAN_CAP);
  const heldInMaintenance = heldBy(maintenance.rows);
  const since = Math.min(...files.map((f) => f._creationTime));
  const checks = await collectCapped(db.query("checkRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId).gte("_creationTime", since)), CHECK_SCAN_CAP);
  const heldInChecks = heldBy(checks.rows.map((r) => ({ photos: r.photos })));
  return new Map(files.map((f): [string, FileRefs] => {
    if (heldInMaintenance.has(f.id) || heldInChecks.has(f.id)) return [f.id, "held"];
    return [f.id, maintenance.truncated || checks.truncated ? "unverifiable" : "free"]; // cannot prove it unreferenced
  }));
}

/** The state of each of `fileIds` (a missing or foreign file is `free`); the photo scans are shared across the set. */
export async function fileReferenceStates(db: DatabaseReader, orgId: string, fileIds: string[]): Promise<Map<string, FileRefs>> {
  const out = new Map<string, FileRefs>();
  const pending: { file: Doc<"fileUploads">; folder: string | undefined }[] = [];
  for (const fileId of new Set(fileIds)) {
    const file = await db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
    if (!file || file.organizationId !== orgId) { out.set(fileId, "free"); continue; }
    if (await heldByIndexedTable(db, fileId)) { out.set(fileId, "held"); continue; }
    const stored = await db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).unique();
    // Finance PDFs are written by the server (`pdfFileId` holds their storage id): never attachable.
    if (stored?.folder?.startsWith(FINANCE_FOLDER_PREFIX)) { out.set(fileId, "held"); continue; }
    pending.push({ file, folder: stored?.folder });
  }
  if (pending.length === 0) return out;
  const photos = await heldInPhotoArrays(db, orgId, pending.map((p) => p.file));
  for (const { file, folder } of pending) {
    // The invoice FK has no index, so it is scanned (only for the invoice folder).
    const invoice: FileRefs = folder === INVOICE_UPLOAD_FOLDER ? await heldAsInvoice(db, orgId, file.id) : "free";
    const photo = photos.get(file.id) ?? "free";
    out.set(file.id, invoice === "held" || photo === "held" ? "held" : invoice === "unverifiable" || photo === "unverifiable" ? "unverifiable" : "free");
  }
  return out;
}

/** The state behind {@link isFileReferenced}: a missing or foreign file is `free`. */
export async function fileReferenceState(db: DatabaseReader, orgId: string, fileId: string): Promise<FileRefs> {
  return (await fileReferenceStates(db, orgId, [fileId])).get(fileId) ?? "free";
}

/** Is this org's `fileUploads` file held by anything, or impossible to prove free (fail closed)? */
export async function isFileReferenced(db: DatabaseReader, orgId: string, fileId: string): Promise<boolean> {
  return (await fileReferenceState(db, orgId, fileId)) !== "free";
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
  const refs = await fileReferenceState(db, a.orgId, a.fileId);
  if (refs === "held") throw new ConvexError("That file is already attached to something.");
  // Distinct from "held": this org has too many records to prove the file free. Still refused (fail closed).
  if (refs === "unverifiable") throw new ConvexError({ code: "FILE_REFS_UNVERIFIABLE", message: "Too many records to check this file safely" });
}
