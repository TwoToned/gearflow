"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Download, History, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useCanDo } from "@/lib/use-permissions";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites, type PromoteRevisionResult } from "@/hooks/use-project-version-writes";
import { useProjectVersion, type ProjectVersionListItem } from "@/components/projects/project-version-context";
import { PromoteVersionDialog } from "@/components/projects/finance/promote-version-dialog";
import { PromoteConflictsPanel } from "@/components/projects/finance/promote-conflicts-panel";
import { DeleteVersionDialog, type DeleteVersionTarget } from "@/components/projects/finance/delete-version-dialog";
import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";

/** `[state]` label for a version row — "Live" per decision 13 (design doc),
 *  never "Latest": a promoted older version can sit above a newer one, so a
 *  recency word would fight what's on screen. */
function stateLabel(v: ProjectVersionListItem): string {
  if (v.isLive) return "Live";
  switch (v.status) {
    case "DRAFT":
      return v.snapshotReason === "PRE_PROMOTE" ? "Auto-saved" : "Saved";
    case "SENT":
      return "Sent";
    case "ACCEPTED":
      return "Accepted";
    case "DECLINED":
      return "Declined";
    case "SUPERSEDED":
      return "Superseded";
    case "EXPIRED":
      return "Expired";
    default:
      return v.status;
  }
}

function dateFor(v: ProjectVersionListItem): number | undefined {
  return v.acceptedAt ?? v.sentAt ?? v.createdAt;
}

function formatShortDate(ms: number | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A row's per-version actions — worked out once so the row render stays a
 *  straight line (R-3.6). Mirrors `quoteRowFlags`/the rail's own eligibility
 *  checks (`project-quote-rail.tsx`) rather than re-deriving them differently
 *  here (R-3.1): a version is deletable exactly when it's a never-sent DRAFT,
 *  promotable exactly when it's non-live with captured state, sendable
 *  exactly when it's the live DRAFT (the only one `SendQuoteDialog` can ever
 *  target — `sendNative` always freezes `liveRevision`). */
function versionRowActions(v: ProjectVersionListItem, canPublish: boolean) {
  const isNeverSentDraft = v.status === "DRAFT" && v.sentAt == null;
  return {
    canDownload: !!v.pdfFileId,
    canSend: canPublish && v.isLive && v.status === "DRAFT",
    canMakeLive: canPublish && !v.isLive && v.hasSnapshot,
    canDelete: canPublish && v.quoteId !== "" && isNeverSentDraft,
  };
}

/** The row's trailing icon cluster — split out of `VersionRow` purely to keep
 *  both functions' line count under R-3.6's ceiling. */
