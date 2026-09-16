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
  Pencil,
  Send,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { generateQuoteArtifact } from "@/server/finance-documents";
import { diffSnapshotEntries, type SnapshotEntryLike } from "@/lib/project-snapshot-diff";
import { summarizeDrift, describeDrift } from "@/lib/quote-drift";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { quoteStatusIntent, intentToBadgeStatus } from "@/lib/status-colors";
import { daysUntilValidUntil, QUOTE_EXPIRING_SOON_DAYS } from "@/lib/quote-validity";
import { useCanDo, useIsOwner } from "@/lib/use-permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import { CanDo } from "@/components/auth/permission-gate";
import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";
import { AcceptQuoteDialog } from "@/components/projects/finance/accept-quote-dialog";
import { DeleteRecalledDialog } from "@/components/projects/finance/delete-recalled-dialog";
import { QuoteRevisionViewerDialog } from "@/components/projects/finance/quote-revision-viewer-dialog";

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
  /** #1080/#1097 — internal name for the version, editable from the row.
   *  Printed on the document only when `labelOnDocument` was stamped at send. */
  label?: string;
}

/** The lineage subset of an invoice this rail needs (#1080/#1097) — `sourceRevision`
 *  is stamped once at CREATE and never updated (design §3.6). Not exported:
 *  `ProjectFinancePanel` passes its `invoices.listForProject` rows straight
 *  through, which structurally satisfies this shape without importing it. */
interface InvoiceLineageDoc {
  id: string;
  invoiceNumber?: string;
  kind: string;
  status: string;
  total: number;
  sourceRevision?: number;
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
  /** #1080/#1097 — for the per-version invoice lineage line. Loaded once by
   *  the parent (`ProjectFinancePanel` already queries `invoices.listForProject`
   *  for its own ledger) and passed down rather than a second query (R-3.1). */
  invoices?: InvoiceLineageDoc[];
}

/** The quote row at `liveRevision`, if any — pulled out to a plain function
 *  (rather than inline in `ProjectQuoteRail`) purely to keep that component's
 *  own branch count down (R-3.6). */
function findLiveQuote(quotes: QuoteRevisionDoc[], liveRevision: number): QuoteRevisionDoc | null {
  return quotes.find((q) => q.version === liveRevision) ?? null;
}

/** Every embed site (`ProjectFinancePanel`, `QuoteManagerDialog`) must assign a
 *  client before rendering `<ProjectQuoteRail>` — checked at the call site
 *  rather than inside the rail itself, which is already at its complexity
 *  budget (R-3.6). Shared here so the message can't drift between sites. */
export const ASSIGN_CLIENT_FOR_QUOTES_MESSAGE = "Assign a client to this project to generate quotes.";

