"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  History,
  Lock,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  Unlock,
  XCircle,
} from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { generateQuoteArtifact } from "@/server/finance-documents";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { quoteStatusIntent } from "@/lib/status-colors";
import { daysUntilValidUntil, QUOTE_EXPIRING_SOON_DAYS } from "@/lib/quote-validity";
import { useCanDo, useIsOwner } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import { CanDo } from "@/components/auth/permission-gate";
import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";
import { AcceptQuoteDialog } from "@/components/projects/finance/accept-quote-dialog";
import { CorrectQuoteDialog } from "@/components/projects/finance/correct-quote-dialog";
import { DeleteRecalledDialog } from "@/components/projects/finance/delete-recalled-dialog";
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
  /** DEPRECATED pre-#986 name — a row only the backfill hasn't reached yet
   *  can carry this instead of `sentAt`. Checked alongside it wherever "was
   *  this ever sent" matters (deleteDraft vs. deleteRecalled eligibility),
   *  mirroring `convex/quotesWrites.ts`'s own check. */
  publishedAt?: number;
  quoteDate?: number;
  validUntil?: number;
  validityDays?: number;
  snapshot?: unknown;
  snapshotId?: string | null;
  /** The STORED document for this revision (#987) — the bytes the client was
   *  given. Null on a never-sent draft, and on a sent revision whose render
   *  failed (which is what the retry action is for). */
  pdfFileId?: string;
  /** Soft lock (#1030) — while true, Recall/Correction/recall-then-delete all
   *  refuse server-side; the row hides those actions rather than offering a
   *  button that will just error. */
  protected?: boolean;
}

type ReasonVerb = "recall" | "decline";
export interface ReasonTarget {
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
  const [unacceptTarget, setUnacceptTarget] = useState<QuoteRevisionDoc | null>(null);
  const [viewerTarget, setViewerTarget] = useState<QuoteRevisionDoc | null>(null);
  const [repriceTarget, setRepriceTarget] = useState<QuoteRevisionDoc | null>(null);
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<QuoteRevisionDoc | null>(null);
  const [deleteRecalledTarget, setDeleteRecalledTarget] = useState<QuoteRevisionDoc | null>(null);
  const [correctTarget, setCorrectTarget] = useState<QuoteRevisionDoc | null>(null);
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

  return (
    <div className="space-y-2">
      <QuoteRailHeader
        revision={revision}
        hasOpenDraft={hasOpenDraft}
        onSend={() => setSendOpen(true)}
        onCreateNextVersion={() => newVersionMutation.mutate(undefined)}
        creatingNextVersion={newVersionMutation.isPending}
      />

      <QuoteRailDriftIndicator
        projectId={projectId}
        orgId={orgId}
        revision={revision}
        liveQuote={liveQuote}
        quotes={quotes}
        onSeeWhatChanged={setViewerTarget}
      />

      <p className="t-micro text-fg-4">
        Sending freezes pricing at that revision — to change prices afterwards, create the next version.
        Flow doesn&rsquo;t email clients; sending records the send and generates the document for you.
      </p>

      <QuoteRevisionList
        quotes={quotes}
        visibleQuotes={visibleQuotes}
        hiddenCount={hiddenCount}
        showAll={showAll}
        onShowAll={() => setShowAll(true)}
        revision={revision}
        projectId={projectId}
        now={now}
        onAccept={setAcceptTarget}
        onUnaccept={setUnacceptTarget}
        onDecline={(quote) => setReasonTarget({ id: quote.id, version: quote.version, verb: "decline" })}
        onRecall={(quote) => setReasonTarget({ id: quote.id, version: quote.version, verb: "recall" })}
        onView={setViewerTarget}
        onDeleteDraft={setDeleteDraftTarget}
        onDeleteRecalled={setDeleteRecalledTarget}
        onCorrect={setCorrectTarget}
      />

      <UnacceptedLiveQuoteNotice liveQuote={liveQuote} hasAcceptedQuote={hasAcceptedQuote} />

      <ReasonDialog target={reasonTarget} onClose={() => setReasonTarget(null)} />

      <UnacceptDialog target={unacceptTarget} onClose={() => setUnacceptTarget(null)} />

      <DeleteDraftDialog target={deleteDraftTarget} onClose={() => setDeleteDraftTarget(null)} />

      {deleteRecalledTarget && (
        <DeleteRecalledDialog
          open={!!deleteRecalledTarget}
          onOpenChange={(open) => !open && setDeleteRecalledTarget(null)}
          quoteId={deleteRecalledTarget.id}
          label={`${projectNumber} v${deleteRecalledTarget.version}`}
        />
      )}

      {correctTarget && (
        <CorrectQuoteDialog
          open={!!correctTarget}
          onOpenChange={(open) => !open && setCorrectTarget(null)}
          quoteId={correctTarget.id}
          version={correctTarget.version}
          currentQuoteDate={correctTarget.quoteDate}
          currentValidityDays={correctTarget.validityDays}
        />
      )}

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

      <QuoteRailTargetDialogs
        projectId={projectId}
        orgId={orgId}
        revision={revision}
        hasOpenDraft={hasOpenDraft}
        quotes={quotes}
        acceptTarget={acceptTarget}
        onCloseAccept={() => setAcceptTarget(null)}
        viewerTarget={viewerTarget}
        onCloseViewer={() => setViewerTarget(null)}
        onReprice={() => {
          setRepriceTarget(viewerTarget);
          setViewerTarget(null);
        }}
        repriceTarget={repriceTarget}
        onCloseReprice={() => setRepriceTarget(null)}
      />
    </div>
  );
}

