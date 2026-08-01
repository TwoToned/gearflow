"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Download } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import {
  diffSnapshotEntries,
  projectTotalsFromEntry,
  type SnapshotEntryLike,
} from "@/lib/project-snapshot-diff";
import { formatCurrency } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ViewedQuote {
  id: string;
  version: number;
  snapshotId?: string | null;
  pdfFileId?: string | null;
}

interface QuoteRevisionViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  quote: ViewedQuote;
  /** The revision immediately below this one, if any — powers "vs previous". */
  previousQuote?: ViewedQuote | null;
  /** Whether "Use vN's pricing for v(N+1)" should render — only when no draft
   *  currently exists (preserves the one-draft invariant, #989 §8.1). */
  canReprice: boolean;
  /** The revision reprice would create — `projects.revision + 1`, NOT
   *  necessarily `quote.version + 1` (the source may be an old revision while
   *  a later one is current). */
  nextVersion: number;
  onReprice?: () => void;
}

type CompareMode = "previous" | "current";

type Diff = {
  rows: ReturnType<typeof diffSnapshotEntries>;
  before: ReturnType<typeof projectTotalsFromEntry>;
  after: ReturnType<typeof projectTotalsFromEntry>;
} | null;

/** The "as of this quote" snapshot vs. either the previous revision or the job right now. */
function useQuoteRevisionDiff({
  open,
  mode,
  projectId,
  orgId,
  quote,
  previousQuote,
}: {
  open: boolean;
  mode: CompareMode;
  projectId: string;
  orgId: string;
  quote: ViewedQuote;
  previousQuote?: ViewedQuote | null;
}): Diff {
  const thisEntries = useQuery(
    api.projectLocksRead.snapshotEntries,
    open && quote.snapshotId ? { snapshotId: quote.snapshotId, orgId } : "skip",
  );
  const previousEntries = useQuery(
    api.projectLocksRead.snapshotEntries,
    open && mode === "previous" && previousQuote?.snapshotId ? { snapshotId: previousQuote.snapshotId, orgId } : "skip",
  );
  const currentEntries = useQuery(
    api.projectLocksRead.currentEntries,
    open && mode === "current" ? { projectId, orgId } : "skip",
  );

  const compareEntries = mode === "previous" ? previousEntries : currentEntries;

  return useMemo(() => {
    if (!thisEntries || !compareEntries) return null;
    const before = thisEntries as SnapshotEntryLike[];
    const after = compareEntries as SnapshotEntryLike[];
    return {
      rows: diffSnapshotEntries(before, after),
      before: projectTotalsFromEntry(before.find((e) => e.entityType === "project")),
      after: projectTotalsFromEntry(after.find((e) => e.entityType === "project")),
    };
  }, [thisEntries, compareEntries]);
}

/**
 * The read-only "as of v N" view + diff (#989 §8), reusing the existing
 * snapshot/diff plumbing (`project-snapshot-diff.ts`, `convex/projectLocksRead.ts`)
 * — the same pair the retired `⋯ Versions` panel used to exercise (#1097) —
 * scoped to ONE quote revision instead of every whole-project snapshot, and
 * reachable from the Finance tab's workflow instead of a separate menu.
 *
 * Trimmed to two comparisons (D5): vs the previous revision, and vs the job
 * right now. Highlighting is always on — a toggle that turns off the reason
 * you opened compare view isn't a feature.
 */
