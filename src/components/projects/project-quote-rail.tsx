"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Eye, FileText, History, Send, Undo2, XCircle } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { generateQuoteArtifact } from "@/server/finance-documents";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { quoteStatusIntent } from "@/lib/status-colors";
import { daysUntilValidUntil, QUOTE_EXPIRING_SOON_DAYS } from "@/lib/quote-validity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CanDo } from "@/components/auth/permission-gate";
import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";
import { AcceptQuoteDialog } from "@/components/projects/finance/accept-quote-dialog";
import { QuoteRevisionViewerDialog } from "@/components/projects/finance/quote-revision-viewer-dialog";
import { RepriceFromRevisionDialog } from "@/components/projects/finance/reprice-from-revision-dialog";
import { QuoteDriftIndicator } from "@/components/projects/finance/quote-drift-indicator";

/**
 * The Finance tab's QUOTE section (#989) — the structured workflow that
 * replaces "press the Documents button and hope". One row per revision over
 * the project's single `revision` counter (#986), with the five verbs, a send
 * dialog that captures quote date / validity / recipient (no money — R-9.3), a
 * read-only revision viewer + diff, and the reprice-from-revision forward-only
 * undo (§8.1).
 */

/** Rows beyond this are collapsed behind "Show N earlier revisions" — a haggled
 *  job reaching v7 would otherwise push invoices below the fold. */
const INITIAL_VISIBLE_REVISIONS = 3;

interface QuoteRevisionDoc {
  id: string;
  version: number;
  /** DERIVED — `EXPIRED` is never stored (convex/lib/quoteState.ts). Always
   *  branch on this, never on the raw `status` column, which can still read
   *  `PUBLISHED` on a row the backfill hasn't reached. */
  effectiveStatus: string;
  sentAt?: number;
  validUntil?: number;
  snapshot?: unknown;
  snapshotId?: string | null;
  /** The STORED document for this revision (#987) — the bytes the client was
   *  given. Null on a never-sent draft, and on a sent revision whose render
   *  failed (which is what the retry action is for). */
  pdfFileId?: string;
}

type ReasonVerb = "recall" | "decline";
interface ReasonTarget {
  id: string;
  version: number;
  verb: ReasonVerb;
}

interface ProjectQuoteRailProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
}

