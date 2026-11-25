import { CheckCircle2, Copy, Eye, Pencil, Send, Trash2, Undo2, XCircle } from "lucide-react";

import type { ActionItem } from "@/lib/primitives/types";

/**
 * The quote row's ⋯ (UX Phase 10, spec §8b "row verbs live in the row menu").
 * One pure builder per audience, so the state × permission matrix is testable
 * without mounting the Convex-wired rail. An action that does not apply is
 * ABSENT, never disabled. Never branches on the stored `status` column:
 * `effectiveStatus` is the derived word (`effectiveQuoteStatus`).
 *
 * `Send` and `Mark accepted` live here and nowhere on the row itself; the
 * page-level `Send quote vN` / `Create quote vN+1` stays in the strip head.
 */

interface QuoteFlagsInput {
  id?: string;
  version?: number;
  effectiveStatus: string;
  sentAt?: number | null;
  publishedAt?: number | null;
}

export function quoteRowFlags(quote: QuoteFlagsInput) {
  const isSent = quote.effectiveStatus === "SENT";
  const isAccepted = quote.effectiveStatus === "ACCEPTED";
  // A sent-or-expired revision is the one the client is holding: it can be
  // recalled or declined. Only a still-valid one can be accepted.
  const isHeldByClient = isSent || quote.effectiveStatus === "EXPIRED";
  const everSent = quote.sentAt != null || quote.publishedAt != null;
  // A DRAFT with send history is sitting here because of a Recall (#1027) —
  // it needs the stricter recall-then-delete flow (#1029), not the ordinary
  // never-sent draft delete (#1028).
  const isRecalledDraft = quote.effectiveStatus === "DRAFT" && everSent;
  const isNeverSentDraft = quote.effectiveStatus === "DRAFT" && !everSent;
  return { isSent, isAccepted, isHeldByClient, isRecalledDraft, isNeverSentDraft };
}

/**
 * The `invoice:publish` cluster: View, Send (the open draft), Rename, Mark
 * accepted, Chase, Declined, Recall. "Delete draft" is gone (#1231): deleting a
 * version is a Versions-tab verb. Expiry is advisory (2026-09): an EXPIRED
 * revision can still be marked accepted exactly like a live SENT one.
 */
export function standardQuoteRowActions(
  flags: ReturnType<typeof quoteRowFlags>,
  handlers: {
    onView: () => void;
    /** Present only for the draft the strip's `Send quote vN` would send. */
    onSend?: () => void;
    onAccept: () => void;
    onDecline: () => void;
    onRecall: () => void;
    onEditLabel: () => void;
    onChase: () => void;
  },
): ActionItem[] {
  const { isHeldByClient } = flags;
  const actions: ActionItem[] = [];
  actions.push({ key: "view", label: "View", group: "edit", icon: Eye, onSelect: handlers.onView });
  if (handlers.onSend) actions.push({ key: "send", label: "Send…", group: "organise", icon: Send, onSelect: handlers.onSend });
  actions.push({ key: "rename", label: "Rename version", group: "edit", icon: Pencil, onSelect: handlers.onEditLabel });
  if (isHeldByClient) actions.push({ key: "accept", label: "Mark accepted", group: "organise", icon: CheckCircle2, onSelect: handlers.onAccept });
  // #1225 (Q2) — a follow-up nudge. Flow doesn't email the client itself
  // (decision 7 of #989); Chase hands the operator text for their own mail client.
  if (isHeldByClient) actions.push({ key: "chase", label: "Chase", group: "organise", icon: Copy, onSelect: handlers.onChase });
  if (isHeldByClient) actions.push({ key: "decline", label: "Declined", group: "organise", icon: XCircle, onSelect: handlers.onDecline });
  if (isHeldByClient) actions.push({ key: "recall", label: "Recall", group: "organise", icon: Undo2, onSelect: handlers.onRecall });
  return actions;
}

/** The owner-only cluster — recall-then-delete (#1029). */
export function ownerOnlyQuoteRowActions(
  flags: ReturnType<typeof quoteRowFlags>,
  handlers: { onDeleteRecalled: () => void },
): ActionItem[] {
  const actions: ActionItem[] = [];
  if (flags.isRecalledDraft) {
    actions.push({ key: "delete-recalled", label: "Delete permanently", group: "danger", icon: Trash2, onSelect: handlers.onDeleteRecalled, danger: true });
  }
  return actions;
}
