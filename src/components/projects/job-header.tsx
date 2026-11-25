"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOpenJobEdit } from "@/hooks/use-open-job-edit";
import { ChevronDown } from "lucide-react";

import { DetailHeader } from "@/components/ui/detail-header";
import { ActionMenu } from "@/components/ui/action-menu";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { CommentThreadPanel } from "@/components/collaboration/comment-thread-panel";
import { CallSheetDialog } from "@/components/projects/call-sheet-dialog";
import { DuplicateProjectDialog } from "@/components/projects/duplicate-project-dialog";
import { ConfirmStatusImpactDialog } from "@/components/projects/confirm-status-impact-dialog";
import { PaymentProgressStrip } from "@/components/projects/payment-progress-strip";
import { JobVersionStrip } from "@/components/projects/job-version-strip";
import { useProjectVersion, type ProjectVersionSummary } from "@/components/projects/project-version-context";
import { useVersionMenuItem } from "@/components/projects/use-version-menu-item";
import { useJobHeaderWrites } from "@/components/projects/use-job-header-writes";
import { useLabelIndex, openLabel } from "@/components/documents/label-submenu";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { useProjectPricingLock } from "@/hooks/use-project-lock";
import { useCanDo } from "@/lib/use-permissions";
import { resolveLockCopy } from "@/lib/lock-copy";
import { fireConfettiFromElement } from "@/lib/confetti";
import { jobHeaderProps, rentalDatesLabel, type JobHeaderInput, type LabelDocType } from "@/lib/job-header";
import { ALL_PROJECT_STATUSES, CELEBRATED_STATUSES, projectStatusLabel } from "@/lib/job-lifecycle";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import type { JobTabKey } from "@/lib/job-tabs";
import { cn, focusRing } from "@/lib/utils";
import { formatLabel } from "@/lib/formatters";
import { PROJECT_TYPE_LABELS } from "@/lib/project-type-labels";
import { api } from "../../../convex/_generated/api";

export interface JobHeaderProject {
  id: string;
  name: string;
  status: string;
  isTemplate: boolean;
  projectNumber: string;
  /** The job TYPE (`DRY_HIRE`, …): a live fact, shown in the meta line. */
  type?: string | null;
  client?: { id: string; name: string } | null;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
}

/** The id the page's lock "exits" scroll to (`scrollToLockStrip`, `lock-copy.ts`). */
const JOB_HEADER_ID = "job-header";

const linkClass = cn("rounded-sm text-table-cell text-muted underline-offset-2 hover:text-ink hover:underline", focusRing);

/**
 * `V` opens Versions: skipped while typing or while any dialog, sheet or menu
 * is open (DESIGN.md §4). Same rule the unmounted header pill used.
 */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isBareV(e: KeyboardEvent): boolean {
  return e.key.toLowerCase() === "v" && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (TYPING_TAGS.has(el.tagName) || el.isContentEditable);
}

const overlayOpen = () => !!document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"]');

function useVersionsShortcut(onOpen: () => void) {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isBareV(e) || isTyping(e.target) || overlayOpen()) return;
      e.preventDefault();
      onOpen();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

/** Confetti out of the current progress segment when a job REACHES Confirmed or Completed (never on load). */
function useStatusConfetti(status: string, root: React.RefObject<HTMLDivElement | null>) {
  const prev = React.useRef(status);
  React.useEffect(() => {
    if (prev.current === status) return;
    prev.current = status;
    if (!CELEBRATED_STATUSES.has(status)) return;
    requestAnimationFrame(() => {
      const seg = root.current?.querySelector<HTMLElement>('[aria-current="step"]') ?? null;
      fireConfettiFromElement(seg, { power: 16 });
    });
  }, [status, root]);
}

/** `Set status ▾`: every status, through the same gate as Advance. Present only with `project:update`. */
function SetStatusMenu({ status, onPick }: { status: string; onPick: (next: string) => void }) {
  const spec: ActionMenuSpec = {
    items: ALL_PROJECT_STATUSES.filter((s) => s !== status).map((s) => ({
      key: s,
      label: projectStatusLabel(s),
      group: "edit",
      onSelect: () => onPick(s),
    })),
  };
  return (
    <ActionMenu
      spec={spec}
      label="Set status"
      header={`Now ${projectStatusLabel(status)}`}
      trigger={
        <button type="button" className={cn(linkClass, "inline-flex items-center gap-1 [@media(pointer:coarse)]:min-h-11")}>
          Set status
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      }
    />
  );
}

function useHeaderLabels(projectId: string, enabled: boolean): JobHeaderInput["labels"] {
  const pick = (s: ReturnType<typeof useLabelIndex>) => (s.status === "ready" ? s.labels : null);
  return {
    "container-label": pick(useLabelIndex(projectId, "container-label", enabled)),
    "kit-label": pick(useLabelIndex(projectId, "kit-label", enabled)),
    "item-label": pick(useLabelIndex(projectId, "item-label", enabled)),
  };
}

