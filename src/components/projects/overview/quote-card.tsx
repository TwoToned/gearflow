"use client";
// use-client: interactive — dialog state + Convex subscriptions (R-8.1.1)

import { useState } from "react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { api } from "../../../../convex/_generated/api";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { CanDo } from "@/components/auth/permission-gate";
import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";
import { AcceptQuoteDialog } from "@/components/projects/finance/accept-quote-dialog";
import { QuoteManagerDialog } from "@/components/projects/finance/quote-manager-dialog";
import { diffSnapshotEntries, type SnapshotEntryLike } from "@/lib/project-snapshot-diff";
import { summarizeDrift, describeDrift } from "@/lib/quote-drift";
import { OverviewLabel, OverviewLine, OverviewLinks, OverviewTextButton, OverviewTextLink } from "./overview-parts";

interface QuoteLineProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  /** Switches the job to the Finance tab (`Finance ›`, `see what changed ›`). */
  onOpenFinance: () => void;
}

/** The live (SENT/ACCEPTED/…) revision, as `revisionStateForProject` returns it. */
type LiveQuote = {
  id: string;
  version: number;
  status: string;
  sentAt: number | null;
  validUntil: number | null;
  snapshotId: string | null;
} | null;

interface QuoteView {
  live: LiveQuote;
  status: string;
  amount: number | null;
  /** Set only when a STORED artifact exists — see the PDF link. */
  pdfQuoteId: string | null;
  revision: number;
}

/**
 * What the line displays, derived from the two reads. `null` while either is
 * still loading.
 *
 * The amount rule is the load-bearing one: a live quote shows its FROZEN
 * snapshot total, never current project pricing — that freeze is the whole
 * point of sending (FEATUREDOCS/66). Only a never-sent draft shows the
 * project's live total, because that IS what sending would freeze.
 */
type QuoteRow = { id: string; snapshot?: unknown; pdfFileId?: string };

function resolveAmount(live: LiveQuote, liveRow: QuoteRow | undefined, projectTotal: number | null): number | null {
  if (!live) return projectTotal;
  const frozenTotal = (liveRow?.snapshot as { total?: number } | null | undefined)?.total;
  return frozenTotal ?? null;
}

function deriveQuoteView(
  revisionState: { revision: number; liveQuote: LiveQuote } | undefined,
  quotes: QuoteRow[] | undefined,
  projectTotal: number | null,
): QuoteView | null {
  if (revisionState === undefined || quotes === undefined) return null;
  const live = revisionState.liveQuote;
  const liveRow = live ? quotes.find((q) => q.id === live.id) : undefined;
  return {
    live,
    status: live?.status ?? "DRAFT",
    amount: resolveAmount(live, liveRow, projectTotal),
    // No regeneration fallback exists (#987), so a revision whose render failed
    // has no stored bytes and therefore offers no link.
    pdfQuoteId: liveRow?.pdfFileId ? liveRow.id : null,
    revision: revisionState.revision,
  };
}

/** `EXPIRED` is derived, never stored — always word it from `effectiveStatus`. */
const STATUS_WORD: Record<string, string> = {
  SENT: "sent",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  EXPIRED: "expired",
  RECALLED: "recalled",
  SUPERSEDED: "superseded",
};

/** `v3 sent 4 Nov · valid until 4 Dec`, `v3 accepted`, `v2 · not sent yet`. */
function quoteStateWords(view: Pick<QuoteView, "live" | "status" | "revision">): string {
  const { live, status, revision } = view;
  if (!live) return `v${revision} · not sent yet`;
  const word = STATUS_WORD[status] ?? status.toLowerCase();
  if (status !== "SENT") return `v${live.version} ${word}`;
  const sent = live.sentAt ? ` ${formatDate(new Date(live.sentAt))}` : "";
  const valid = live.validUntil ? ` · valid until ${formatDate(new Date(live.validUntil))}` : "";
  return `v${live.version} sent${sent}${valid}`;
}

/**
 * "This job no longer matches v<N>" as one quiet line. Same pipeline as
 * `project-quote-rail.tsx`'s inline copy (R-3.1: one diff/summarize/describe
 * pipeline, two thin renderers).
 */
function QuoteDriftLine({
  projectId,
  orgId,
  snapshotId,
  version,
  onSeeWhatChanged,
}: {
  projectId: string;
  orgId: string;
  snapshotId: string;
  version: number;
  onSeeWhatChanged: () => void;
}) {
  const snapshotEntries = useAuthedQuery(api.projectLocksRead.snapshotEntries, { snapshotId, orgId });
  const currentEntries = useAuthedQuery(api.projectLocksRead.currentEntries, { projectId, orgId });

  if (snapshotEntries === undefined || currentEntries === undefined) return null;
  const rows = diffSnapshotEntries(snapshotEntries as SnapshotEntryLike[], currentEntries as SnapshotEntryLike[]);
  const summary = summarizeDrift(rows);
  if (!summary.hasDrift) return null;

  return (
    <OverviewLine muted>
      <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-warn align-middle" />
      No longer matches v{version} · {describeDrift(summary)} ·{" "}
      <OverviewTextButton onClick={onSeeWhatChanged}>see what changed ›</OverviewTextButton>
    </OverviewLine>
  );
}

