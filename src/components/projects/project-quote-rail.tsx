"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Send, Undo2, XCircle } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CanDo } from "@/components/auth/permission-gate";

/**
 * The quote REVISION RAIL (#986, Phase A) — one row per revision over the
 * project's single `revision` counter, with the five verbs wired up.
 *
 * This is the minimum viable surface for exercising the model. The real Finance
 * tab — a send dialog with quote date / valid-until / recipient / watermarked
 * preview, version history with diffs, and the drift indicator — is Phase D
 * (#989). The state → intent mapping likewise lands there as
 * `quoteStatusIntent()` in `status-colors.ts`; this uses the badge vocabulary
 * the finance panel already had.
 */

/** Minimum reason length per verb — mirrors `quoteRecallSchema`/
 *  `quoteDeclineSchema`, which the server mirrors again via `fieldGuards`. The
 *  disabled button is UX; neither client check is the security boundary. */
const REASON_MIN = { recall: 10, decline: 3 } as const;

const QUOTE_STATUS_BADGE: Record<string, "ok" | "warn" | "neutral" | "overbooked"> = {
  DRAFT: "neutral",
  SENT: "ok",
  ACCEPTED: "ok",
  DECLINED: "overbooked",
  EXPIRED: "warn",
  SUPERSEDED: "neutral",
};

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
}

type ReasonVerb = "recall" | "decline";
interface ReasonTarget {
  id: string;
  version: number;
  verb: ReasonVerb;
}

export function ProjectQuoteRail({ projectId, orgId }: { projectId: string; orgId: string | undefined }) {
  // Frozen at mount: `now` only drives the DERIVED expiry read, and a value that
  // changed every render would re-subscribe the queries on every render. Phase D
  // owns live-ticking validity copy.
  const [now] = useState(() => Date.now());
  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null);

  const quotes = useAuthedQuery(api.quotes.listForProject, orgId ? { orgId, projectId, now } : "skip");
  const revisionState = useAuthedQuery(
    api.quotes.revisionStateForProject,
    orgId ? { orgId, projectId, now } : "skip",
  );
  const quoteWrites = useQuoteWrites();

  const sendMutation = useServerMutation({
    mutationFn: () => quoteWrites.send(projectId),
    onSuccess: (r) => toast.success(`Sent quote v${r.version} — pricing is now frozen at this revision`),
    onError: (e) => toast.error(e.message),
  });
  const newVersionMutation = useServerMutation({
    mutationFn: () => quoteWrites.newVersion(projectId),
    onSuccess: (r) => toast.success(`Started quote v${r.version}`),
    onError: (e) => toast.error(e.message),
  });

  async function acceptQuote(quote: QuoteRevisionDoc) {
    try {
      await quoteWrites.markAccepted(quote.id);
      toast.success(`Marked v${quote.version} accepted — this project can now be confirmed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark accepted");
    }
  }

  if (quotes === undefined || revisionState === undefined) {
    return <p className="t-micro text-fg-4">Loading quotes…</p>;
  }

  const { revision, liveQuote, hasAcceptedQuote, draftQuoteId } = revisionState;

  return (
    <div className="space-y-2">
      <RailHeader
        revision={revision}
        hasOpenDraft={draftQuoteId != null || quotes.length === 0}
        sending={sendMutation.isPending}
        creating={newVersionMutation.isPending}
        onSend={() => sendMutation.mutate(undefined)}
        onNewVersion={() => newVersionMutation.mutate(undefined)}
      />

      <p className="t-micro text-fg-4">
        Sending freezes pricing at that revision — to change prices afterwards, create the next version.
        Flow doesn&rsquo;t email clients; sending records the send and generates the document for you.
      </p>

      {quotes.length === 0 ? (
        <p className="t-micro text-fg-4">No quote yet — sending creates v{revision}.</p>
      ) : (
        <ul className="space-y-1.5">
          {quotes.map((quote) => (
            <QuoteRevisionRow
              key={quote.id}
              quote={quote}
              onAccept={() => void acceptQuote(quote)}
              onDecline={() => setReasonTarget({ id: quote.id, version: quote.version, verb: "decline" })}
              onRecall={() => setReasonTarget({ id: quote.id, version: quote.version, verb: "recall" })}
            />
          ))}
        </ul>
      )}

      {liveQuote && !hasAcceptedQuote && (
        <p className="t-micro text-warn">
          This project can&rsquo;t be confirmed until a quote revision is marked accepted (admins and the
          project&rsquo;s PMs can override with a reason).
        </p>
      )}

      <ReasonDialog target={reasonTarget} onClose={() => setReasonTarget(null)} />
    </div>
  );
}

function RailHeader({
  revision,
  hasOpenDraft,
  sending,
  creating,
  onSend,
  onNewVersion,
}: {
  revision: number;
  hasOpenDraft: boolean;
  sending: boolean;
  creating: boolean;
  onSend: () => void;
  onNewVersion: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="t-overline text-fg-3">Quote</h3>
      <CanDo resource="invoice" action="publish">
        {hasOpenDraft ? (
          <Button type="button" variant="line" size="sm" loading={sending} onClick={onSend}>
            <Send className="h-3.5 w-3.5" /> Send quote v{revision}
          </Button>
        ) : (
          <Button type="button" variant="line" size="sm" loading={creating} onClick={onNewVersion}>
            <FileText className="h-3.5 w-3.5" /> Create quote v{revision + 1}
          </Button>
        )}
      </CanDo>
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
  onAccept,
  onDecline,
  onRecall,
}: {
  quote: QuoteRevisionDoc;
  onAccept: () => void;
  onDecline: () => void;
  onRecall: () => void;
}) {
  const isSent = quote.effectiveStatus === "SENT";
  // A sent-or-expired revision is the one the client is holding: it can be
  // recalled or declined. Only a still-valid one can be accepted.
  const isHeldByClient = isSent || quote.effectiveStatus === "EXPIRED";

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <RevisionMeta quote={quote} />
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
    </li>
  );
}

function RevisionMeta({ quote }: { quote: QuoteRevisionDoc }) {
  // A DRAFT carries no frozen money — its figures are the project's live totals
  // until it is sent, so the row deliberately shows no amount.
  const total = (quote.snapshot as { total?: number } | null)?.total;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge status={QUOTE_STATUS_BADGE[quote.effectiveStatus] ?? "neutral"}>{quote.effectiveStatus}</Badge>
      <span className="font-medium text-fg">v{quote.version}</span>
      {total != null && <span className="tabular-nums text-fg-4">{formatCurrency(total)}</span>}
      {quote.sentAt != null && <span className="text-fg-4">sent {formatDate(new Date(quote.sentAt))}</span>}
      {quote.effectiveStatus === "SENT" && quote.validUntil != null && (
        <span className="text-fg-4">valid until {formatDate(new Date(quote.validUntil))}</span>
      )}
    </div>
  );
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
            disabled={reason.trim().length < REASON_MIN[target?.verb ?? "decline"]}
            onClick={() => void confirm()}
          >
            {isRecall ? "Recall quote" : "Mark declined"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
