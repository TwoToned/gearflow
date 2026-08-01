"use client";
// use-client: interactive — dialog state + Convex subscriptions (R-8.1.1)

import { useState } from "react";
import { Download, Send, CheckCircle2 } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../../convex/_generated/api";
import { formatDate } from "@/lib/formatters";
import { quoteStatusIntent, intentToBadgeStatus } from "@/lib/status-colors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { CanDo } from "@/components/auth/permission-gate";
import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";
import { AcceptQuoteDialog } from "@/components/projects/finance/accept-quote-dialog";
import { QuoteDriftIndicator } from "@/components/projects/finance/quote-drift-indicator";
import { OverviewCardHeader, OverviewAmount, OverviewMetaList, OverviewActions } from "./card-parts";

interface QuoteCardProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  /** Switches the project to the Finance tab, where the full revision rail lives. */
  onOpenLedger: () => void;
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

function QuoteCardBody({
  amount,
  revision,
  live,
  projectId,
  orgId,
  onOpenLedger,
}: {
  amount: number | null;
  revision: number;
  live: LiveQuote;
  projectId: string;
  orgId: string;
  onOpenLedger: () => void;
}) {
  return (
    <div className="flex-1 px-4 py-3.5">
      <OverviewAmount value={amount} suffix="inc GST" />
      <OverviewMetaList
        rows={[
          { label: "Revision", value: `v${live?.version ?? revision}` },
          live?.sentAt
            ? { label: "Sent", value: formatDate(new Date(live.sentAt)) }
            : { label: "Status", value: "Never sent" },
          live?.validUntil ? { label: "Valid until", value: formatDate(new Date(live.validUntil)) } : null,
        ]}
      />

      {live?.snapshotId && (
        <div className="mt-3">
          <QuoteDriftIndicator
            projectId={projectId}
            orgId={orgId}
            snapshotId={live.snapshotId}
            version={live.version}
            onSeeWhatChanged={onOpenLedger}
          />
        </div>
      )}

      {!live && (
        <p className="mt-3 text-caption text-muted">
          Sending freezes these numbers and captures a snapshot. It doesn&rsquo;t email the client.
        </p>
      )}
    </div>
  );
}

/**
 * An open draft's one action is to send it; a sent one's is to record the
 * client's answer. Never both — offering "send" on a live quote is how you end
 * up with two documents under the same name.
 */
function QuotePrimaryAction({
  live,
  status,
  onSend,
  onAccept,
}: {
  live: LiveQuote;
  status: string;
  onSend: () => void;
  onAccept: () => void;
}) {
  if (!live) {
    return (
      <CanDo resource="invoice" action="create">
        <Button size="sm" className="h-7" onClick={onSend}>
          <Send className="mr-1 size-3" />
          Send quote
        </Button>
      </CanDo>
    );
  }
  if (status !== "SENT") return null;
  return (
    <CanDo resource="invoice" action="update">
      <Button size="sm" className="h-7" onClick={onAccept}>
        <CheckCircle2 className="mr-1 size-3" />
        Record accept
      </Button>
    </CanDo>
  );
}

function QuoteActions({
  live,
  status,
  pdfQuoteId,
  onSend,
  onAccept,
  onOpenLedger,
}: {
  live: LiveQuote;
  status: string;
  /** Set only when a STORED artifact exists — there is deliberately no
   *  regeneration fallback, so a revision whose render failed offers no link. */
  pdfQuoteId: string | null;
  onSend: () => void;
  onAccept: () => void;
  onOpenLedger: () => void;
}) {
  return (
    <OverviewActions>
      <QuotePrimaryAction live={live} status={status} onSend={onSend} onAccept={onAccept} />
      {pdfQuoteId && (
        <Button variant="line" size="sm" className="h-7" asChild>
          <a href={`/api/finance/quote/${pdfQuoteId}/pdf`} target="_blank" rel="noopener noreferrer">
            <Download className="mr-1 size-3" />
            View PDF
          </a>
        </Button>
      )}
      <Button variant="line" size="sm" className="h-7" onClick={onOpenLedger}>
        All revisions
      </Button>
    </OverviewActions>
  );
}