/**
 * An open draft's one move is to send it; a sent one's is to record the
 * client's answer. Never both — offering "send" on a live quote is how you end
 * up with two documents under the same name.
 */
function QuoteNextMove({ live, status, onSend, onAccept }: { live: LiveQuote; status: string; onSend: () => void; onAccept: () => void }) {
  if (!live) {
    return (
      <CanDo resource="invoice" action="create">
        <OverviewTextButton onClick={onSend}>Send quote</OverviewTextButton>
      </CanDo>
    );
  }
  if (status !== "SENT") return null;
  return (
    <CanDo resource="invoice" action="update">
      <OverviewTextButton onClick={onAccept}>Record accept</OverviewTextButton>
    </CanDo>
  );
}

/**
 * The Overview's quote line (spec §6b, UX Phase 7; was the #1061 Quote card):
 * the amount and where the quote stands in words, the drift note under it,
 * and text links — the next move (send / record accept), the stored PDF,
 * every revision, Finance. Every other verb stays in the Finance tab's
 * `ProjectQuoteRail`, the single owner of the revision workflow; the dialogs
 * here are the SAME components that rail uses.
 */
export function QuoteMoneyLine({
  projectId,
  orgId,
  projectNumber,
  clientId,
  projectStatus,
  subtotal,
  taxAmount,
  total,
  onOpenFinance,
}: QuoteLineProps) {
  // Frozen at mount: it only drives the DERIVED expiry read (never a ticking query arg).
  const now = useStableNow();
  const [sendOpen, setSendOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const args = orgId ? { orgId, projectId, now } : "skip";
  const revisionState = useAuthedQuery(api.quotes.revisionStateForProject, args);
  const quotes = useAuthedQuery(api.quotes.listForProject, args);

  const view = deriveQuoteView(revisionState, quotes, total);

  return (
    <div className="min-w-0">
      <OverviewLabel>Quote</OverviewLabel>
      {!orgId || !view ? (
        <OverviewLine muted>Loading quote…</OverviewLine>
      ) : (
        <>
          <OverviewLine>
            <b className="font-mono font-semibold tabular-nums">{formatCurrency(view.amount, undefined, { cents: false })}</b>{" "}
            <span className="text-muted">· {quoteStateWords(view)}</span>
          </OverviewLine>
          {view.live?.snapshotId ? (
            <QuoteDriftLine
              projectId={projectId}
              orgId={orgId}
              snapshotId={view.live.snapshotId}
              version={view.live.version}
              onSeeWhatChanged={onOpenFinance}
            />
          ) : null}
          <OverviewLinks>
            <QuoteNextMove live={view.live} status={view.status} onSend={() => setSendOpen(true)} onAccept={() => setAcceptOpen(true)} />
            {view.pdfQuoteId ? (
              <OverviewTextLink href={`/api/finance/quote/${view.pdfQuoteId}/pdf`} target="_blank" rel="noopener noreferrer">
                PDF
              </OverviewTextLink>
            ) : null}
            <OverviewTextButton onClick={() => setManageOpen(true)}>All revisions</OverviewTextButton>
            <OverviewTextButton onClick={onOpenFinance}>Finance ›</OverviewTextButton>
          </OverviewLinks>

          <QuoteLineDialogs
            sendOpen={sendOpen}
            onSendOpenChange={setSendOpen}
            acceptOpen={acceptOpen}
            onAcceptOpenChange={setAcceptOpen}
            live={view.live}
            projectId={projectId}
            projectNumber={projectNumber}
            orgId={orgId}
            clientId={clientId}
            revision={view.revision}
            subtotal={subtotal}
            taxAmount={taxAmount}
            total={total}
            projectStatus={projectStatus}
          />
          <QuoteManagerDialog
            open={manageOpen}
            onOpenChange={setManageOpen}
            projectId={projectId}
            orgId={orgId}
            projectNumber={projectNumber}
            clientId={clientId}
            projectStatus={projectStatus}
            subtotal={subtotal}
            taxAmount={taxAmount}
            total={total}
          />
        </>
      )}
    </div>
  );
}

function QuoteLineDialogs({
  sendOpen,
  onSendOpenChange,
  acceptOpen,
  onAcceptOpenChange,
  live,
  projectId,
  projectNumber,
  orgId,
  clientId,
  revision,
  subtotal,
  taxAmount,
  total,
  projectStatus,
}: {
  sendOpen: boolean;
  onSendOpenChange: (open: boolean) => void;
  acceptOpen: boolean;
  onAcceptOpenChange: (open: boolean) => void;
  live: LiveQuote;
  projectId: string;
  projectNumber: string;
  orgId: string;
  clientId?: string | null;
  revision: number;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  projectStatus?: string | null;
}) {
  return (
    <>
      {sendOpen && (
        <SendQuoteDialog
          open={sendOpen}
          onOpenChange={onSendOpenChange}
          projectId={projectId}
          projectNumber={projectNumber}
          orgId={orgId}
          clientId={clientId}
          revision={revision}
          subtotal={subtotal}
          taxAmount={taxAmount}
          total={total}
          projectStatus={projectStatus}
        />
      )}
      {acceptOpen && live && (
        <AcceptQuoteDialog open={acceptOpen} onOpenChange={onAcceptOpenChange} quoteId={live.id} version={live.version} />
      )}
    </>
  );
}