export function ProjectQuoteRail({ projectId, orgId, projectNumber, clientId, projectStatus, subtotal, taxAmount, total, invoices }: ProjectQuoteRailProps) {
  // Frozen at mount: `now` only drives the DERIVED expiry read, and a value that
  // changed every render would re-subscribe the queries on every render.
  const [now] = useState(() => Date.now());
  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [acceptTarget, setAcceptTarget] = useState<QuoteRevisionDoc | null>(null);
  const [viewerTarget, setViewerTarget] = useState<QuoteRevisionDoc | null>(null);
  const [deleteRecalledTarget, setDeleteRecalledTarget] = useState<QuoteRevisionDoc | null>(null);
  const [labelTarget, setLabelTarget] = useState<QuoteRevisionDoc | null>(null);
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

  const { revision, liveRevision, hasAcceptedQuote, draftQuoteId, liveQuote } = revisionState;
  const hasOpenDraft = draftQuoteId != null || quotes.length === 0;
  const visibleQuotes = showAll ? quotes : quotes.slice(0, INITIAL_VISIBLE_REVISIONS);
  const hiddenCount = quotes.length - visibleQuotes.length;
  const liveQuoteForPromote = findLiveQuote(quotes, liveRevision);

  return (
    <div className="space-y-2">
      <QuoteRailHeader
        revision={revision}
        liveRevision={liveRevision}
        hasOpenDraft={hasOpenDraft}
        onSend={() => setSendOpen(true)}
        onCreateNextVersion={() => newVersionMutation.mutate(undefined)}
        creatingNextVersion={newVersionMutation.isPending}
      />

      {orgId && (
        <InlineQuoteDrift
          projectId={projectId}
          orgId={orgId}
          revision={revision}
          liveQuote={liveQuote}
          quotes={quotes}
          onSeeWhatChanged={setViewerTarget}
        />
      )}

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
        liveRevision={liveRevision}
        invoices={invoices}
        projectId={projectId}
        now={now}
        onAccept={setAcceptTarget}
        onDecline={(quote) => setReasonTarget({ id: quote.id, version: quote.version, verb: "decline" })}
        onRecall={(quote) => setReasonTarget({ id: quote.id, version: quote.version, verb: "recall" })}
        onView={setViewerTarget}
        onDeleteRecalled={setDeleteRecalledTarget}
        onEditLabel={setLabelTarget}
      />

      <UnacceptedLiveQuoteNotice liveQuote={liveQuote} hasAcceptedQuote={hasAcceptedQuote} />

      <ReasonDialog target={reasonTarget} onClose={() => setReasonTarget(null)} />

      <EditLabelDialog target={labelTarget} onClose={() => setLabelTarget(null)} />

      {deleteRecalledTarget && (
        <DeleteRecalledDialog
          open={!!deleteRecalledTarget}
          onOpenChange={(open) => !open && setDeleteRecalledTarget(null)}
          quoteId={deleteRecalledTarget.id}
          label={`${projectNumber} v${deleteRecalledTarget.version}`}
        />
      )}

      <SendQuoteDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        projectId={projectId}
        projectNumber={projectNumber}
        orgId={orgId}
        clientId={clientId}
        revision={liveRevision}
        currentLabel={liveQuoteForPromote?.label}
        subtotal={subtotal}
        taxAmount={taxAmount}
        total={total}
        projectStatus={projectStatus}
      />

      <QuoteRailTargetDialogs
        projectId={projectId}
        orgId={orgId}
        quotes={quotes}
        acceptTarget={acceptTarget}
        onCloseAccept={() => setAcceptTarget(null)}
        viewerTarget={viewerTarget}
        onCloseViewer={() => setViewerTarget(null)}
      />
    </div>
  );
}