function QuoteRailHeader({
  revision,
  hasOpenDraft,
  onSend,
  onCreateNextVersion,
  creatingNextVersion,
}: {
  revision: number;
  hasOpenDraft: boolean;
  onSend: () => void;
  onCreateNextVersion: () => void;
  creatingNextVersion: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="t-overline text-fg-3">Quote</h3>
      <CanDo resource="invoice" action="publish">
        {hasOpenDraft ? (
          <Button type="button" variant="line" size="sm" onClick={onSend}>
            <Send className="h-3.5 w-3.5" /> Send quote v{revision}
          </Button>
        ) : (
          <Button type="button" variant="line" size="sm" loading={creatingNextVersion} onClick={onCreateNextVersion}>
            <FileText className="h-3.5 w-3.5" /> Create quote v{revision + 1}
          </Button>
        )}
      </CanDo>
    </div>
  );
}

function QuoteRailDriftIndicator({
  projectId,
  orgId,
  revision,
  liveQuote,
  quotes,
  onSeeWhatChanged,
}: {
  projectId: string;
  orgId: string | undefined;
  revision: number;
  liveQuote: { id: string; snapshotId?: string | null; version: number } | null | undefined;
  quotes: QuoteRevisionDoc[];
  onSeeWhatChanged: (quote: QuoteRevisionDoc) => void;
}) {
  if (!orgId) return null;
  return (
    <QuoteDriftIndicator
      projectId={projectId}
      orgId={orgId}
      snapshotId={liveQuote?.snapshotId ?? null}
      version={liveQuote?.version ?? revision}
      onSeeWhatChanged={() => {
        const q = quotes.find((qt) => qt.id === liveQuote?.id);
        if (q) onSeeWhatChanged(q);
      }}
    />
  );
}

