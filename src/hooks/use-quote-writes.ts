"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { generateQuoteArtifact } from "@/server/finance-documents";
import { api } from "../../convex/_generated/api";
import {
  quoteAcceptSchema,
  quoteDeclineSchema,
  quoteDeleteRecalledSchema,
  quoteRecallSchema,
  quoteSendSchema,
  quoteSetLabelSchema,
  type QuoteAcceptValues,
  type QuoteDeclineValues,
  type QuoteDeleteRecalledValues,
  type QuoteRecallValues,
  type QuoteSendValues,
  type QuoteSetLabelValues,
} from "@/lib/validations/quote";

/**
 * Browser-direct QUOTE REVISION writes (WS1 #940, reworked by #986) — the five
 * verbs over one shared revision counter. Mirrors use-native-client-writes.ts.
 *
 * `offerStatusChange` on the send/accept/decline results is an OFFER for the
 * caller to act on (advance to QUOTED / CONFIRMED / CANCELLED), never something
 * the mutation applied itself — status is never forced by a quote verb, matching
 * the existing "issuing an invoice offers to advance to INVOICED" precedent.
 */
export type QuoteStatusOffer = "QUOTED" | "CONFIRMED" | "CANCELLED" | null;

export function useQuoteWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const sendM = useMutation(api.quotesWrites.sendNative);
  const recallM = useMutation(api.quotesWrites.recallNative);
  const newVersionM = useMutation(api.quotesWrites.newVersionNative);
  const acceptM = useMutation(api.quotesWrites.markAcceptedNative);
  const declineM = useMutation(api.quotesWrites.markDeclinedNative);
  const deleteRecalledM = useMutation(api.quotesWrites.deleteRecalledNative);
  const setLabelM = useMutation(api.quotesWrites.setQuoteLabelNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /**
     * Freeze the current revision and stamp it sent. Does NOT email the client
     * (decision 7) — it records the send, freezes the money, and then renders
     * and stores the PDF (#987).
     *
     * The artifact render runs in a server action AFTER the Convex transaction
     * commits, so it can fail independently. It never fails the send: the row is
     * already `SENT`, and a `SENT` revision with no `pdfFileId` renders a
     * "document failed — retry" state in the rail rather than a silent gap. That
     * is why `artifactReady` is reported rather than thrown.
     */
    send: async (
      projectId: string,
      data: QuoteSendValues = {},
    ): Promise<{
      id: string;
      version: number;
      validUntil: number;
      offerStatusChange: QuoteStatusOffer;
      artifactReady: boolean;
    }> => {
      const org = requireOrg();
      const parsed = quoteSendSchema.parse(data);
      const result = await sendM({
        id: createId(),
        organizationId: org,
        projectId,
        quoteDate: (parsed.quoteDate ?? new Date()).getTime(),
        validityDays: parsed.validityDays,
        recipientContactId: parsed.recipientContactId || undefined,
        notes: parsed.notes || undefined,
        labelOnDocument: parsed.labelOnDocument || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });

      let artifactReady = true;
      try {
        await generateQuoteArtifact(result.id);
      } catch {
        artifactReady = false;
      }
      return { ...result, artifactReady };
    },

    /** Un-send a revision. Needs admin/owner or one of the project's PMs on top
     *  of `invoice:publish` — enforced server-side either way. */
    recall: async (
      quoteId: string,
      data: QuoteRecallValues,
    ): Promise<{ id: string; version: number; restoredQuoteId: string | null }> => {
      const org = requireOrg();
      const parsed = quoteRecallSchema.parse(data);
      return await recallM({
        id: quoteId,
        organizationId: org,
        reason: parsed.reason,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    /** Cut the next revision — increments `projects.revision` and opens a draft.
     *  The previous sent revision stays the client's current document until the
     *  new one is actually sent. */
    newVersion: async (projectId: string): Promise<{ id: string; version: number }> => {
      const org = requireOrg();
      return await newVersionM({
        id: createId(),
        organizationId: org,
        projectId,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    markAccepted: async (
      quoteId: string,
      data: QuoteAcceptValues = {},
    ): Promise<{ id: string; version: number; offerStatusChange: QuoteStatusOffer }> => {
      const org = requireOrg();
      const parsed = quoteAcceptSchema.parse(data);
      return await acceptM({
        id: quoteId,
        organizationId: org,
        acceptedAt: parsed.acceptedAt?.getTime(),
        acceptanceRef: parsed.acceptanceRef || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    markDeclined: async (
      quoteId: string,
      data: QuoteDeclineValues,
    ): Promise<{ id: string; version: number; offerStatusChange: QuoteStatusOffer }> => {
      const org = requireOrg();
      const parsed = quoteDeclineSchema.parse(data);
      return await declineM({
        id: quoteId,
        organizationId: org,
        reason: parsed.reason,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    /**
     * #1229 Phase 3 note: "reprice from revision" was one of the three
     * overlapping "create a version" mutations (`repriceFromRevisionNative`)
     * collapsed into `versions.createNative` on the real `projectVersions`
     * table (`convex/versions.ts`) — this quote-row-based verb no longer
     * exists server-side. Left as a clear, throwing stub (rather than a
     * removed method + broken call site) so `reprice-from-revision-dialog.tsx`
     * still compiles: it already catches and toasts this error. Rewiring the
     * dialog onto `versions.createNative` is Phase 5's UI work.
     */
    repriceFromRevision: async (
      _projectId: string,
      _sourceQuoteId: string,
    ): Promise<{ id: string; version: number; sourceVersion: number }> => {
      throw new Error(
        "Reprice from revision is temporarily unavailable — project versioning has moved to the new versions.* mutations (#1229) and this action's UI hasn't been rebuilt on them yet.",
      );
    },

    /**
     * #1229 Phase 3 note: `deleteDraftNative`/`deleteVersionNative` (the
     * quote-row-based "delete a version" verbs) were deleted, replaced by
     * `versions.deleteNative` on the real `projectVersions` table. Left as
     * clear, throwing stubs — see `repriceFromRevision`'s comment above for
     * why — so `delete-version-dialog.tsx` still compiles.
     */
    deleteDraft: async (_quoteId: string): Promise<{ id: string; deletedVersion: number; revision: number }> => {
      throw new Error(
        "Deleting a draft version is temporarily unavailable — project versioning has moved to the new versions.* mutations (#1229) and this action's UI hasn't been rebuilt on them yet.",
      );
    },

    /** See `deleteDraft`'s comment immediately above. */
    deleteVersion: async (_quoteId: string): Promise<{ id: string; deletedVersion: number }> => {
      throw new Error(
        "Deleting a saved version is temporarily unavailable — project versioning has moved to the new versions.* mutations (#1229) and this action's UI hasn't been rebuilt on them yet.",
      );
    },

    /** Rename a version's internal label from the row (#1080/#1097) — never a
     *  behavioural switch, reachable on any revision. */
    setLabel: async (
      quoteId: string,
      data: QuoteSetLabelValues,
    ): Promise<{ id: string; version: number; label: string | null }> => {
      const org = requireOrg();
      const parsed = quoteSetLabelSchema.parse(data);
      return await setLabelM({
        id: quoteId,
        organizationId: org,
        label: parsed.label || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    /** Recall-then-delete (#1029) — the one path that PERMANENTLY erases a
     *  document a client may already hold, including its stored PDF bytes.
     *  Owner-only server-side; `confirmLabel` must match the revision's label
     *  EXACTLY (server-validated, not just client UX). */
    deleteRecalled: async (
      quoteId: string,
      data: QuoteDeleteRecalledValues,
    ): Promise<{ id: string; deletedVersion: number; revision: number }> => {
      const org = requireOrg();
      const parsed = quoteDeleteRecalledSchema.parse(data);
      return await deleteRecalledM({
        id: quoteId,
        organizationId: org,
        confirmLabel: parsed.confirmLabel,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    // #1230 note: Protect/Unprotect (already a removed verb, #1229 Phase 3)
    // and Correction (`correctQuoteNative`) are DELETED — the whole
    // protect/unprotect mechanism is gone, so there is nothing left to gate
    // a "correct a sent quote's date" verb on. `quotes.protected` itself is
    // schema-deprecated (never read/written by any code path anymore).
  };
}
