"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  quoteAcceptSchema,
  quoteDeclineSchema,
  quoteRecallSchema,
  quoteSendSchema,
  type QuoteAcceptValues,
  type QuoteDeclineValues,
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

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /** Freeze the current revision and stamp it sent. Does NOT email the client
     *  (decision 7) — it records the send and, from Phase B, stores the PDF. */
    send: async (
      projectId: string,
      data: QuoteSendValues = {},
    ): Promise<{ id: string; version: number; validUntil: number; offerStatusChange: QuoteStatusOffer }> => {
      const org = requireOrg();
      const parsed = quoteSendSchema.parse(data);
      return await sendM({
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
  };
}