function QuoteRevisionList({
  quotes,
  visibleQuotes,
  hiddenCount,
  showAll,
  onShowAll,
  revision,
  projectId,
  now,
  onAccept,
  onUnaccept,
  onDecline,
  onRecall,
  onView,
  onDeleteDraft,
  onDeleteRecalled,
  onCorrect,
}: {
  quotes: QuoteRevisionDoc[];
  visibleQuotes: QuoteRevisionDoc[];
  hiddenCount: number;
  showAll: boolean;
  onShowAll: () => void;
  revision: number;
  projectId: string;
  now: number;
  onAccept: (quote: QuoteRevisionDoc) => void;
  onUnaccept: (quote: QuoteRevisionDoc) => void;
  onDecline: (quote: QuoteRevisionDoc) => void;
  onRecall: (quote: QuoteRevisionDoc) => void;
  onView: (quote: QuoteRevisionDoc) => void;
  onDeleteDraft: (quote: QuoteRevisionDoc) => void;
  onDeleteRecalled: (quote: QuoteRevisionDoc) => void;
  onCorrect: (quote: QuoteRevisionDoc) => void;
}) {
  if (quotes.length === 0) {
    return <p className="t-micro text-fg-4">No quote yet — sending creates v{revision}.</p>;
  }
  return (
    <>
      <ul className="space-y-1.5">
        {visibleQuotes.map((quote) => (
          <QuoteRevisionRow
            key={quote.id}
            quote={quote}
            projectId={projectId}
            onAccept={() => onAccept(quote)}
            onUnaccept={() => onUnaccept(quote)}
            onDecline={() => onDecline(quote)}
            onRecall={() => onRecall(quote)}
            onView={() => onView(quote)}
            onDeleteDraft={() => onDeleteDraft(quote)}
            onDeleteRecalled={() => onDeleteRecalled(quote)}
            onCorrect={() => onCorrect(quote)}
            now={now}
          />
        ))}
      </ul>
      {hiddenCount > 0 && !showAll && (
        <button
          type="button"
          className="flex items-center gap-1.5 t-micro text-fg-4 underline underline-offset-2"
          onClick={onShowAll}
        >
          <History className="h-3 w-3" /> Show {hiddenCount} earlier revision{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
    </>
  );
}

function UnacceptedLiveQuoteNotice({
  liveQuote,
  hasAcceptedQuote,
}: {
  liveQuote: { id: string } | null | undefined;
  hasAcceptedQuote: boolean;
}) {
  if (!liveQuote || hasAcceptedQuote) return null;
  return (
    <p className="t-micro text-warn">
      This project can&rsquo;t be confirmed until a quote revision is marked accepted (admins and the
      project&rsquo;s PMs can override with a reason).
    </p>
  );
}

/** The three revision-scoped dialogs (accept / viewer / reprice) — each keyed
 *  off its own "target" state, so only one mounts at a time. */
function QuoteRailTargetDialogs({
  projectId,
  orgId,
  revision,
  hasOpenDraft,
  quotes,
  acceptTarget,
  onCloseAccept,
  viewerTarget,
  onCloseViewer,
  onReprice,
  repriceTarget,
  onCloseReprice,
}: {
  projectId: string;
  orgId: string | undefined;
  revision: number;
  hasOpenDraft: boolean;
  quotes: QuoteRevisionDoc[];
  acceptTarget: QuoteRevisionDoc | null;
  onCloseAccept: () => void;
  viewerTarget: QuoteRevisionDoc | null;
  onCloseViewer: () => void;
  onReprice: () => void;
  repriceTarget: QuoteRevisionDoc | null;
  onCloseReprice: () => void;
}) {
  const previousQuote = viewerTarget
    ? (quotes.find((q) => q.version === viewerTarget.version - 1) ?? null)
    : null;

  return (
    <>
      {acceptTarget && (
        <AcceptQuoteDialog
          open={!!acceptTarget}
          onOpenChange={(open) => !open && onCloseAccept()}
          quoteId={acceptTarget.id}
          version={acceptTarget.version}
        />
      )}

      {viewerTarget && orgId && (
        <QuoteRevisionViewerDialog
          open={!!viewerTarget}
          onOpenChange={(open) => !open && onCloseViewer()}
          projectId={projectId}
          orgId={orgId}
          quote={viewerTarget}
          previousQuote={previousQuote}
          canReprice={!hasOpenDraft}
          nextVersion={revision + 1}
          onReprice={onReprice}
        />
      )}

      {repriceTarget && orgId && repriceTarget.snapshotId && (
        <RepriceFromRevisionDialog
          open={!!repriceTarget}
          onOpenChange={(open) => !open && onCloseReprice()}
          projectId={projectId}
          orgId={orgId}
          sourceQuoteId={repriceTarget.id}
          sourceSnapshotId={repriceTarget.snapshotId}
          sourceVersion={repriceTarget.version}
          nextVersion={revision + 1}
        />
      )}
    </>
  );
}

/**
 * One revision in the rail. Identity is `v<version>` — a quote has no document
 * number of its own (decision 5); it is referred to everywhere as
 * `<projectNumber> v<version>`, and the project number is already on the page.
 */
/** Derived booleans shared by `QuoteRevisionRow` and its two action clusters —
 *  computed once so the split-out components read as pure props, not a second
 *  copy of the same status checks (R-3.1). */
export function quoteRowFlags(quote: QuoteRevisionDoc) {
  const isSent = quote.effectiveStatus === "SENT";
  const isAccepted = quote.effectiveStatus === "ACCEPTED";
  // A sent-or-expired revision is the one the client is holding: it can be
  // recalled or declined. Only a still-valid one can be accepted.
  const isHeldByClient = isSent || quote.effectiveStatus === "EXPIRED";
  const isProtected = !!quote.protected;
  const everSent = quote.sentAt != null || quote.publishedAt != null;
  // A DRAFT with send history is sitting here because of a Recall (#1027) —
  // it needs the stricter recall-then-delete flow (#1029), not the ordinary
  // never-sent draft delete (#1028).
  const isRecalledDraft = quote.effectiveStatus === "DRAFT" && everSent;
  const isNeverSentDraft = quote.effectiveStatus === "DRAFT" && !everSent;
  return { isSent, isAccepted, isHeldByClient, isProtected, isRecalledDraft, isNeverSentDraft };
}

/**
 * Every state-transition action for a revision, collapsed into ONE overflow
 * menu (#1038) instead of a wall of pill buttons that wrapped across 2-3
 * lines on mobile with a sent-and-unprotected row (Mark accepted / Declined /
 * Recall could join Correct date / Protect, all as separate buttons). Same
 * two audiences as before — `invoice:publish` (`useCanDo`, mirrors `<CanDo>`)
 * for the standard cluster, owner-only (`useIsOwner`) for protect/correct/
 * delete-permanently — just read as booleans up front so both clusters can
 * merge into one action list instead of two side-by-side button groups.
 * `requireQuoteOwnerOnly`/the `invoice:publish` permission check are still the
 * real server-side gates; this is UX only.
 */
/** The `invoice:publish` cluster's actions — accept/decline/recall/delete-draft. */
export function standardQuoteRowActions(
  flags: ReturnType<typeof quoteRowFlags>,
  handlers: { onAccept: () => void; onUnaccept: () => void; onDecline: () => void; onRecall: () => void; onDeleteDraft: () => void },
): RowAction[] {
  const { isSent, isAccepted, isHeldByClient, isProtected, isNeverSentDraft } = flags;
  const actions: RowAction[] = [];
  if (isSent) actions.push({ key: "accept", label: "Mark accepted", icon: CheckCircle2, onClick: handlers.onAccept });
  if (isAccepted) actions.push({ key: "unaccept", label: "Unapprove", icon: RotateCcw, onClick: handlers.onUnaccept });
  if (isHeldByClient) actions.push({ key: "decline", label: "Declined", icon: XCircle, onClick: handlers.onDecline });
  if (isHeldByClient && !isProtected) actions.push({ key: "recall", label: "Recall", icon: Undo2, onClick: handlers.onRecall });
  if (isNeverSentDraft) actions.push({ key: "delete-draft", label: "Delete draft", icon: Trash2, onClick: handlers.onDeleteDraft, destructive: true });
  return actions;
}

/** The owner-only cluster's actions (#1026 follow-up program) —
 *  protect/unprotect, correct-date, recall-then-delete. */
export function ownerOnlyQuoteRowActions(
  flags: ReturnType<typeof quoteRowFlags>,
  handlers: { onCorrect: () => void; onDeleteRecalled: () => void; onToggleProtect: () => void; protectPending: boolean },
): RowAction[] {
  const { isSent, isAccepted, isProtected, isRecalledDraft } = flags;
  const actions: RowAction[] = [];
  if ((isSent || isAccepted) && !isProtected) {
    actions.push({ key: "correct", label: "Correct date", icon: Pencil, onClick: handlers.onCorrect });
  }
  if (isSent || isAccepted) {
    actions.push({
      key: "protect",
      label: isProtected ? "Unprotect" : "Protect",
      icon: isProtected ? Unlock : Lock,
      onClick: handlers.onToggleProtect,
      loading: handlers.protectPending,
    });
  }
  if (isRecalledDraft && !isProtected) {
    actions.push({ key: "delete-recalled", label: "Delete permanently", icon: Trash2, onClick: handlers.onDeleteRecalled, destructive: true });
  }
  return actions;
}

function QuoteRowActions({
  quote,
  flags,
  onAccept,
  onUnaccept,
  onDecline,
  onRecall,
  onDeleteDraft,
  onDeleteRecalled,
  onCorrect,
}: {
  quote: QuoteRevisionDoc;
  flags: ReturnType<typeof quoteRowFlags>;
  onAccept: () => void;
  onUnaccept: () => void;
  onDecline: () => void;
  onRecall: () => void;
  onDeleteDraft: () => void;
  onDeleteRecalled: () => void;
  onCorrect: () => void;
}) {
  const canPublish = useCanDo("invoice", "publish");
  const isOwner = useIsOwner();
  const quoteWrites = useQuoteWrites();
  const protectMutation = useServerMutation({
    mutationFn: (next: boolean) => quoteWrites.setProtected(quote.id, next),
    onSuccess: (r) => toast.success(r.protected ? `Protected v${quote.version}` : `Unprotected v${quote.version}`),
    onError: (e) => toast.error(e.message),
  });

  const actions: RowAction[] = [
    ...(canPublish ? standardQuoteRowActions(flags, { onAccept, onUnaccept, onDecline, onRecall, onDeleteDraft }) : []),
    ...(isOwner
      ? ownerOnlyQuoteRowActions(flags, {
          onCorrect,
          onDeleteRecalled,
          onToggleProtect: () => protectMutation.mutate(!flags.isProtected),
          protectPending: protectMutation.isPending,
        })
      : []),
  ];

  return <RowActionsMenu actions={actions} label={`v${quote.version} actions`} />;
}

function QuoteRevisionRow({
  quote,
  projectId,
  onAccept,
  onUnaccept,
  onDecline,
  onRecall,
  onView,
  onDeleteDraft,
  onDeleteRecalled,
  onCorrect,
  now,
}: {
  quote: QuoteRevisionDoc;
  projectId: string;
  onAccept: () => void;
  onUnaccept: () => void;
  onDecline: () => void;
  onRecall: () => void;
  onView: () => void;
  onDeleteDraft: () => void;
  onDeleteRecalled: () => void;
  onCorrect: () => void;
  now: number;
}) {
  const flags = quoteRowFlags(quote);

  return (
    <li className="flex items-center justify-between gap-2 rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onView}>
        <RevisionMeta quote={quote} now={now} />
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        <QuoteDocumentAction quote={quote} projectId={projectId} />
        <QuoteRowActions
          quote={quote}
          flags={flags}
          onAccept={onAccept}
          onUnaccept={onUnaccept}
          onDecline={onDecline}
          onRecall={onRecall}
          onDeleteDraft={onDeleteDraft}
          onDeleteRecalled={onDeleteRecalled}
          onCorrect={onCorrect}
        />
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

/** Delete a never-sent draft (#1028) — a plain confirm, no text field, since
 *  nothing outside the company has ever seen this revision. Still a real
 *  `Dialog` rather than `window.confirm` (CLAUDE.md — no `AlertDialog`
 *  anywhere in this codebase). Recall-then-delete (#1029) is a different,
 *  stricter dialog (`DeleteRecalledDialog`) — this one never fires for a
 *  revision that was ever sent; the server rejects it too if the row somehow
 *  changed underneath the click. */
function DeleteDraftDialog({ target, onClose }: { target: QuoteRevisionDoc | null; onClose: () => void }) {
  const quoteWrites = useQuoteWrites();
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!target) return;
    setPending(true);
    try {
      const result = await quoteWrites.deleteDraft(target.id);
      toast.success(
        result.revision === target.version
          ? `Deleted v${target.version}`
          : `Deleted v${target.version} — back to v${result.revision}`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete draft v{target?.version}</DialogTitle>
          <DialogDescription>
            Nobody outside the company has seen this draft. Deleting it frees the version number for the
            next one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Delete draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Unapprove (#1032) — the reverse of "Mark accepted". A plain confirm, no
 *  reason field: unlike Recall/Decline, this reverses the SAME action Accept
 *  just took rather than recording a separate business decision, so there's
 *  nothing new to justify. Clears the acceptance fields and the `protected`
 *  flag Accept auto-set, in one step (server-side, `unacceptNative`). Real
 *  `Dialog`, not a bare click — this is still a high-danger reversal (CLAUDE.md
 *  §"Danger classification"), so it gets the same "are you sure" beat as
 *  `DeleteDraftDialog`. */
function UnacceptDialog({ target, onClose }: { target: QuoteRevisionDoc | null; onClose: () => void }) {
  const quoteWrites = useQuoteWrites();
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!target) return;
    setPending(true);
    try {
      await quoteWrites.unaccept(target.id);
      toast.success(`Unapproved v${target.version} — it's back to sent`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unapprove");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Unapprove v{target?.version}</DialogTitle>
          <DialogDescription>
            Reverses the acceptance — this revision goes back to sent, and the project loses its
            confirm-eligibility on this quote until it&rsquo;s re-accepted. The document already sent to
            the client is unaffected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Unapprove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recall and decline both take a bounded reason, so both route through ONE
 *  Dialog rather than two near-identical ones. (Radix `Dialog` — there is no
 *  `AlertDialog` in this codebase.) Exported so `<ProjectLockStrip>` (#990)
 *  can offer "Recall" from the top-level lock strip without a second
 *  hand-built recall dialog (POLICY.md R-3.1). */
export function ReasonDialog({ target, onClose }: { target: ReasonTarget | null; onClose: () => void }) {
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