function QuoteRailHeader({
  revision,
  liveRevision,
  hasOpenDraft,
  onSend,
  onCreateNextVersion,
  creatingNextVersion,
}: {
  revision: number;
  liveRevision: number;
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
          // #1080/#1097 — sends whatever is LIVE, not necessarily the
          // allocator's high-water mark (a promote can leave them apart).
          <Button type="button" variant="line" size="sm" onClick={onSend}>
            <Send className="h-3.5 w-3.5" /> Send quote v{liveRevision}
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

/**
 * "This job no longer matches v<N>" (#989 §6.5) — inlined from the deleted
 * shared `QuoteDriftIndicator` component (Project Versioning v2 Phase 5,
 * #1231: that shared component is one of the surfaces `VersionStrip`
 * absorbs, but its drift STATE isn't rebuilt into the strip this phase —
 * see FEATUREDOCS/76's Phase 5 section). `diffSnapshotEntries`/
 * `summarizeDrift`/`describeDrift` (`src/lib/quote-drift.ts`,
 * `src/lib/project-snapshot-diff.ts`) are unchanged — only the shared
 * wrapper component is gone, not the underlying logic (R-3.1: this and
 * `overview/quote-card.tsx`'s own inline copy both call the same functions).
 */
function InlineQuoteDrift({
  projectId,
  orgId,
  revision,
  liveQuote,
  quotes,
  onSeeWhatChanged,
}: {
  projectId: string;
  orgId: string;
  revision: number;
  liveQuote: { id: string; snapshotId?: string | null; version: number } | null | undefined;
  quotes: QuoteRevisionDoc[];
  onSeeWhatChanged: (quote: QuoteRevisionDoc) => void;
}) {
  const snapshotId = liveQuote?.snapshotId ?? null;
  const version = liveQuote?.version ?? revision;
  const snapshotEntries = useAuthedQuery(
    api.projectLocksRead.snapshotEntries,
    snapshotId ? { snapshotId, orgId } : "skip",
  );
  const currentEntries = useAuthedQuery(
    api.projectLocksRead.currentEntries,
    snapshotId ? { projectId, orgId } : "skip",
  );

  if (!snapshotId || snapshotEntries === undefined || currentEntries === undefined) return null;
  const rows = diffSnapshotEntries(snapshotEntries as SnapshotEntryLike[], currentEntries as SnapshotEntryLike[]);
  const summary = summarizeDrift(rows);
  if (!summary.hasDrift) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border-l-[3px] border-l-warn bg-warn-soft px-3 py-2 text-sm text-warn">
      <span>
        This job no longer matches v{version} — {describeDrift(summary)}.
      </span>
      <button
        type="button"
        className="shrink-0 font-semibold underline underline-offset-2"
        onClick={() => {
          const q = quotes.find((qt) => qt.id === liveQuote?.id);
          if (q) onSeeWhatChanged(q);
        }}
      >
        See what changed
      </button>
    </div>
  );
}

function QuoteRevisionList({
  quotes,
  visibleQuotes,
  hiddenCount,
  showAll,
  onShowAll,
  revision,
  liveRevision,
  invoices,
  projectId,
  now,
  onAccept,
  onDecline,
  onRecall,
  onView,
  onDeleteRecalled,
  onEditLabel,
}: {
  quotes: QuoteRevisionDoc[];
  visibleQuotes: QuoteRevisionDoc[];
  hiddenCount: number;
  showAll: boolean;
  onShowAll: () => void;
  revision: number;
  liveRevision: number;
  invoices?: InvoiceLineageDoc[];
  projectId: string;
  now: number;
  onAccept: (quote: QuoteRevisionDoc) => void;
  onDecline: (quote: QuoteRevisionDoc) => void;
  onRecall: (quote: QuoteRevisionDoc) => void;
  onView: (quote: QuoteRevisionDoc) => void;
  onDeleteRecalled: (quote: QuoteRevisionDoc) => void;
  onEditLabel: (quote: QuoteRevisionDoc) => void;
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
            isLive={quote.version === liveRevision}
            invoicesForVersion={invoices?.filter((inv) => inv.sourceRevision === quote.version) ?? []}
            projectId={projectId}
            onAccept={() => onAccept(quote)}
            onDecline={() => onDecline(quote)}
            onRecall={() => onRecall(quote)}
            onView={() => onView(quote)}
            onDeleteRecalled={() => onDeleteRecalled(quote)}
            onEditLabel={() => onEditLabel(quote)}
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
/** #1231 note: "Reprice from revision" is gone — `repriceFromRevisionNative`
 *  was deleted in #1229 Phase 3, superseded by `versions.createNative`
 *  ("New version from vN"), now exclusively a Versions panel verb. The
 *  viewer dialog's own Reprice button is disabled (`canReprice={false}`)
 *  rather than removed, so its layout doesn't shift. */
function QuoteRailTargetDialogs({
  projectId,
  orgId,
  quotes,
  acceptTarget,
  onCloseAccept,
  viewerTarget,
  onCloseViewer,
}: {
  projectId: string;
  orgId: string | undefined;
  quotes: QuoteRevisionDoc[];
  acceptTarget: QuoteRevisionDoc | null;
  onCloseAccept: () => void;
  viewerTarget: QuoteRevisionDoc | null;
  onCloseViewer: () => void;
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
          canReprice={false}
          nextVersion={viewerTarget.version + 1}
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
  const everSent = quote.sentAt != null || quote.publishedAt != null;
  // A DRAFT with send history is sitting here because of a Recall (#1027) —
  // it needs the stricter recall-then-delete flow (#1029), not the ordinary
  // never-sent draft delete (#1028).
  const isRecalledDraft = quote.effectiveStatus === "DRAFT" && everSent;
  const isNeverSentDraft = quote.effectiveStatus === "DRAFT" && !everSent;
  return { isSent, isAccepted, isHeldByClient, isRecalledDraft, isNeverSentDraft };
}

/**
 * Every state-transition action for a revision, collapsed into ONE overflow
 * menu (#1038) instead of a wall of pill buttons. Same two audiences as
 * before — `invoice:publish` (`useCanDo`, mirrors `<CanDo>`) for the standard
 * cluster, owner-only (`useIsOwner`) for delete-permanently — read as
 * booleans up front so both clusters can merge into one action list instead
 * of two side-by-side button groups. `requireQuoteOwnerOnly`/the
 * `invoice:publish` permission check are still the real server-side gates;
 * this is UX only.
 *
 * #1230 note: Unapprove (`unacceptNative`), Correct date (`correctQuoteNative`)
 * and Protect/Unprotect are DELETED — the whole protect/unprotect mechanism
 * (and its lock-tier plumbing) is gone. Recall (`recallNative`) survives
 * unchanged and is no longer gated on a `protected` check.
 */
/** The `invoice:publish` cluster's actions — accept/decline/recall/rename.
 *  #1231 note: "Delete draft" is gone — `deleteDraftNative` was deleted in
 *  #1229 Phase 3, superseded by `versions.deleteNative`; deleting a version
 *  is now exclusively a Versions panel verb (design §5.1, "one control to
 *  switch, one place to manage"), not a per-quote-row action here. */
export function standardQuoteRowActions(
  flags: ReturnType<typeof quoteRowFlags>,
  handlers: {
    onAccept: () => void;
    onDecline: () => void;
    onRecall: () => void;
    onEditLabel: () => void;
  },
): RowAction[] {
  const { isSent, isHeldByClient } = flags;
  const actions: RowAction[] = [];
  actions.push({ key: "rename", label: "Rename version", icon: Pencil, onClick: handlers.onEditLabel });
  if (isSent) actions.push({ key: "accept", label: "Mark accepted", icon: CheckCircle2, onClick: handlers.onAccept });
  if (isHeldByClient) actions.push({ key: "decline", label: "Declined", icon: XCircle, onClick: handlers.onDecline });
  if (isHeldByClient) actions.push({ key: "recall", label: "Recall", icon: Undo2, onClick: handlers.onRecall });
  return actions;
}

/** The owner-only cluster's actions — recall-then-delete (#1029) survives;
 *  protect/unprotect and correct-date are deleted (#1230). */
export function ownerOnlyQuoteRowActions(
  flags: ReturnType<typeof quoteRowFlags>,
  handlers: { onDeleteRecalled: () => void },
): RowAction[] {
  const { isRecalledDraft } = flags;
  const actions: RowAction[] = [];
  if (isRecalledDraft) {
    actions.push({ key: "delete-recalled", label: "Delete permanently", icon: Trash2, onClick: handlers.onDeleteRecalled, destructive: true });
  }
  return actions;
}

function QuoteRowActions({
  quote,
  flags,
  onAccept,
  onDecline,
  onRecall,
  onDeleteRecalled,
  onEditLabel,
}: {
  quote: QuoteRevisionDoc;
  flags: ReturnType<typeof quoteRowFlags>;
  onAccept: () => void;
  onDecline: () => void;
  onRecall: () => void;
  onDeleteRecalled: () => void;
  onEditLabel: () => void;
}) {
  const canPublish = useCanDo("invoice", "publish");
  const isOwner = useIsOwner();

  const actions: RowAction[] = [
    ...(canPublish ? standardQuoteRowActions(flags, { onAccept, onDecline, onRecall, onEditLabel }) : []),
    ...(isOwner ? ownerOnlyQuoteRowActions(flags, { onDeleteRecalled }) : []),
  ];

  return <RowActionsMenu actions={actions} label={`v${quote.version} actions`} />;
}

/** #1231 note: the row's "Make live" button is gone — making a version live
 *  is now exclusively the header pill / Versions panel's job (design §5.1),
 *  not a per-quote-row action wired onto a QUOTE revision number that may no
 *  longer line up 1:1 with a `projectVersions` row's own number. */
function QuoteRevisionRow({
  quote,
  isLive,
  invoicesForVersion,
  projectId,
  onAccept,
  onDecline,
  onRecall,
  onView,
  onDeleteRecalled,
  onEditLabel,
  now,
}: {
  quote: QuoteRevisionDoc;
  isLive: boolean;
  invoicesForVersion: InvoiceLineageDoc[];
  projectId: string;
  onAccept: () => void;
  onDecline: () => void;
  onRecall: () => void;
  onView: () => void;
  onDeleteRecalled: () => void;
  onEditLabel: () => void;
  now: number;
}) {
  const flags = quoteRowFlags(quote);

  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onView}>
          <RevisionMeta quote={quote} isLive={isLive} now={now} />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <QuoteDocumentAction quote={quote} projectId={projectId} />
          <QuoteRowActions
            quote={quote}
            flags={flags}
            onAccept={onAccept}
            onDecline={onDecline}
            onRecall={onRecall}
            onDeleteRecalled={onDeleteRecalled}
            onEditLabel={onEditLabel}
          />
        </div>
      </div>
      <InvoiceLineageNote invoicesForVersion={invoicesForVersion} version={quote.version} />
    </li>
  );
}

/** Per-version invoice lineage (#1080/#1097, design §3.6) — `sourceRevision` is
 *  stamped once at CREATE and never updated, so this always reflects the
 *  version that actually produced an invoice's figures, even after a later
 *  promote moves the project's live version elsewhere. */
function InvoiceLineageNote({ invoicesForVersion, version }: { invoicesForVersion: InvoiceLineageDoc[]; version: number }) {
  if (invoicesForVersion.length === 0) {
    return <p className="pl-1 t-micro text-fg-4">No invoices issued from v{version}.</p>;
  }
  return (
    <p className="pl-1 t-micro text-fg-4">
      {invoicesForVersion.length} invoice{invoicesForVersion.length === 1 ? "" : "s"} from v{version}:{" "}
      {invoicesForVersion.map((inv, i) => (
        <span key={inv.id}>
          {i > 0 && ", "}
          {inv.invoiceNumber ?? inv.kind} ({formatCurrency(inv.total)})
        </span>
      ))}
    </p>
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

function RevisionMeta({ quote, isLive, now }: { quote: QuoteRevisionDoc; isLive: boolean; now: number }) {
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
      {/* "Live" (decision 13, design doc) — never "Latest": a promoted older
          version can sit above a newer one, so a recency word would fight
          what's on screen. */}
      {isLive && <Badge status="ok">Live</Badge>}
      {quote.label && <span className="truncate text-fg-4">&ldquo;{quote.label}&rdquo;</span>}
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


/** Rename a version's internal label from the row (#1080/#1097) — a plain text
 *  field, never a monetary/structural change. Reachable on any revision. */
function EditLabelDialog({ target, onClose }: { target: QuoteRevisionDoc | null; onClose: () => void }) {
  if (!target) return null;
  return <EditLabelDialogContent key={target.id} target={target} onClose={onClose} />;
}

/** Keyed by `target.id` on the parent so each open remounts with a fresh,
 *  correctly-seeded field (React's remount-on-key-change instead of an
 *  effect to sync controlled state from a changing prop). */
function EditLabelDialogContent({ target, onClose }: { target: QuoteRevisionDoc; onClose: () => void }) {
  const quoteWrites = useQuoteWrites();
  const [label, setLabel] = useState(target.label ?? "");
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await quoteWrites.setLabel(target.id, { label });
      toast.success(label ? `Labelled v${target.version} "${label}"` : `Cleared v${target.version}'s label`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename v{target.version}</DialogTitle>
          <DialogDescription>
            An internal name for this version — never printed on the document unless you check that box
            when sending.
          </DialogDescription>
        </DialogHeader>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Budget option" maxLength={60} />
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Save name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recall and decline both take a bounded reason, so both route through ONE
 *  Dialog rather than two near-identical ones. (Radix `Dialog` — there is no
 *  `AlertDialog` in this codebase.) #1230 deleted the top-level lock strip's
 *  own one-click "Recall to edit" exit (the quote-derived lock it existed for
 *  is gone) — this row-scoped reason form is now the only recall path. */
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