export function QuoteRevisionViewerDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  quote,
  previousQuote,
  canReprice,
  nextVersion,
  onReprice,
}: QuoteRevisionViewerDialogProps) {
  const [mode, setMode] = useState<CompareMode>(previousQuote?.snapshotId ? "previous" : "current");
  const diff = useQuoteRevisionDiff({ open, mode, projectId, orgId, quote, previousQuote });

  if (!quote.snapshotId) {
    return <NoSnapshotDialog open={open} onOpenChange={onOpenChange} quote={quote} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Quote v{quote.version}</DialogTitle>
          <DialogDescription>Read-only snapshot as of this revision.</DialogDescription>
        </DialogHeader>

        <CompareModeToggle mode={mode} onModeChange={setMode} hasPrevious={!!previousQuote?.snapshotId} />
        <DiffTotalsSummary diff={diff} />
        <DiffRowList diff={diff} />

        <DialogFooter className="justify-between sm:justify-between">
          <PdfDownloadLink quoteId={quote.id} pdfFileId={quote.pdfFileId} />
          {canReprice && onReprice && (
            <Button type="button" onClick={onReprice}>
              Use v{quote.version}&rsquo;s pricing for v{nextVersion}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoSnapshotDialog({
  open,
  onOpenChange,
  quote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: ViewedQuote;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quote v{quote.version}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-4">
          Sent before version history — the PDF is the record.
        </p>
        <PdfDownloadLink quoteId={quote.id} pdfFileId={quote.pdfFileId} className="w-fit" />
      </DialogContent>
    </Dialog>
  );
}

function PdfDownloadLink({
  quoteId,
  pdfFileId,
  className,
}: {
  quoteId: string;
  pdfFileId?: string | null;
  className?: string;
}) {
  if (!pdfFileId) return <span />;
  return (
    <Button variant="line" asChild className={className}>
      <a href={`/api/finance/quote/${quoteId}/pdf`} target="_blank" rel="noopener noreferrer">
        <Download className="h-3.5 w-3.5" /> Download PDF
      </a>
    </Button>
  );
}

function CompareModeToggle({
  mode,
  onModeChange,
  hasPrevious,
}: {
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  hasPrevious: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <Button
        type="button"
        variant={mode === "previous" ? "primary" : "line"}
        size="sm"
        disabled={!hasPrevious}
        onClick={() => onModeChange("previous")}
        title={!hasPrevious ? "There's no earlier revision to compare against." : undefined}
      >
        vs previous
      </Button>
      <Button type="button" variant={mode === "current" ? "primary" : "line"} size="sm" onClick={() => onModeChange("current")}>
        vs the job now
      </Button>
    </div>
  );
}

function DiffTotalsSummary({ diff }: { diff: Diff }) {
  if (!diff || (!diff.before && !diff.after)) return null;
  return (
    <div className="grid grid-cols-1 gap-3 rounded-[var(--radius)] border border-line p-3 text-sm sm:grid-cols-3">
      <div>
        <p className="text-xs text-fg-4">Subtotal</p>
        <p className="tabular-nums">{money(diff.before?.subtotal)} → {money(diff.after?.subtotal)}</p>
      </div>
      <div>
        <p className="text-xs text-fg-4">Total</p>
        <p className="tabular-nums">{money(diff.before?.total)} → {money(diff.after?.total)}</p>
      </div>
      <div>
        <p className="text-xs text-fg-4">Margin</p>
        <p className="tabular-nums">{money(diff.before?.margin)} → {money(diff.after?.margin)}</p>
      </div>
    </div>
  );
}

function DiffRowList({ diff }: { diff: Diff }) {
  return (
    <div className="max-h-72 space-y-1.5 overflow-y-auto">
      {!diff && <p className="text-sm text-fg-4">Loading…</p>}
      {diff && diff.rows.length === 0 && <p className="text-sm text-fg-4">No changes.</p>}
      {diff?.rows.map((row) => (
        <div
          key={`${row.entityType}:${row.entityId}`}
          className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-line px-3 py-2 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Badge status={row.status === "removed" ? "overbooked" : row.status === "added" ? "ok" : "warn"}>{row.status}</Badge>
            <span className="truncate">{row.label}</span>
          </span>
          {(row.beforePrice != null || row.afterPrice != null) && (
            <span className="shrink-0 tabular-nums text-fg-4">
              {money(row.beforePrice)} → {money(row.afterPrice)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return formatCurrency(n);
}
