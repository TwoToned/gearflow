"use client";

import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";
import { useProjectVersion, type ProjectVersionListItem } from "@/components/projects/project-version-context";

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
}: {
  viewingRevision: number | null;
  liveRevision: number | null;
  viewingVersion: ProjectVersionListItem | null;
  onBackToLive: () => void;
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
      <BackToLiveButton liveRevision={liveRevision} onClick={onBackToLive} />
    </div>
  );
}

/**
 * Full-width read-only bar (design doc §4.2) — always mounted while `?v=` is
 * set to a real, non-live revision. "Make vN live…" (promote) is Phase 2/4
 * scope (#1089/#1097, not yet shipped) — deliberately absent here rather than
 * a dead button; the design doc's own out-of-scope note for #1093 excludes
 * the promote action and dialog.
 *
 * `role="status"`/`aria-live="polite"` — the viewing-a-version state must be
 * ANNOUNCED, not colour-only (DESIGN.md, a11y-manual-checklist.md).
 */
export function VersionReadOnlyBar() {
  const { isViewingVersion, hasCapturedState, viewingVersion, viewingRevision, liveRevision, setViewingRevision } =
    useProjectVersion();

  if (!isViewingVersion) return null;

  const onBackToLive = () => setViewingRevision(null);

  if (!hasCapturedState) {
    return <NoCapturedStateBar viewingRevision={viewingRevision} liveRevision={liveRevision} onBackToLive={onBackToLive} />;
  }

  return (
    <ViewingVersionBar
      viewingRevision={viewingRevision}
      liveRevision={liveRevision}
      viewingVersion={viewingVersion}
      onBackToLive={onBackToLive}
    />
  );
}
