"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { generateQuoteArtifact } from "@/server/finance-documents";
import { api } from "../../convex/_generated/api";
import {
  quoteAcceptSchema,
  quoteCorrectSchema,
  quoteDeclineSchema,
  quoteDeleteRecalledSchema,
  quoteRecallSchema,
  quoteSendSchema,
  type QuoteAcceptValues,
  type QuoteCorrectValues,
  type QuoteDeclineValues,
  type QuoteDeleteRecalledValues,
  type QuoteRecallValues,
  type QuoteSendValues,
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
  const repriceFromRevisionM = useMutation(api.quotesWrites.repriceFromRevisionNative);
  const deleteDraftM = useMutation(api.quotesWrites.deleteDraftNative);
  const deleteRecalledM = useMutation(api.quotesWrites.deleteRecalledNative);
  const setProtectedM = useMutation(api.quotesWrites.setQuoteProtectedNative);
  const correctM = useMutation(api.quotesWrites.correctQuoteNative);

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

    /** "Use v2's pricing for v4" (#989 §8.1) — cut the next draft revision
     *  seeded with an earlier revision's money fields. Structure (gear,
     *  quantities, dates) is untouched. */
    repriceFromRevision: async (
      projectId: string,
      sourceQuoteId: string,
    ): Promise<{ id: string; version: number; sourceVersion: number }> => {
      const org = requireOrg();
      return await repriceFromRevisionM({
        id: createId(),
        organizationId: org,
        projectId,
        sourceQuoteId,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    /** Undo a fat-fingered "new version" (#1028) — only reachable for a DRAFT
     *  that has never been sent; the server rejects anything with send history
     *  (that's `deleteRecalled` below). Rolls `projects.revision` back. */
    deleteDraft: async (quoteId: string): Promise<{ id: string; deletedVersion: number; revision: number }> => {
      const org = requireOrg();
      return await deleteDraftM({
        id: quoteId,
        organizationId: org,
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

    /** Protect/unprotect (#1030) — owner-only soft lock independent of quote
     *  status. While protected, Recall and Correction both refuse. */
    setProtected: async (
      quoteId: string,
      protect: boolean,
    ): Promise<{ id: string; version: number; protected: boolean }> => {
      const org = requireOrg();
      return await setProtectedM({
        id: quoteId,
        organizationId: org,
        protect,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    /** Correction (#1031) — an audited fix to the date PRINTED on a SENT/
     *  ACCEPTED revision. No version bump, no price change, `sentAt` (the
     *  system's true send record) is never touched. Owner-only, blocked while
     *  protected. Clears the attached artifact so the next document render is
     *  forced fresh, then renders it immediately — same `artifactReady`
     *  never-throws shape as `send`, so a render failure doesn't undo the
     *  already-committed date fix. No visible marker distinguishes a
     *  corrected document from an original one on the page itself; the
     *  record of the correction lives in the activity log and
     *  `correctedAt`/`correctedById`, not on the PDF. */
    correct: async (
      quoteId: string,
      data: QuoteCorrectValues,
    ): Promise<{
      id: string;
      version: number;
      quoteDate: number;
      validUntil: number;
      artifactReady: boolean;
    }> => {
      const org = requireOrg();
      const parsed = quoteCorrectSchema.parse(data);
      const result = await correctM({
        id: quoteId,
        organizationId: org,
        quoteDate: parsed.quoteDate.getTime(),
        validityDays: parsed.validityDays,
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
  };
}
