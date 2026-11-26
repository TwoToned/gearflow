"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { CrewDocumentKind } from "../../../../convex/lib/crewDocumentCore";

import { useSession } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/**
 * Every write on a crew member's Documents tab (UX Phase 13, D72). Each toasts with the server's
 * exact, ids-only Undo; removing a document deletes its stored file for good, so that toast has NO
 * Undo (the menu item is a confirmed red verb). The upload goes through `/api/uploads` with
 * `purpose: "crew-document"`, the only way into the reserved crew-documents folder.
 */
export interface CrewDocumentValues { kind: CrewDocumentKind; name?: string; expiresAt?: number }

async function uploadCrewDocument(file: File, crewMemberId: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("purpose", "crew-document");
  form.append("entityId", crewMemberId);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error || "Upload failed");
  }
  return ((await res.json()) as { id: string }).id;
}

export function useCrewDocumentWrites(orgId: string | undefined) {
  const { data: session } = useSession();
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const addM = useMutation(api.crewDocumentsWrites.addNative);
  const updateM = useMutation(api.crewDocumentsWrites.updateNative);
  const removeM = useMutation(api.crewDocumentsWrites.removeNative);
  const undoAddM = useMutation(api.crewDocumentsWrites.undoAddNative);
  const undoUpdateM = useMutation(api.crewDocumentsWrites.undoUpdateNative);

  async function attempt(fallbackTitle: string, run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (e) {
      showError(e, { fallbackTitle });
      return false;
    }
  }

  return {
    add: (crewMemberId: string, file: File, v: CrewDocumentValues) =>
      attempt("Could not add the document", async () => {
        const fileId = await uploadCrewDocument(file, crewMemberId);
        const auditId = createId();
        await addM({ id: createId(), orgId: orgId!, crewMemberId, fileId, ...v, now: Date.now(), actor: actor(), auditId });
        announceListWrite({
          title: `Added ${v.name || "document"}`,
          undoneTitle: "Undone · document detached (the uploaded file stays in storage)",
          performUndo: async () => {
            const r = await undoAddM({ orgId: orgId!, crewMemberId, forwardAuditId: auditId, now: Date.now(), actor: actor() });
            return r.restored ? undefined : r.note;
          },
        });
      }),

    update: (crewMemberId: string, documentId: string, v: CrewDocumentValues) =>
      attempt("Could not save the document", async () => {
        const auditId = createId();
        const r = await updateM({ orgId: orgId!, crewMemberId, documentId, ...v, now: Date.now(), actor: actor(), auditId });
        if (!r.changed) return void toast.message("Nothing changed");
        announceListWrite({
          title: `Saved ${v.name || "document"}`,
          undoneTitle: "Undone · document restored",
          performUndo: async () => void (await undoUpdateM({ orgId: orgId!, documentId, forwardAuditId: auditId, now: Date.now(), actor: actor() })),
        });
      }),

    /** Deletes the stored file for good: confirmed by the menu, no Undo. */
    remove: (crewMemberId: string, documentId: string, label: string) =>
      attempt("Could not remove the document", async () => {
        await removeM({ orgId: orgId!, crewMemberId, documentId, now: Date.now(), actor: actor(), auditId: createId() });
        toast.success(`Removed ${label}. Its file is deleted.`);
      }),
  };
}