export function ProjectQuoteRail({ projectId, orgId, projectNumber, clientId, projectStatus, subtotal, taxAmount, total }: ProjectQuoteRailProps) {
  // Frozen at mount: `now` only drives the DERIVED expiry read, and a value that
  // changed every render would re-subscribe the queries on every render.
  const [now] = useState(() => Date.now());
  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [acceptTarget, setAcceptTarget] = useState<QuoteRevisionDoc | null>(null);
  const [viewerTarget, setViewerTarget] = useState<QuoteRevisionDoc | null>(null);
  const [repriceTarget, setRepriceTarget] = useState<QuoteRevisionDoc | null>(null);
  const [showAll, setShowAll] = useState(false);

  const quotes = useAuthedQuery(api.quotes.listForProject, orgId ? { orgId, projectId, now } : "skip");
  const revisionState = useAuthedQuery(
    api.quotes.revisionStateForProject,
    orgId ? { orgId, projectId, now } : "skip",
  );
  const quoteWrites = useQuoteWrites();

  const newVersionMutation = useServerMutation({
    mutationFn: () => quoteWrites.newVersion(projectId),
    onSuccess: (r) => toast.success(`Started quote v${r.version}`),
    onError: (e) => toast.error(e.message),
  });

  if (quotes === undefined || revisionState === undefined) {
    return <p className="t-micro text-fg-4">Loading quotes…</p>;
  }

  const { revision, hasAcceptedQuote, draftQuoteId, liveQuote } = revisionState;
  const hasOpenDraft = draftQuoteId != null || quotes.length === 0;
  const visibleQuotes = showAll ? quotes : quotes.slice(0, INITIAL_VISIBLE_REVISIONS);
  const hiddenCount = quotes.length - visibleQuotes.length;

  function findPrevious(version: number): QuoteRevisionDoc | null {
    return (quotes ?? []).find((q) => q.version === version - 1) ?? null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="t-overline text-fg-3">Quote</h3>
        <CanDo resource="invoice" action="publish">
          {hasOpenDraft ? (
            <Button type="button" variant="line" size="sm" onClick={() => setSendOpen(true)}>
              <Send className="h-3.5 w-3.5" /> Send quote v{revision}
            </Button>
          ) : (
            <Button
              type="button"
              variant="line"
              size="sm"
              loading={newVersionMutation.isPending}
              onClick={() => newVersionMutation.mutate(undefined)}
            >
              <FileText className="h-3.5 w-3.5" /> Create quote v{revision + 1}
            </Button>
          )}
        </CanDo>
      </div>

      {orgId && (
        <QuoteDriftIndicator
          projectId={projectId}
          orgId={orgId}
          snapshotId={liveQuote?.snapshotId ?? null}
          version={liveQuote?.version ?? revision}
          onSeeWhatChanged={() => {
            const q = quotes.find((qt) => qt.id === liveQuote?.id);
            if (q) setViewerTarget(q);
          }}
        />
      )}

      <p className="t-micro text-fg-4">
        Sending freezes pricing at that revision — to change prices afterwards, create the next version.
        Flow doesn&rsquo;t email clients; sending records the send and generates the document for you.
      </p>

      {quotes.length === 0 ? (
        <p className="t-micro text-fg-4">No quote yet — sending creates v{revision}.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {visibleQuotes.map((quote) => (
              <QuoteRevisionRow
                key={quote.id}
                quote={quote}
                projectId={projectId}
                onAccept={() => setAcceptTarget(quote)}
                onDecline={() => setReasonTarget({ id: quote.id, version: quote.version, verb: "decline" })}
                onRecall={() => setReasonTarget({ id: quote.id, version: quote.version, verb: "recall" })}
                onView={() => setViewerTarget(quote)}
                now={now}
              />
            ))}
          </ul>
          {hiddenCount > 0 && !showAll && (
            <button
              type="button"
              className="flex items-center gap-1.5 t-micro text-fg-4 underline underline-offset-2"
              onClick={() => setShowAll(true)}
            >
              <History className="h-3 w-3" /> Show {hiddenCount} earlier revision{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}

      {liveQuote && !hasAcceptedQuote && (
        <p className="t-micro text-warn">
          This project can&rsquo;t be confirmed until a quote revision is marked accepted (admins and the
          project&rsquo;s PMs can override with a reason).
        </p>
      )}

      <ReasonDialog target={reasonTarget} onClose={() => setReasonTarget(null)} />

      <SendQuoteDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
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

      {acceptTarget && (
        <AcceptQuoteDialog
          open={!!acceptTarget}
          onOpenChange={(open) => !open && setAcceptTarget(null)}
          quoteId={acceptTarget.id}
          version={acceptTarget.version}
        />
      )}

      {viewerTarget && orgId && (
        <QuoteRevisionViewerDialog
          open={!!viewerTarget}
          onOpenChange={(open) => !open && setViewerTarget(null)}
          projectId={projectId}
          orgId={orgId}
          quote={viewerTarget}
          previousQuote={findPrevious(viewerTarget.version)}
          canReprice={!hasOpenDraft}
          nextVersion={revision + 1}
          onReprice={() => {
            setRepriceTarget(viewerTarget);
            setViewerTarget(null);
          }}
        />
      )}

      {repriceTarget && orgId && repriceTarget.snapshotId && (
        <RepriceFromRevisionDialog
          open={!!repriceTarget}
          onOpenChange={(open) => !open && setRepriceTarget(null)}
          projectId={projectId}
          orgId={orgId}
          sourceQuoteId={repriceTarget.id}
          sourceSnapshotId={repriceTarget.snapshotId}
          sourceVersion={repriceTarget.version}
          nextVersion={revision + 1}
        />
      )}
    </div>
  );
}

/**
 * One revision in the rail. Identity is `v<version>` — a quote has no document
 * number of its own (decision 5); it is referred to everywhere as
 * `<projectNumber> v<version>`, and the project number is already on the page.
 */
function QuoteRevisionRow({
  quote,
  projectId,
  onAccept,
  onDecline,
  onRecall,
  onView,
  now,
}: {
  quote: QuoteRevisionDoc;
  projectId: string;
  onAccept: () => void;
  onDecline: () => void;
  onRecall: () => void;
  onView: () => void;
  now: number;
}) {
  const isSent = quote.effectiveStatus === "SENT";
  // A sent-or-expired revision is the one the client is holding: it can be
  // recalled or declined. Only a still-valid one can be accepted.
  const isHeldByClient = isSent || quote.effectiveStatus === "EXPIRED";

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={onView}>
        <RevisionMeta quote={quote} now={now} />
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <QuoteDocumentAction quote={quote} projectId={projectId} />
        <CanDo resource="invoice" action="publish">
          <div className="flex items-center gap-1.5">
            {isSent && (
              <Button type="button" variant="line" size="sm" onClick={onAccept}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark accepted
              </Button>
            )}
            {isHeldByClient && (
              <Button type="button" variant="line" size="sm" onClick={onDecline}>
                <XCircle className="h-3.5 w-3.5" /> Declined
              </Button>
            )}
            {isHeldByClient && (
              <Button type="button" variant="line" size="sm" onClick={onRecall}>
                <Undo2 className="h-3.5 w-3.5" /> Recall
              </Button>
            )}
          </div>
        </CanDo>
      </div>
    </li>
  );
}

/**
 * The document side of a revision (#987) — exactly one of three states, so the
 * absence of a document is never silent:
 *
 * 1. **Stored artifact** → download the bytes the client was given. Still
 *    offered on a superseded/recalled/declined revision: they may be holding
 *    that copy, and the record is worse without it.
 * 2. **Sent, but no artifact** → the render failed after the send committed.
 *    Retry (only ever callable while `pdfFileId` is null — the server refuses to
 *    overwrite, so this can't rewrite history).
 * 3. **Never sent** → a watermarked DRAFT PREVIEW, which is deliberately not
 *    stored anywhere and says "NOT SENT" on every page.
 */
function QuoteDocumentAction({ quote, projectId }: { quote: QuoteRevisionDoc; projectId: string }) {
  const retry = useServerMutation({
    mutationFn: () => generateQuoteArtifact(quote.id),
    onSuccess: () => toast.success(`Generated the document for v${quote.version}`),
    onError: (e) => toast.error(e.message),
  });

  if (quote.pdfFileId) {
    return (
      <Button variant="line" size="sm" asChild>
        <a href={`/api/finance/quote/${quote.id}/pdf`} target="_blank" rel="noopener noreferrer">
          <Download className="h-3.5 w-3.5" /> Document
        </a>
      </Button>
    );
  }

  if (quote.sentAt != null) {
    return (
      <CanDo resource="invoice" action="publish">
        <Button
          type="button"
          variant="line"
          size="sm"
          loading={retry.isPending}
          onClick={() => retry.mutate(undefined)}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-warn" /> Document missing — generate
        </Button>
      </CanDo>
    );
  }

  return (
    <Button variant="line" size="sm" asChild>
      <a href={`/api/documents/${projectId}?type=quote&preview=1`} target="_blank" rel="noopener noreferrer">
        <Eye className="h-3.5 w-3.5" /> Preview draft
      </a>
    </Button>
  );
}

function RevisionMeta({ quote, now }: { quote: QuoteRevisionDoc; now: number }) {
  // A DRAFT carries no frozen money — its figures are the project's live totals
  // until it is sent, so the row deliberately shows no amount.
  const total = (quote.snapshot as { total?: number } | null)?.total;
  const isSuperseded = quote.effectiveStatus === "SUPERSEDED";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {/* SUPERSEDED earns no pill — a dead revision doesn't earn a filled shape
          (finance-workflow-ux.md §3.5). */}
      {isSuperseded ? (
        <span className="t-micro text-fg-4">Superseded</span>
      ) : (
        <Badge status={intentToBadgeStatus(quoteStatusIntent(quote.effectiveStatus))}>{quote.effectiveStatus}</Badge>
      )}
      <span className="font-medium text-fg">v{quote.version}</span>
      {total != null && <span className="tabular-nums text-fg-4">{formatCurrency(total)}</span>}
      {quote.sentAt != null && <span className="text-fg-4">sent {formatDate(new Date(quote.sentAt))}</span>}
      {quote.effectiveStatus === "SENT" && quote.validUntil != null && <ValidityLabel validUntil={quote.validUntil} now={now} />}
    </div>
  );
}

/** Expiry urgency — colour AND words, never colour alone (a11y): "Valid until
 *  25 Aug (28 days)" → within QUOTE_EXPIRING_SOON_DAYS "(3 days left)" in warn
 *  → past "Expired 2 days ago" in the error tone. */
function ValidityLabel({ validUntil, now }: { validUntil: number; now: number }) {
  const daysLeft = daysUntilValidUntil(validUntil, now);
  if (daysLeft == null) return null;
  const validUntilStr = formatDate(new Date(validUntil));
  if (daysLeft < 0) {
    return <span className="font-medium text-t-out">Expired {formatDate(new Date(validUntil))} ({Math.abs(daysLeft)} day{Math.abs(daysLeft) === 1 ? "" : "s"} ago)</span>;
  }
  if (daysLeft <= QUOTE_EXPIRING_SOON_DAYS) {
    return <span className="font-medium text-warn">Valid until {validUntilStr} ({daysLeft} day{daysLeft === 1 ? "" : "s"} left)</span>;
  }
  return <span className="text-fg-4">Valid until {validUntilStr}</span>;
}

/** Bridge to the `Badge` component's `status` prop vocabulary — `info`/`primary`
 *  were added to `Badge` alongside this feature specifically so SENT/ACCEPTED
 *  render in status-colors.ts's own `ColorIntent` vocabulary rather than being
 *  lossily mapped onto the unrelated ok/warn/overbooked set. */
function intentToBadgeStatus(intent: ReturnType<typeof quoteStatusIntent>): "ok" | "warn" | "overbooked" | "info" | "primary" | "neutral" {
  switch (intent) {
    case "success":
      return "ok";
    case "warning":
      return "warn";
    case "error":
      return "overbooked";
    case "info":
      return "info";
    case "primary":
      return "primary";
    default:
      return "neutral";
  }
}

/** Recall and decline both take a bounded reason, so both route through ONE
 *  Dialog rather than two near-identical ones. (Radix `Dialog` — there is no
 *  `AlertDialog` in this codebase.) */
function ReasonDialog({ target, onClose }: { target: ReasonTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const quoteWrites = useQuoteWrites();
  const isRecall = target?.verb === "recall";

  async function confirm() {
    if (!target) return;
    try {
      if (target.verb === "recall") {
        const result = await quoteWrites.recall(target.id, { reason });
        toast.success(
          result.restoredQuoteId
            ? `Recalled v${target.version} — the previous revision is the client's current quote again`
            : `Recalled v${target.version} — it's a draft again`,
        );
      } else {
        await quoteWrites.markDeclined(target.id, { reason });
        toast.success(`Marked v${target.version} declined`);
      }
      setReason("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRecall ? "Recall" : "Decline"} quote v{target?.version}
          </DialogTitle>
        </DialogHeader>
        <p className="t-micro text-fg-4">
          {isRecall
            ? "Un-sends this revision so you can edit it. The document you already sent is kept for the record — the client may still be holding it."
            : "Records that the client declined this revision. The project's status is left alone."}
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={isRecall ? "Why is this being recalled?" : "Why did the client decline?"}
          rows={3}
        />
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={reason.trim().length < (isRecall ? 10 : 3)}
            onClick={() => void confirm()}
          >
            {isRecall ? "Recall quote" : "Mark declined"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

