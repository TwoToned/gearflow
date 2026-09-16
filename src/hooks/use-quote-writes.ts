"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";
import { autoStatusToast } from "@/lib/project-status-automation";
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
 *
 * #1160 narrows that for SEND only: when the org leaves the "Quote sent" status
 * automation on (the default), `sendNative` moves the job to QUOTED itself and
 * reports it as `autoStatusChange`, leaving `offerStatusChange` null. The offer is
 * now the OPT-OUT path, not the normal one. Accept/decline are unchanged — entering
 * CONFIRMED commits stock and money, so it stays a human's explicit click.
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
    /**
     * `versionId` (#1233, Phase 6) — the REAL `projectVersions` row to
     * quote from; omitted ⇒ the project's live version, byte-identical to
     * every pre-Phase-6 caller. `project-quote-rail.tsx` (the OLDER,
     * live-revision-only Finance tab) doesn't pass one yet — wiring a UI
     * surface to target a non-live version when sending is a deliberate,
     * documented follow-up (FEATUREDOCS/78's Phase 6 section), not attempted
     * this phase. This threading exists so that follow-up is a call, not a
     * rewrite.
     */
    send: async (
      projectId: string,
      data: QuoteSendValues = {},
      versionId?: string,
    ): Promise<{
      id: string;
      version: number;
      validUntil: number;
      /** Non-null when #1160's automation ALREADY moved the job to Quoted. */
      autoStatusChange: "QUOTED" | null;
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
        versionId,
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
    ): Promise<{
      id: string;
      version: number;
      autoStatusChange: "AWAITING_PAYMENT" | null;
      offerStatusChange: QuoteStatusOffer;
    }> => {
      const org = requireOrg();
      const parsed = quoteAcceptSchema.parse(data);
      // #1236 — accepting moves the job to AWAITING_PAYMENT, not CONFIRMED: the
      // client has agreed, the money hasn't landed. Announced rather than
      // offered, matching send; the offer survives only for an opted-out org.
      const res = await acceptM({
        id: quoteId,
        organizationId: org,
        acceptedAt: parsed.acceptedAt?.getTime(),
        acceptanceRef: parsed.acceptanceRef || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
      const copy = autoStatusToast(res.autoStatusChange);
      if (copy) toast(copy.title, { description: copy.description });
      return res;
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
