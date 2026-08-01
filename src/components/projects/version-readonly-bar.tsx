"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";
import { useProjectVersion, type ProjectVersionListItem } from "@/components/projects/project-version-context";
import { PromoteVersionDialog } from "@/components/projects/finance/promote-version-dialog";
import { PromoteConflictsPanel } from "@/components/projects/finance/promote-conflicts-panel";
import type { PromoteRevisionResult } from "@/hooks/use-project-version-writes";

function formatFullDate(ms: number | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The bar's one date line — whichever of sent/accepted/saved is most
 *  specific for this version. Split out purely to keep both this and the
 *  bar's own branch count under R-3.6's ceiling. */
function formatDateBit(v: ProjectVersionListItem | null): string | null {
  if (!v) return null;
  if (v.sentAt) return `sent ${formatFullDate(v.sentAt)}`;
  if (v.acceptedAt) return `accepted ${formatFullDate(v.acceptedAt)}`;
  if (v.createdAt) return `saved ${formatFullDate(v.createdAt)}`;
  return null;
}

function BackToLiveButton({ liveRevision, onClick }: { liveRevision: number | null; onClick: () => void }) {
  return (
    <Button variant="line" size="sm" onClick={onClick}>
      Back to live{liveRevision != null ? ` (v${liveRevision})` : ""}
    </Button>
  );
}

function MakeLiveButton({ onClick, revision }: { onClick: () => void; revision: number }) {
  return (
    <Button type="button" size="sm" onClick={onClick}>
      Make v{revision} live…
    </Button>
  );
}

/** The design doc's "no captured state (pre-versioning)" fallback — a
 *  revision with no snapshot, never rendered as an error page. */
function NoCapturedStateBar({
  viewingRevision,
  liveRevision,
  onBackToLive,
}: {
  viewingRevision: number | null;
  liveRevision: number | null;
  onBackToLive: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r)] border border-line bg-card p-3"
    >
      <div className="flex items-center gap-2 text-ui-text text-ink-2">
        <Clock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          No captured state for v{viewingRevision} — pre-versioning. Nothing was frozen for this
          revision, so it can&apos;t be viewed here.
        </span>
      </div>
      <BackToLiveButton liveRevision={liveRevision} onClick={onBackToLive} />
    </div>
  );
}

function ViewingVersionBar({
  viewingRevision,
  liveRevision,
  viewingVersion,
  onBackToLive,
  onMakeLive,
}: {
  viewingRevision: number | null;
  liveRevision: number | null;
  viewingVersion: ProjectVersionListItem | null;
  onBackToLive: () => void;
  onMakeLive: (() => void) | null;
}) {
  const dateBit = formatDateBit(viewingVersion);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-amber-700 dark:text-amber-300">
        <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <span className="font-semibold">Viewing v{viewingRevision}</span>
        {dateBit && <span>· {dateBit}</span>}
        {viewingVersion?.total != null && <span>· {formatCurrency(viewingVersion.total)}</span>}
        <span>· read-only</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onMakeLive && viewingRevision != null && <MakeLiveButton revision={viewingRevision} onClick={onMakeLive} />}
        <BackToLiveButton liveRevision={liveRevision} onClick={onBackToLive} />
      </div>
    </div>
  );
}

/**
 * Full-width read-only bar (design doc §4.2) — always mounted while `?v=` is
 * set to a real, non-live revision. "Make vN live…" (#1080/#1097, Phase 4)
 * opens the same `PromoteVersionDialog` the Finance tab's version rail uses
 * (R-3.1 — one dialog, two entry points) and, on success, returns to live
 * viewing automatically since the version just promoted IS the new live one.
 *
 * `role="status"`/`aria-live="polite"` — the viewing-a-version state must be
 * ANNOUNCED, not colour-only (DESIGN.md, a11y-manual-checklist.md).
 */
export function VersionReadOnlyBar({ orgId }: { orgId: string }) {
  const { projectId, versions, isViewingVersion, hasCapturedState, viewingVersion, viewingRevision, liveRevision, setViewingRevision } =
    useProjectVersion();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteResult, setPromoteResult] = useState<PromoteRevisionResult | null>(null);

  if (!isViewingVersion) return null;

  const onBackToLive = () => setViewingRevision(null);

  if (!hasCapturedState) {
    return <NoCapturedStateBar viewingRevision={viewingRevision} liveRevision={liveRevision} onBackToLive={onBackToLive} />;
  }

  return (
    <div className="space-y-2">
      <ViewingVersionBar
        viewingRevision={viewingRevision}
        liveRevision={liveRevision}
        viewingVersion={viewingVersion}
        onBackToLive={onBackToLive}
        onMakeLive={viewingVersion?.snapshotId ? () => setPromoteOpen(true) : null}
      />
      <PromoteConflictsPanel result={promoteResult} onDismiss={() => setPromoteResult(null)} />
      {viewingVersion?.snapshotId && liveRevision != null && (
        <PromoteVersionDialog
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          projectId={projectId}
          orgId={orgId}
          targetRevision={viewingVersion.revision}
          targetSnapshotId={viewingVersion.snapshotId}
          liveRevision={liveRevision}
          liveHasSnapshot={versions.find((v) => v.revision === liveRevision)?.hasSnapshot ?? false}
          onPromoted={(result) => {
            setPromoteResult(result);
            setViewingRevision(null);
          }}
        />
      )}
    </div>
  );
}