/** Number · client · rental dates and days (§6b). Type moved to Edit; PMs to Overview's Who column. */
function metaParts(project: JobHeaderProject): React.ReactNode[] {
  return [
    <span key="n" className="t-mono text-ink-2">{project.projectNumber}</span>,
    ...(project.type ? [<span key="t">{PROJECT_TYPE_LABELS[project.type] ?? formatLabel(project.type)}</span>] : []),
    ...(project.client
      ? [<Link key="c" href={`/clients/${project.client.id}`} className={linkClass}>{project.client.name}</Link>]
      : []),
    <span key="d">{rentalDatesLabel(project.rentalStartDate, project.rentalEndDate) ?? "No rental dates"}</span>,
  ];
}

function CancelledNotice({ onSetStatus, canUpdate, onDelete, status }: {
  onSetStatus: (next: string) => void;
  canUpdate: boolean;
  onDelete: () => void;
  status: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-table-cell text-muted">
      <span>This job is off the pipeline. Reservations are released.</span>
      {canUpdate ? (
        <>
          <SetStatusMenu status={status} onPick={onSetStatus} />
          <button type="button" className={cn(linkClass, "tap-area text-t-out")} onClick={onDelete}>
            Delete job…
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * The job page header (UX Phase 7, spec §6b, D92) on `DetailHeader`. It owns
 * the header's dialogs, the `V` shortcut and the status gate, so the page only
 * places it. Everything the old hero offered is still reachable:
 *  - the status word, lock glyph, meta line and Advance;
 *  - Documents ▾, Edit and ⋯ (comments, warehouse, runsheet, version, duplicate,
 *    template, cancel or delete);
 *  - the progress line, with `Set status ▾` under it;
 *  - the payment strip, and the version strip.
 * See the PR's keep · move · remove table.
 */
type DupMode = "duplicate" | "template" | null;
type HeaderPricingLock = ReturnType<typeof useProjectPricingLock>;

/** The lock glyph's facts. The lock describes the LIVE version's money, so while a draft is on screen the strip speaks instead. */
function lockInput(lock: HeaderPricingLock, viewingDraft: boolean): JobHeaderInput["lock"] {
  if (lock.loading || !lock.pricingLocked || viewingDraft) return null;
  const copy = resolveLockCopy(lock);
  return { headline: copy.headline, detail: copy.detail, canUnlockPricing: lock.canUnlockPricing };
}

function useBlockingCount(orgId: string | undefined, projectId: string, isTemplate: boolean): number {
  const blocking = useAuthedQuery(
    api.collaboration.getProjectBlockingSummary,
    orgId && !isTemplate ? { orgId, projectId } : "skip",
  ) as { count: number } | undefined;
  return blocking?.count ?? 0;
}

const openTab = (path: string) => window.open(path, "_blank");

/** Controlled when the caller passes `open` + `onOpenChange`; local state otherwise. */
function useControllableOpen(open: boolean | undefined, onOpenChange: ((o: boolean) => void) | undefined) {
  const [local, setLocal] = React.useState(false);
  return [open ?? local, onOpenChange ?? setLocal] as const;
}

/** The dialogs and sheets the header opens. Each is the component the old hero used. */
function JobHeaderDialogs({ project, orgId, writes, state }: {
  project: JobHeaderProject;
  orgId: string | undefined;
  writes: ReturnType<typeof useJobHeaderWrites>;
  state: {
    dupMode: DupMode; setDupMode: (m: DupMode) => void;
    callSheetOpen: boolean; setCallSheetOpen: (o: boolean) => void;
    commentsOpen: boolean; setCommentsOpen: (o: boolean) => void;
    deleteOpen: boolean; setDeleteOpen: (o: boolean) => void;
  };
}) {
  const { id, isTemplate } = project;
  return (
    <>
      <ConfirmStatusImpactDialog
        open={!!writes.confirmGate.pending}
        impact={writes.confirmGate.pending?.impact ?? null}
        pending={writes.statusPending}
        onConfirm={writes.confirmGate.confirmPending}
        onCancel={writes.confirmGate.cancelPending}
      />
      {orgId && !isTemplate ? (
        <CommentThreadPanel orgId={orgId} entityType="project" entityId={id} open={state.commentsOpen} onOpenChange={state.setCommentsOpen} noTrigger />
      ) : null}
      {state.dupMode ? (
        <DuplicateProjectDialog
          open
          onOpenChange={(o) => !o && state.setDupMode(null)}
          sourceProject={{ id, projectNumber: project.projectNumber, name: project.name }}
          mode={state.dupMode}
        />
      ) : null}
      <CallSheetDialog projectId={id} open={state.callSheetOpen} onOpenChange={state.setCallSheetOpen} />
      <DeleteDialog
        open={state.deleteOpen}
        onOpenChange={state.setDeleteOpen}
        title="Delete job?"
        description="This permanently removes the job and its line items, crew assignments, and documents. This cannot be undone."
        confirmLabel="Delete job"
        onConfirm={() => {
          writes.remove();
          state.setDeleteOpen(false);
        }}
        pending={writes.deletePending}
      />
    </>
  );
}

export function JobHeader({
  project,
  orgId,
  onOpenTab,
  onOpenVersions,
  onMakeLive,
  commentsOpen: commentsOpenProp,
  onCommentsOpenChange,
}: {
  project: JobHeaderProject;
  orgId: string | undefined;
  onOpenTab: (tab: JobTabKey) => void;
  onOpenVersions: () => void;
  onMakeLive: (target: ProjectVersionSummary) => void;
  /** Controlled comments panel, so the Overview's discussion links open the SAME one. */
  commentsOpen?: boolean;
  onCommentsOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const { id, isTemplate, status } = project;
  const can = { update: useCanDo("project", "update"), create: useCanDo("project", "create") };

  const [dupMode, setDupMode] = React.useState<DupMode>(null);
  const [callSheetOpen, setCallSheetOpen] = React.useState(false);
  const [commentsOpen, setCommentsOpen] = useControllableOpen(commentsOpenProp, onCommentsOpenChange);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [docsOpened, setDocsOpened] = React.useState(false);
  // Frozen at mount: it only feeds the payment strip's derived EXPIRED read (never query args that tick).
  const now = useStableNow();

  const pricingLock = useProjectPricingLock(id, orgId);
  const { isViewingVersion } = useProjectVersion();
  const blockingCount = useBlockingCount(orgId, id, isTemplate);

  const writes = useJobHeaderWrites({ projectId: id, orgId, blockingCount, pricingLock, openComments: () => setCommentsOpen(true) });
  const versionItem = useVersionMenuItem(onOpenVersions);
  const labels = useHeaderLabels(id, docsOpened);
  useVersionsShortcut(onOpenVersions);
  useStatusConfetti(status, rootRef);
  const requestStatus = (next: string) => writes.requestStatus(status, next);
  const openEdit = useOpenJobEdit();

  const props = jobHeaderProps({
    name: project.name,
    status,
    isTemplate,
    can,
    lock: lockInput(pricingLock, isViewingVersion),
    blockingCount,
    advancing: writes.advancing,
    versionItem: isTemplate ? null : versionItem,
    labels,
    on: {
      advance: requestStatus,
      useTemplate: () => setDupMode("duplicate"),
      edit: openEdit,
      openDocument: (type) => openTab(`/api/documents/${id}?type=${type}`),
      openLabel: (type: LabelDocType, labelId?: string) => openLabel(id, type, labelId),
      openCallSheet: () => setCallSheetOpen(true),
      openTimeline: () => openTab(`/api/documents/timeline/${id}`),
      openFinance: () => onOpenTab("finance"),
      openComments: () => setCommentsOpen(true),
      openWarehouse: () => router.push(`/warehouse/${id}`),
      openRunsheet: () => router.push(`/projects/${id}/runsheet`),
      duplicate: () => setDupMode("duplicate"),
      saveAsTemplate: () => setDupMode("template"),
      cancel: writes.cancel,
      remove: writes.remove,
      unlock: writes.unlock,
    },
  });

  const setStatus = can.update ? <SetStatusMenu status={status} onPick={requestStatus} /> : null;
  const progress = props.progress ? { ...props.progress, action: setStatus } : undefined;
  const live = !isTemplate;

  return (
    <div ref={rootRef} id={JOB_HEADER_ID} className="flex flex-col gap-3">
      <DetailHeader
        {...props}
        meta={metaParts(project)}
        progress={progress}
        onDocumentsOpenChange={(o) => o && setDocsOpened(true)}
        strip={isViewingVersion && live ? <JobVersionStrip onMakeLive={onMakeLive} /> : undefined}
      />
      {status === "CANCELLED" && live ? (
        <CancelledNotice status={status} canUpdate={can.update} onSetStatus={requestStatus} onDelete={() => setDeleteOpen(true)} />
      ) : null}
      {live ? <PaymentProgressStrip projectId={id} orgId={orgId} status={status} now={now} /> : null}
      <JobHeaderDialogs
        project={project}
        orgId={orgId}
        writes={writes}
        state={{ dupMode, setDupMode, callSheetOpen, setCallSheetOpen, commentsOpen, setCommentsOpen, deleteOpen, setDeleteOpen }}
      />
    </div>
  );
}