function VersionRowIcons({
  v,
  actions,
  onSend,
  onMakeLive,
  onDelete,
}: {
  v: ProjectVersionListItem;
  actions: ReturnType<typeof versionRowActions>;
  onSend: () => void;
  onMakeLive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {actions.canDownload && (
        <Button variant="ghost" size="icon" className="touch-target size-8" asChild aria-label={`Download v${v.revision} document`}>
          <a href={`/api/finance/quote/${v.quoteId}/pdf`} target="_blank" rel="noopener noreferrer">
            <Download className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
      {actions.canSend && (
        <Button type="button" variant="ghost" size="icon" className="touch-target size-8" aria-label={`Send v${v.revision}`} onClick={onSend}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      )}
      {actions.canMakeLive && (
        <Button type="button" variant="ghost" size="icon" className="touch-target size-8" aria-label={`Make v${v.revision} live`} onClick={onMakeLive}>
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
      )}
      {actions.canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="touch-target size-8 text-destructive hover:text-destructive"
          aria-label={`Delete v${v.revision}`}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/** One version row — the label/state/date/total (clicking it switches `?v=`)
 *  plus its trailing action icons. Split out of `ProjectVersionSwitcher`
 *  purely to keep that function's line count and complexity under R-3.6's
 *  ceiling — same reasoning as `project-quote-rail.tsx`'s `QuoteRevisionRow`. */
function VersionRow({
  v,
  isActive,
  canPublish,
  onSwitch,
  onSend,
  onMakeLive,
  onDelete,
}: {
  v: ProjectVersionListItem;
  isActive: boolean;
  canPublish: boolean;
  onSwitch: () => void;
  onSend: () => void;
  onMakeLive: () => void;
  onDelete: () => void;
}) {
  const date = formatShortDate(dateFor(v));
  const actions = versionRowActions(v, canPublish);
  return (
    <div className="flex items-center gap-1 rounded-[var(--r)] px-2 py-1.5 hover:bg-accent">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSwitch}>
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", v.isLive && "font-semibold")}>
            v{v.revision} · {stateLabel(v)}
            {v.label ? ` · ${v.label}` : ""}
          </span>
          <span className="block text-caption text-muted">
            {date}
            {v.total != null ? ` · ${formatCurrency(v.total)}` : ""}
          </span>
        </span>
      </button>
      <VersionRowIcons v={v} actions={actions} onSend={onSend} onMakeLive={onMakeLive} onDelete={onDelete} />
    </div>
  );
}

/** The three action dialogs a row can open, plus the promote conflicts panel —
 *  split out of `ProjectVersionSwitcher` for the same R-3.6 reason as
 *  `project-quote-rail.tsx`'s `QuoteRailTargetDialogs`. */
function VersionMenuDialogs({
  orgId,
  projectId,
  projectNumber,
  clientId,
  projectStatus,
  subtotal,
  taxAmount,
  total,
  liveRevision,
  liveVersion,
  deleteTarget,
  onCloseDelete,
  promoteTarget,
  onClosePromote,
  promoteResult,
  onDismissPromoteResult,
  onPromoted,
  sendOpen,
  onSendOpenChange,
}: {
  orgId: string;
  projectId: string;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  liveRevision: number | null;
  liveVersion: ProjectVersionListItem | null;
  deleteTarget: DeleteVersionTarget | null;
  onCloseDelete: () => void;
  promoteTarget: ProjectVersionListItem | null;
  onClosePromote: () => void;
  promoteResult: PromoteRevisionResult | null;
  onDismissPromoteResult: () => void;
  onPromoted: (result: PromoteRevisionResult) => void;
  sendOpen: boolean;
  onSendOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <PromoteConflictsPanel result={promoteResult} onDismiss={onDismissPromoteResult} />

      {promoteTarget?.snapshotId && liveVersion && (
        <PromoteVersionDialog
          open
          onOpenChange={(open) => !open && onClosePromote()}
          projectId={projectId}
          orgId={orgId}
          targetRevision={promoteTarget.revision}
          targetSnapshotId={promoteTarget.snapshotId}
          liveRevision={liveVersion.revision}
          liveHasSnapshot={liveVersion.hasSnapshot}
          onPromoted={onPromoted}
        />
      )}

      <DeleteVersionDialog target={deleteTarget} liveRevision={liveRevision ?? 0} onClose={onCloseDelete} />

      {liveVersion && (
        <SendQuoteDialog
          open={sendOpen}
          onOpenChange={onSendOpenChange}
          projectId={projectId}
          projectNumber={projectNumber}
          orgId={orgId}
          clientId={clientId}
          revision={liveVersion.revision}
          currentLabel={liveVersion.label}
          subtotal={subtotal}
          taxAmount={taxAmount}
          total={total}
          projectStatus={projectStatus}
        />
      )}
    </>
  );
}

interface ProjectVersionSwitcherProps {
  orgId: string;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
}

/**
 * Header version menu (design doc §4.1, extended for "fine-tune versioning" —
 * versions are the top-level thing, a quote is one optional document a
 * version can have). Mounted next to the project number/status chip, not
 * inside a tab (project-wide). Lists every version with its state, date and
 * total, switches `?v=`, and now — the part that used to be Finance-tab-only
 * or entirely unwired — lets you act on a version without leaving the header:
 *
 * - **Add version** (footer) — `saveVersionNative`, reachable from ANY live
 *   state including a never-sent draft. This is the fix for "can't make v2
 *   unless v1's quote is sent": that block was `newVersionNative`
 *   (`project-quote-rail.tsx`'s "Create quote v{N+1}"), which exists for a
 *   different job — the sanctioned exit from a quote-sent lock — and is left
 *   untouched here (R-3.1: two mutations, two distinct jobs, not one merged
 *   into the other).
 * - **Make live…** — the same `PromoteVersionDialog` `VersionReadOnlyBar` and
 *   `ProjectQuoteRail` already open (one dialog, three entry points now).
 * - **Send quote…** — the same `SendQuoteDialog` the rail uses, only ever
 *   offered on the live revision's DRAFT.
 * - **Download** — the stored artifact link, when one exists.
 * - **Delete** — the same `DeleteVersionDialog` the rail uses.
 *
 * A brand-new project has no `quotes` row at all yet; `listVersions`
 * synthesizes a virtual live entry (`quoteId: ""`) so the button is never
 * simply absent (FEATUREDOCS/70).
 */
export function ProjectVersionSwitcher({
  orgId,
  projectNumber,
  clientId,
  projectStatus,
  subtotal,
  taxAmount,
  total,
}: ProjectVersionSwitcherProps) {
  const { projectId, versions, isLoadingVersions, liveRevision, viewingRevision, isViewingVersion, setViewingRevision } =
    useProjectVersion();
  const canPublish = useCanDo("invoice", "publish");
  const { saveVersion } = useProjectVersionWrites();

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteVersionTarget | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<ProjectVersionListItem | null>(null);
  const [promoteResult, setPromoteResult] = useState<PromoteRevisionResult | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  const addVersion = useServerMutation({
    mutationFn: () => saveVersion(projectId),
    onSuccess: (r) => toast.success(`Saved v${r.savedRevision} — now editing v${r.version}`),
    onError: (e) => toast.error(e.message),
  });

  if (isLoadingVersions || versions.length === 0) return null;

  const activeRevision = isViewingVersion ? viewingRevision : liveRevision;
  const activeVersion = versions.find((v) => v.revision === activeRevision);
  const liveVersion = versions.find((v) => v.isLive) ?? null;
  const triggerLabel = activeVersion ? `v${activeVersion.revision}${activeVersion.isLive ? " · Live" : ""}` : "Versions";

  function closeMenuThen(fn: () => void) {
    setMenuOpen(false);
    fn();
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="line" size="sm" className="gap-1.5" aria-label="Project versions">
            <History className="h-3.5 w-3.5" />
            <span>{triggerLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-96">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Versions</DropdownMenuLabel>
          </DropdownMenuGroup>
          {versions.map((v) => (
            <VersionRow
              key={v.revision}
              v={v}
              isActive={v.revision === activeRevision}
              canPublish={canPublish}
              onSwitch={() => closeMenuThen(() => setViewingRevision(v.isLive ? null : v.revision))}
              onSend={() => closeMenuThen(() => setSendOpen(true))}
              onMakeLive={() => closeMenuThen(() => setPromoteTarget(v))}
              onDelete={() => closeMenuThen(() => setDeleteTarget({ id: v.quoteId, version: v.revision }))}
            />
          ))}
          {canPublish && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={addVersion.isPending} onClick={() => addVersion.mutate(undefined)}>
                <Plus className="h-3.5 w-3.5" /> Add version
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <VersionMenuDialogs
        orgId={orgId}
        projectId={projectId}
        projectNumber={projectNumber}
        clientId={clientId}
        projectStatus={projectStatus}
        subtotal={subtotal}
        taxAmount={taxAmount}
        total={total}
        liveRevision={liveRevision}
        liveVersion={liveVersion}
        deleteTarget={deleteTarget}
        onCloseDelete={() => setDeleteTarget(null)}
        promoteTarget={promoteTarget}
        onClosePromote={() => setPromoteTarget(null)}
        promoteResult={promoteResult}
        onDismissPromoteResult={() => setPromoteResult(null)}
        onPromoted={(result) => {
          setPromoteResult(result);
          setPromoteTarget(null);
        }}
        sendOpen={sendOpen}
        onSendOpenChange={setSendOpen}
      />
    </>
  );
}
