"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { SUPPLIER_DOCUMENTS_FOLDER, SUPPLIER_ORDER_FILES_FOLDER, type OrderFileKind } from "../../../../convex/lib/supplierRecordCore";

import { useSession } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * Every write on the supplier record's Contacts / Documents tabs and the order's Files tab
 * (UX Phase 13, B3). Each toasts, with an Undo that is ONE guarded closure calling the
 * server's exact, ids-only Undo (author, window, once, still-as-left). Removing a document or
 * an order file deletes its stored file for good, so that toast has NO Undo (and the menu item
 * is a confirmed red verb); an Undo of an add detaches the row and the uploaded file stays.
 */
export interface ContactValues { name?: string; role?: string; email?: string; phone?: string; notes?: string }
export interface DocumentValues { name: string; kind?: string; expiryDate?: number; notes?: string }

/** `/api/uploads` is the app's one upload route; it returns the new `fileUploads` id. */
async function uploadFile(file: File, folder: string, entityId: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  form.append("entityId", entityId);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error || "Upload failed");
  }
  return ((await res.json()) as { id: string }).id;
}

export function useSupplierRecordWrites(orgId: string | undefined) {
  const { data: session } = useSession();
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const addContactM = useMutation(api.supplierRecordWrites.addContactNative);
  const updateContactM = useMutation(api.supplierRecordWrites.updateContactNative);
  const removeContactM = useMutation(api.supplierRecordWrites.removeContactNative);
  const undoContactRowM = useMutation(api.supplierRecordWrites.undoContactRowNative);
  const addDocumentM = useMutation(api.supplierRecordWrites.addDocumentNative);
  const updateDocumentM = useMutation(api.supplierRecordWrites.updateDocumentNative);
  const removeDocumentM = useMutation(api.supplierRecordWrites.removeDocumentNative);
  const undoDocumentAddM = useMutation(api.supplierRecordWrites.undoDocumentAddNative);
  const undoRowEditM = useMutation(api.supplierRecordWrites.undoRowEditNative);
  const addOrderFileM = useMutation(api.supplierRecordWrites.addOrderFileNative);
  const removeOrderFileM = useMutation(api.supplierRecordWrites.removeOrderFileNative);
  const undoOrderFileAddM = useMutation(api.supplierRecordWrites.undoOrderFileAddNative);

  /** Run one write; a failure is a toast, never an unhandled rejection. Returns whether it landed. */
  async function attempt(fallbackTitle: string, run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (e) {
      showError(e, { fallbackTitle });
      return false;
    }
  }
  const noteOf = (r: { restored: boolean; note?: string }) => (r.restored ? undefined : r.note);

  return {
    addContact: (supplierId: string, v: ContactValues) =>
      attempt("Could not add the contact", async () => {
        const auditId = createId();
        await addContactM({ id: createId(), orgId: orgId!, supplierId, ...v, now: Date.now(), actor: actor(), auditId });
        announceListWrite({
          title: `Added ${v.name || v.email || v.phone || "contact"}`,
          undoneTitle: "Undone · contact removed",
          performUndo: async () => noteOf(await undoContactRowM({ orgId: orgId!, supplierId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    updateContact: (supplierId: string, contactId: string, v: ContactValues) =>
      attempt("Could not save the contact", async () => {
        const auditId = createId();
        const r = await updateContactM({ orgId: orgId!, supplierId, contactId, ...v, now: Date.now(), actor: actor(), auditId });
        if (!r.changed) return void toast.message("Nothing changed");
        announceListWrite({
          title: `Saved ${v.name || v.email || v.phone || "contact"}`,
          undoneTitle: "Undone · contact restored",
          performUndo: async () => void (await undoRowEditM({ orgId: orgId!, kind: "contact", rowId: contactId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    removeContact: (supplierId: string, contactId: string, label: string) =>
      attempt("Could not remove the contact", async () => {
        const auditId = createId();
        await removeContactM({ orgId: orgId!, supplierId, contactId, now: Date.now(), actor: actor(), auditId });
        announceListWrite({
          title: `Removed ${label}`,
          undoneTitle: `Undone · ${label} restored`,
          performUndo: async () => noteOf(await undoContactRowM({ orgId: orgId!, supplierId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    addDocument: (supplierId: string, file: File, v: DocumentValues) =>
      attempt("Could not add the document", async () => {
        const fileId = await uploadFile(file, SUPPLIER_DOCUMENTS_FOLDER, supplierId);
        const auditId = createId();
        await addDocumentM({ id: createId(), orgId: orgId!, supplierId, fileId, ...v, now: Date.now(), actor: actor(), auditId });
        announceListWrite({
          title: `Added ${v.name}`,
          undoneTitle: "Undone · document detached (the uploaded file stays in storage)",
          performUndo: async () => noteOf(await undoDocumentAddM({ orgId: orgId!, supplierId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    updateDocument: (supplierId: string, documentId: string, v: DocumentValues) =>
      attempt("Could not save the document", async () => {
        const auditId = createId();
        const r = await updateDocumentM({ orgId: orgId!, supplierId, documentId, ...v, now: Date.now(), actor: actor(), auditId });
        if (!r.changed) return void toast.message("Nothing changed");
        announceListWrite({
          title: `Saved ${v.name}`,
          undoneTitle: "Undone · document restored",
          performUndo: async () => void (await undoRowEditM({ orgId: orgId!, kind: "document", rowId: documentId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    /** Deletes the stored file for good: confirmed by the menu, no Undo (bytes cannot be brought back). */
    removeDocument: (supplierId: string, documentId: string, name: string) =>
      attempt("Could not remove the document", async () => {
        await removeDocumentM({ orgId: orgId!, supplierId, documentId, now: Date.now(), actor: actor(), auditId: createId() });
        toast.success(`Removed ${name}. Its file is deleted.`);
      }),

    addOrderFile: (orderId: string, file: File, kind: OrderFileKind, name?: string) =>
      attempt("Could not attach the file", async () => {
        const fileId = await uploadFile(file, SUPPLIER_ORDER_FILES_FOLDER, orderId);
        const auditId = createId();
        await addOrderFileM({ id: createId(), orgId: orgId!, orderId, fileId, kind, ...(name ? { name } : {}), now: Date.now(), actor: actor(), auditId });
        announceListWrite({
          title: `Attached ${name || file.name}`,
          undoneTitle: "Undone · file detached (the uploaded file stays in storage)",
          performUndo: async () => noteOf(await undoOrderFileAddM({ orgId: orgId!, orderId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    /** Deletes the stored file for good: confirmed by the menu, no Undo. */
    removeOrderFile: (orderId: string, fileRowId: string, label: string) =>
      attempt("Could not remove the file", async () => {
        await removeOrderFileM({ orgId: orgId!, orderId, fileRowId, now: Date.now(), actor: actor(), auditId: createId() });
        toast.success(`Removed ${label}. The file is deleted.`);
      }),
  };
}