/**
 * The project's CURRENT quote, on the Overview tab (#1061).
 *
 * Deliberately not a second quote rail. This card answers "what did we tell
 * the client, and what's the one thing I'd do next" — send the open draft, or
 * record the client's answer on a sent one. Every other verb (recall,
 * correction, delete, reprice, the revision viewer and diff) stays in the
 * Finance tab's `ProjectQuoteRail`, which remains the single owner of the
 * revision workflow. The two dialogs used here are the SAME components that
 * rail uses, not reimplementations.
 */
export function QuoteCard({
  projectId,
  orgId,
  projectNumber,
  clientId,
  projectStatus,
  subtotal,
  taxAmount,
  total,
  onOpenLedger,
}: QuoteCardProps) {
  // Frozen at mount, like the rail's own `now`: it only drives the DERIVED
  // expiry read, and a value that changed every render would re-subscribe.
  const [now] = useState(() => Date.now());
  const [sendOpen, setSendOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);

  const revisionState = useAuthedQuery(
    api.quotes.revisionStateForProject,
    orgId ? { orgId, projectId, now } : "skip",
  );
  const quotes = useAuthedQuery(api.quotes.listForProject, orgId ? { orgId, projectId, now } : "skip");

  if (!orgId || revisionState === undefined || quotes === undefined) {
    return (
      <Panel className="p-4">
        <p className="text-caption text-muted">Loading quote…</p>
      </Panel>
    );
  }

  const live = revisionState.liveQuote;
  const liveRow = live ? quotes.find((q) => q.id === live.id) : undefined;
  // A sent quote's amount is the FROZEN snapshot total, never live project
  // pricing — the whole point of the freeze. Only a never-sent draft shows the
  // project's current total, because that IS what sending would freeze.
  const frozenTotal = (liveRow?.snapshot as { total?: number } | null | undefined)?.total;
  const amount = live ? frozenTotal ?? null : total;

  const status = live?.status ?? "DRAFT";
  const intent = quoteStatusIntent(status);

  return (
    <Panel className="flex flex-col p-0">
      <OverviewCardHeader
        title="Quote"
        badge={<Badge status={intentToBadgeStatus(intent)}>{quoteStatusLabel(status)}</Badge>}
      />

      <QuoteCardBody
        amount={amount}
        revision={revisionState.revision}
        live={live}
        projectId={projectId}
        orgId={orgId}
        onOpenLedger={onOpenLedger}
      />

      <QuoteActions
        live={live}
        status={status}
        pdfQuoteId={liveRow?.pdfFileId ? liveRow.id : null}
        onSend={() => setSendOpen(true)}
        onAccept={() => setAcceptOpen(true)}
        onOpenLedger={onOpenLedger}
      />

      <QuoteCardDialogs
        sendOpen={sendOpen}
        onSendOpenChange={setSendOpen}
        acceptOpen={acceptOpen}
        onAcceptOpenChange={setAcceptOpen}
        live={live}
        projectId={projectId}
        projectNumber={projectNumber}
        orgId={orgId}
        clientId={clientId}
        revision={revisionState.revision}
        subtotal={subtotal}
        taxAmount={taxAmount}
        total={total}
        projectStatus={projectStatus}
      />
    </Panel>
  );
}

/** `EXPIRED` is derived, never stored — always label from `effectiveStatus`. */
function quoteStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    SENT: "Sent",
    ACCEPTED: "Accepted",
    DECLINED: "Declined",
    EXPIRED: "Expired",
    RECALLED: "Recalled",
    SUPERSEDED: "Superseded",
  };
  return labels[status] ?? status;
}

function QuoteCardDialogs({
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
        <AcceptQuoteDialog
          open={acceptOpen}
          onOpenChange={onAcceptOpenChange}
          quoteId={live.id}
          version={live.version}
        />
      )}
    </>
  );
}
