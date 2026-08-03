"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { use, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectDetail, refreshProjectDetail } from "@/hooks/use-project-detail";
import { useMiraPageContext } from "@/hooks/use-mira-page-context";
import { useProjectServicesSummary } from "@/hooks/use-project-services";
import { useProjectLabourCost } from "@/hooks/use-project-crew";
import {
  Pencil,
  Archive,
  Trash2,
  FileText,
  ChevronDown,
  Copy,
  BookTemplate,
  MoreHorizontal,
  Warehouse,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { EquipmentTab } from "@/components/projects/equipment-tab";
import { CallSheetDialog } from "@/components/projects/call-sheet-dialog";
import { ServicesPanel } from "@/components/projects/services-panel";
import { TasksPanel } from "@/components/projects/tasks-panel";
import { FinancialSummary } from "@/components/projects/financial-summary";
import { ProjectFinancePanel } from "@/components/projects/project-finance-panel";
import { ProjectLockStrip } from "@/components/projects/project-lock-strip";
import { ProjectLockChip } from "@/components/projects/project-lock-chip";
import { BillingSummaryRow } from "@/components/projects/billing-summary-row";
import { StalePricingBanner } from "@/components/projects/stale-pricing-banner";
import { ProjectCostsPanel } from "@/components/projects/project-costs-panel";
import { ProjectReadinessPanel, type ProjectTab } from "@/components/projects/project-readiness-panel";
import {
  ProjectContextRail,
  type ProjectContextRailProject,
} from "@/components/projects/project-context-rail";
import {
  OverviewScheduleCard,
  OverviewLocationCard,
  OverviewTeamCard,
  OverviewActivityCard,
} from "@/components/projects/overview/context-cards";
import type { ProjectContextProject } from "@/lib/project-context";
import { DetailLayout, DetailMain, DetailSidebar } from "@/components/layout/page-layouts";
import { QuoteCard } from "@/components/projects/overview/quote-card";
import { InvoicingCard } from "@/components/projects/overview/invoicing-card";
import { OpenIssuesBadge } from "@/components/projects/open-issues-badge";
import { ProjectCommentsButton } from "@/components/collaboration/project-comments-button";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import { DuplicateProjectDialog } from "@/components/projects/duplicate-project-dialog";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { PersonAvatar } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { cn, focusRing } from "@/lib/utils";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { NotesEditor } from "@/components/ui/notes-editor";
import { useOptimisticProjectNotes, useNativeProjectStatus, useProjectWrites } from "@/hooks/use-native-project-writes";
import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";
import { ConfirmStatusImpactDialog } from "@/components/projects/confirm-status-impact-dialog";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { ProjectLifecycle } from "@/components/projects/project-lifecycle";
import { useCanDo } from "@/lib/use-permissions";
import { formatCurrency } from "@/lib/formatters";
import { useProjectLockStatus, useUnlockSession } from "@/hooks/use-project-lock";
import { UnlockSessionDialog } from "@/components/projects/unlock-session-dialog";
import { useJustifiedMutation } from "@/hooks/use-justified-mutation";
import { JustificationDialog } from "@/components/projects/justification-dialog";
import { ProjectVersionProvider, useProjectVersion } from "@/components/projects/project-version-context";
import { ProjectVersionSwitcher } from "@/components/projects/version-switcher";
import { VersionReadOnlyBar } from "@/components/projects/version-readonly-bar";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import { VersionProjectedEquipment } from "@/components/projects/version-projected-equipment";
import { VersionProjectedLabour } from "@/components/projects/version-projected-labour";
import { VersionProjectedFinance } from "@/components/projects/version-projected-finance";

const projectStatusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

const typeLabels: Record<string, string> = {
  DRY_HIRE: "Dry hire",
  WET_HIRE: "Wet hire",
  INSTALLATION: "Installation",
  TOUR: "Tour",
  CORPORATE: "Corporate",
  THEATRE: "Theatre",
  FESTIVAL: "Festival",
  CONFERENCE: "Conference",
  OTHER: "Other",
};

const allStatuses = [
  "ENQUIRY",
  "QUOTING",
  "QUOTED",
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
  "CANCELLED",
];

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  // Phase 8 (#1004): tells Mira what the user is looking at, so a question
  // asked here is routed to THIS project without having to name it.
  useMiraPageContext({ entityType: "project", entityId: id });

  // #992 (Phase F) — org Finance section rows deep-link here via `?tab=finance`.
  // #1061 made `Tabs` CONTROLLED: the Overview tab's readiness checklist sends
  // you to the tab that fixes a failing check ("Open crew" → labour), which
  // needs a setter the uncontrolled form doesn't give.
  const VALID_TABS = ["overview", "equipment", "labour", "finance", "tasks", "notes", "files"] as const;
  const requestedTab = searchParams.get("tab");
  // Overview is always the landing tab (#1061) — the project's home. A `?tab=`
  // deep link still wins, so the org Finance section's rows land where they meant to.
  const initialTab = (VALID_TABS as readonly string[]).includes(requestedTab ?? "") ? requestedTab! : "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

  const [dupMode, setDupMode] = useState<"duplicate" | "template" | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Slot on the tab row that the Equipment tab portals its "Add ▾" menu into,
  // so the primary action sits inline with the tab selector. State-backed (not a
  // plain ref) so EquipmentTab re-renders its portal once the node mounts.
  const [equipmentAddSlot, setEquipmentAddSlot] = useState<HTMLDivElement | null>(null);

  // #957 lifecycle lock — reactive tier/session status and the unlock-session
  // open action. `lockNow` is frozen at mount (like `project-quote-rail.tsx`'s
  // own `now`) — it only drives derived display (elapsed-session timers,
  // EXPIRED resolution), not query identity.
  const [lockNow] = useState(() => Date.now());
  const lockStatus = useProjectLockStatus(id, orgId, lockNow);
  const unlockSession = useUnlockSession(id, orgId);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockPending, setUnlockPending] = useState(false);

  const { data: project, isLoading } = useProjectDetail(id);
  const media = useMediaWrites("project");

  // Phase 3 browser-direct: optimistic project-notes save (always native — the notes
  // are safe to optimistic; a wrong save just re-renders, nothing irreversible happens).
  const optimisticNotes = useOptimisticProjectNotes(id, orgId);
  const saveProjectNotes = (
    field: "crewNotes" | "internalNotes" | "clientNotes",
    notes: string,
  ) => optimisticNotes.save(field, notes);

  // Phase 3 browser-direct: status write (always native). The detail view is reactive,
  // so it re-renders on its own once the native mutation commits.
  const statusBrowser = useNativeProjectStatus(orgId);
  const projectWrites = useProjectWrites(orgId);

  // #792: a status change can require a justification (reverting out of
  // HARD_LOCKED, or confirming with no accepted quote) — `useJustifiedMutation`
  // catches the server's `JUSTIFICATION_REQUIRED` and prompts via
  // `JustificationDialog` instead of dead-ending on a toast. `lockStatus.tier` is
  // never `"JUSTIFY"` for either gated transition here, so this always takes the
  // reactive (try once, prompt on rejection) path — an OPEN FULL unlock session
  // still short-circuits the server-side check entirely, so nothing prompts at
  // all in that case (same "unlocked in one place = unlocked" behaviour every
  // other locked write already has via `assertLifecycleGuard`).
  const justifiedStatusChange = useJustifiedMutation(
    (args: { status: string; justification?: string }) =>
      statusBrowser.updateStatus(id, args.status, args.justification),
    lockStatus,
  );

  const statusMutation = useServerMutation({
    mutationFn: async (nextStatus: string) => {
      await justifiedStatusChange.run({ status: nextStatus });
    },
    onSuccess: () => {
      toast.success("Status updated");
      refreshProjectDetail(id);
      // A status transition into CANCELLED/RETURNED/COMPLETED/INVOICED releases
      // stock; overbook/availability now reads reactively from Convex (no store to bust).
    },
    onError: (e) => toast.error(e.message),
  });

  // Confirm-time gate (WS3 #942, non-blocking): previews "would confirming
  // this now create a hard overbooking / leave crew unconfirmed" before a
  // transition INTO CONFIRMED, and only then. Every other status change
  // proceeds exactly as before (requestStatusChange calls onProceed
  // synchronously-equivalent when there's nothing to warn about).
  const confirmGate = useConfirmStatusGate(orgId, id, project?.status, (next) => statusMutation.mutate(next));

  const archiveMutation = useServerMutation({
    mutationFn: () => projectWrites.archive(id),
    onSuccess: () => {
      toast.success("Project cancelled");
      refreshProjectDetail(id);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => projectWrites.remove(id),
    onSuccess: (result) => {
      const freedBits: string[] = [];
      if (result.freedAssets > 0) {
        freedBits.push(`${result.freedAssets} asset${result.freedAssets === 1 ? "" : "s"}`);
      }
      if (result.freedKits > 0) {
        freedBits.push(`${result.freedKits} kit${result.freedKits === 1 ? "" : "s"}`);
      }
      toast.success(
        freedBits.length > 0 ? `Project deleted — freed ${freedBits.join(" and ")}` : "Project deleted",
      );
      router.push("/projects");
    },
    onError: (e) => toast.error(e.message),
  });

  const canUpdate = useCanDo("project", "update");

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!project) {
    return (
      <RequirePermission resource="project" action="read">
        <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Project not found.</p>
          <p className="mt-1 text-caption text-muted">
            It may have been deleted, or you don&apos;t have access to it.
          </p>
          <Button variant="line" size="sm" className="mt-4" asChild>
            <Link href="/projects">Back to projects</Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  const rentalStart = project.rentalStartDate
    ? new Date(project.rentalStartDate as unknown as string)
    : null;
  const rentalEnd = project.rentalEndDate
    ? new Date(project.rentalEndDate as unknown as string)
    : null;

  return (
    <RequirePermission resource="project" action="read">
      <PageMeta title={`${project.projectNumber} ${project.name}`} />
      <FadeIn>
        <ProjectVersionProvider projectId={id} orgId={orgId} now={lockNow}>
        <div className="space-y-6">
          {/* ── Hero card (breadcrumb + identity/actions + lifecycle) ─ */}
          <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] space-y-4 sm:p-5">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-caption text-muted">
              <Link href="/projects" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
                Projects
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="t-mono text-ink-2">{project.projectNumber}</span>
            </nav>

            {/* Identity + actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-page-title font-extrabold text-ink truncate">
                    {project.name}
                  </h1>
                  {project.isTemplate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-2.5 py-1 text-badge font-bold text-blue">
                      <BookTemplate className="h-3 w-3" />
                      Template
                    </span>
                  )}
                  {/* Templates keep the status pill here (non-templates use the lifecycle ⋯) */}
                  {project.isTemplate && (
                    <StatusIndicator
                      category="project"
                      value={project.status}
                      label={projectStatusLabels[project.status] || formatLabel(project.status)}
                    />
                  )}
                  {!project.isTemplate && <OpenIssuesBadge orgId={orgId} projectId={id} />}
                  {/* #990 (Phase E) surface 1 — always-mounted header chip, the
                      same `lockStatus` subscription the strip below renders from. */}
                  {!project.isTemplate && <ProjectLockChip status={lockStatus} now={lockNow} />}
                  {/* Phase 3 (#1080/#1093) — project-wide, so it lives here
                      rather than inside any one tab. Extended (CLAUDE.md
                      "fine-tune versioning") into the header's full version
                      menu — add/delete/promote/send/download, not just switch. */}
                  {!project.isTemplate && orgId && (
                    <ProjectVersionSwitcher
                      orgId={orgId}
                      projectNumber={project.projectNumber}
                      clientId={project.clientId as string | null | undefined}
                      projectStatus={project.status as string | null | undefined}
                      subtotal={project.subtotal as number | null}
                      taxAmount={project.taxAmount as number | null}
                      total={project.total as number | null}
                    />
                  )}
                </div>
                {/* Meta line */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  <span className="t-mono text-ink-2">{project.projectNumber}</span>
                  <span aria-hidden>&middot;</span>
                  <span>{typeLabels[project.type] || formatLabel(project.type)}</span>
                  {project.client && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <Link
                        href={`/clients/${project.client.id}`}
                        className={cn("hover:text-ink-2 hover:underline rounded-sm", focusRing)}
                      >
                        {project.client.name}
                      </Link>
                    </>
                  )}
                  {/* PM avatars */}
                  {project.projectManagers && (project.projectManagers as { user: { id: string; name: string | null; email: string; image: string | null } }[]).length > 0 && (
                    <div className="flex -space-x-1.5">
                      {(project.projectManagers as { user: { id: string; name: string | null; email: string; image: string | null } }[]).map((pm) => (
                        <PersonAvatar
                          key={pm.user.id}
                          name={pm.user.name ?? pm.user.email}
                          src={pm.user.image ?? undefined}
                          className="size-6 ring-2 ring-card"
                          title={pm.user.name ?? pm.user.email}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons (compact) */}
              <div className="flex flex-wrap items-center gap-2">
                {orgId && !project.isTemplate && (
                  <ProjectCommentsButton orgId={orgId} projectId={id} />
                )}
                {!project.isTemplate && (
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/warehouse/${id}`}>
                      <Warehouse className="h-4 w-4" />
                      <span className="hidden sm:inline">Warehouse</span>
                    </Link>
                  </Button>
                )}
                {!project.isTemplate && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="line" size="sm">
                        <FileText className="h-4 w-4" />
                        <span className="hidden sm:inline">Documents</span>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Warehouse artifacts only. Quote and Invoice are
                          deliberately absent (#987): a client-facing finance
                          document comes from the Finance panel as the STORED
                          revision, never a fresh render of live state — two
                          clicks a week apart used to produce two different
                          documents under the same name. */}
                      {([
                        { label: "Pull slip", apiType: "pull-slip" },
                        { label: "Delivery docket", apiType: "delivery-docket" },
                        { label: "Return sheet", apiType: "return-sheet" },
                      ] as const).map(({ label, apiType }) => (
                        <DropdownMenuItem
                          key={apiType}
                          onClick={() => window.open(`/api/documents/${id}?type=${apiType}`, "_blank")}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem onClick={() => setCallSheetOpen(true)}>
                        Call sheet
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => window.open(`/api/documents/timeline/${id}`, "_blank")}
                      >
                        Project timeline
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <CanDo resource="project" action="update">
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/projects/${id}/edit`}>
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                </CanDo>
                {project.isTemplate ? (
                  <CanDo resource="project" action="create">
                    <Button variant="line" size="sm" onClick={() => setDupMode("duplicate")}>
                      <Copy className="h-4 w-4" />
                      Use template
                    </Button>
                  </CanDo>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="line" size="sm" aria-label="More actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${id}/runsheet`}>
                          <ClipboardList className="mr-2 h-4 w-4" />
                          Runsheet
                        </Link>
                      </DropdownMenuItem>
                      <CanDo resource="project" action="create">
                        <DropdownMenuItem onClick={() => setDupMode("duplicate")}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate project
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDupMode("template")}>
                          <BookTemplate className="mr-2 h-4 w-4" />
                          Save as template
                        </DropdownMenuItem>
                      </CanDo>
                      <CanDo resource="project" action="update">
                        <DropdownMenuSeparator />
                        {project.status === "CANCELLED" ? (
                          <DropdownMenuItem
                            onClick={() => setDeleteOpen(true)}
                            disabled={deleteMutation.isPending}
                            className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete project
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => setCancelOpen(true)}
                            disabled={archiveMutation.isPending}
                            className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Cancel project
                          </DropdownMenuItem>
                        )}
                      </CanDo>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Lifecycle stepper + controls */}
            {!project.isTemplate && (
              <ProjectLifecycle
                status={project.status}
                advancing={statusMutation.isPending || confirmGate.checking}
                canAdvance={canUpdate}
                onAdvance={(next) => confirmGate.requestStatusChange(next)}
                statuses={allStatuses.map((s) => ({
                  value: s,
                  label: projectStatusLabels[s] || formatLabel(s),
                }))}
                onStatusChange={(s) => confirmGate.requestStatusChange(s)}
              />
            )}
          </div>

          <ConfirmStatusImpactDialog
            open={!!confirmGate.pending}
            impact={confirmGate.pending?.impact ?? null}
            pending={statusMutation.isPending}
            onConfirm={confirmGate.confirmPending}
            onCancel={confirmGate.cancelPending}
          />

          {/* #1061 — the summary strip moved into the Overview tab, where the
              rest of the project's at-a-glance state now lives. Keeping it
              above the tabs made every tab pay for context only the home tab
              actually needs.

              #1061 — the conflicts banner that used to sit here is now a row in
              the Overview tab's Readiness checklist, alongside the gear, crew
              and pricing checks. One place to look, and a clean project reads
              as verified rather than as a banner that failed to appear. */}

          {/* #990 (Phase E) surface 2 — the shared lock strip, mounted ONCE at
              the top of the project detail (not inside a tab). Replaces the
              Finance-tab-only `QuoteLockStrip` (Phase D) + the inline
              locked-banner block that used to live only in the Finance tab. */}
          {!project.isTemplate && orgId && (
            <ProjectLockStrip
              projectId={id}
              orgId={orgId}
              status={lockStatus}
              now={lockNow}
              onOpenUnlock={() => setUnlockDialogOpen(true)}
            />
          )}

          {/* Phase 3 (#1080/#1093) — mounted once above the tabs, visible on
              every tab, whenever `?v=` points at a real non-live version. */}
          {!project.isTemplate && orgId && <VersionReadOnlyBar orgId={orgId} />}

          {/* ── Tabs + context sidebar ─────────────────────────────────
              #1063: the sidebar (Schedule · Location · Team · Activity) rides
              along on every tab EXCEPT Overview. On Overview that same content
              is the point of the page, so it's composed into the tab's own
              cards instead of arriving as a rail bolted to the side — see
              `overview/context-cards.tsx`. Rendering both would show the same
              facts twice on the one tab.

              `DetailMain` is `flex-1`, so omitting the sidebar gives Overview
              the full width for free — no separate layout branch needed. */}
          <DetailLayout>
            <DetailMain>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                {/* Tab selector + the active tab's primary action share one row.
                    The Equipment tab portals its "Add ▾" menu into the right-hand
                    slot (mirrors how the services panel places its action inline
                    with the tabs). The slot stays empty for other tabs. */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="equipment">Equipment</TabsTrigger>
                    <TabsTrigger value="labour">Labour &amp; logistics</TabsTrigger>
                    {!project.isTemplate && (
                      <TabsTrigger value="finance">Finance</TabsTrigger>
                    )}
                    <TabsTrigger value="tasks">Tasks</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                    <TabsTrigger value="files">Files ({(project.media || []).length})</TabsTrigger>
                  </TabsList>
                  <div ref={setEquipmentAddSlot} className="flex items-center gap-2" />
                </div>

                {/* ── Overview Tab (#1061, recomposed in #1063) ───────────
                    The project's home: read the state, then pick a tab to work
                    in. One column, ordered by what it asks of you — readiness
                    leads because it's the only section that can tell you to
                    stop; then the live quote and invoicing; then money; then
                    the standing context (schedule, location, team, activity)
                    as peer cards rather than a sidebar. */}
                <TabsContent value="overview">
                  <div className="pt-4">
                    <div className="flex min-w-0 flex-col gap-4">
                      {!project.isTemplate && orgId && (
                        <ProjectReadinessPanel
                          projectId={id}
                          orgId={orgId}
                          onNavigateTab={(tab: ProjectTab) => setActiveTab(tab)}
                        />
                      )}
                      {/* The live quote and the invoicing position, as peers.
                          Each carries only the ONE action you'd most likely
                          take next; the full revision rail and invoice list
                          stay in the Finance tab (#1061). */}
                      {!project.isTemplate && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <QuoteCard
                            projectId={id}
                            orgId={orgId}
                            projectNumber={project.projectNumber}
                            clientId={project.clientId as string | null | undefined}
                            projectStatus={project.status as string | null | undefined}
                            subtotal={project.subtotal as number | null}
                            taxAmount={project.taxAmount as number | null}
                            total={project.total as number | null}
                            onOpenLedger={() => setActiveTab("finance")}
                          />
                          <InvoicingCard
                            projectId={id}
                            orgId={orgId}
                            clientId={project.clientId as string | null | undefined}
                            total={project.total as number | null}
                            onOpenLedger={() => setActiveTab("finance")}
                          />
                        </div>
                      )}
                      {!project.isTemplate && (
                        <ProjectSummaryStrip
                          projectId={id}
                          equipmentRevenue={project.equipmentRevenue as number | null}
                          total={project.total as number | null}
                        />
                      )}

                      {/* Standing context, as peer cards — the same facts the
                          sidebar shows on every other tab, shaped once in
                          `@/lib/project-context` so the two can't disagree. */}
                      <div className="grid gap-4 md:grid-cols-2">
                        {!project.isTemplate && (
                          <OverviewScheduleCard project={project as ProjectContextProject} />
                        )}
                        <OverviewLocationCard project={project as ProjectContextProject} />
                        <OverviewTeamCard projectId={id} project={project as ProjectContextProject} />
                        {orgId && !project.isTemplate && (
                          <OverviewActivityCard projectId={id} orgId={orgId} />
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Equipment Tab — new category/group hierarchy */}
                <TabsContent value="equipment">
                  <div className="pt-4">
                    <EquipmentTabSlot projectId={id} rentalStartDate={rentalStart} rentalEndDate={rentalEnd} addMenuSlot={equipmentAddSlot} />
                  </div>
                </TabsContent>

                {/* Labour & Logistics Tab — services (incl. per-service crew rate
                    tables) is the sole crew UI; ServicesPanel renders the project
                    crew list itself (see FEATUREDOCS/31, issue #796). */}
                <TabsContent value="labour">
                  <div className="space-y-6 pt-4">
                    <LabourTabSlot
                      projectId={id}
                      projectAddress={project.location?.address || ""}
                      projectLatitude={project.location?.latitude ?? null}
                      projectLongitude={project.location?.longitude ?? null}
                      // WS2 (#941): fed from the PROJECT window (falling back to the
                      // deprecated loadIn/loadOut fields for a project the backfill
                      // hasn't reached yet) — ServicesPanel's own loadIn/eventStart
                      // fallback-of-a-fallback logic is unchanged, so both props
                      // carrying the same window value is harmless.
                      projectLoadInDate={
                        (project.projectStartDate ?? project.loadInDate)
                          ? new Date((project.projectStartDate ?? project.loadInDate) as unknown as string).toISOString().slice(0, 10)
                          : ""
                      }
                      projectLoadOutDate={
                        (project.projectEndDate ?? project.loadOutDate)
                          ? new Date((project.projectEndDate ?? project.loadOutDate) as unknown as string).toISOString().slice(0, 10)
                          : ""
                      }
                      projectEventStartDate={
                        (project.projectStartDate ?? project.loadInDate)
                          ? new Date((project.projectStartDate ?? project.loadInDate) as unknown as string).toISOString().slice(0, 10)
                          : ""
                      }
                      projectEventEndDate={
                        (project.projectEndDate ?? project.loadOutDate)
                          ? new Date((project.projectEndDate ?? project.loadOutDate) as unknown as string).toISOString().slice(0, 10)
                          : ""
                      }
                    />
                  </div>
                </TabsContent>

                {/* Finance Tab (#989) — top-level tab: quote revisions + send
                    dialog, invoices + issue dialog, financial summary +
                    operational P&L. Retired the standalone "Financials" tab —
                    this is that content, not a duplicate of it. The lock
                    strip/banner used to live here (Phase D's `QuoteLockStrip`)
                    but is now the page-level `<ProjectLockStrip>` (#990) above
                    the tabs — visible from every tab, not just this one.

                    Section order is deliberate (#1038 IA pass): the alert
                    banner, then Quotes & Invoices — the tab's actual workflow,
                    what a PM opens this tab to DO — leads. Financial summary
                    and operational P&L are read-only reference figures a PM
                    checks less often; they follow behind a divider rather than
                    burying the actionable content below them. */}
                {!project.isTemplate && (
                  <TabsContent value="finance">
                    <div className="space-y-6 pt-4">
                      <FinanceTabSlot
                        projectId={project.id}
                        orgId={orgId}
                        projectNumber={project.projectNumber}
                        clientId={project.clientId as string | null | undefined}
                        projectStatus={project.status as string | null | undefined}
                        subtotal={project.subtotal as number | null}
                        taxAmount={project.taxAmount as number | null}
                        total={project.total as number | null}
                        rentalStartDate={rentalStart}
                        rentalEndDate={rentalEnd}
                        billingWeeksOverride={project.billingWeeksOverride as number | null}
                        billingDaysOverride={project.billingDaysOverride as number | null}
                        categories={project.categories as { groups: { title: string; quantity: number; price: unknown }[] }[] | undefined}
                        equipmentRevenue={project.equipmentRevenue as number | null}
                        saleRevenue={project.saleRevenue as number | null}
                        saleCostTotal={project.saleCostTotal as number | null}
                        serviceCostTotal={project.serviceCostTotal as number | null}
                        labourCostTotal={project.labourCostTotal as number | null}
                        subHireCostTotal={project.subHireCostTotal as number | null}
                        discountPercent={project.discountPercent as number | null}
                        discountAmount={project.discountAmount as number | null}
                        taxRate={project.taxRate as number | null}
                        margin={project.margin as number | null}
                        depositPaid={project.depositPaid as number | null}
                        invoicedTotal={project.invoicedTotal as number | null}
                      />
                    </div>
                  </TabsContent>
                )}

                {/* Tasks Tab — projectTasks isn't in the snapshot; stays live. */}
                <TabsContent value="tasks">
                  <div className="pt-4">
                    <VersionNotTrackedNote what="Tasks" />
                    <TasksPanel projectId={id} />
                  </div>
                </TabsContent>

                {/* Notes Tab — crewNotes/internalNotes/clientNotes ARE captured
                    (the whole project row is snapshotted), so a viewed version
                    shows its own captured text, read-only. */}
                <TabsContent value="notes">
                  <NotesTabSlot
                    liveCrewNotes={project.crewNotes || ""}
                    liveInternalNotes={project.internalNotes || ""}
                    liveClientNotes={project.clientNotes || ""}
                    onChanged={() => refreshProjectDetail(id)}
                    onSave={saveProjectNotes}
                  />
                </TabsContent>

                {/* Files Tab — projectMedia isn't in the snapshot; stays live. */}
                <TabsContent value="files">
                  <div className="pt-4">
                    <VersionNotTrackedNote what="Files" />
                    <MediaUploader
                      entityType="project"
                      entityId={id}
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.txt"
                      existingMedia={(project.media || []) as MediaItem[]}
                      onChanged={() =>
                        refreshProjectDetail(id)
                      }
                      onUploadComplete={async (fileUpload) => {
                        await media.add({ parentId: id, fileId: fileUpload.id, type: "OTHER" });
                      }}
                      onRemove={async (mediaId) => {
                        await media.remove(mediaId);
                      }}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* Every tab but Overview, which composes this content itself. */}
            {activeTab !== "overview" && (
              <DetailSidebar>
                <ProjectContextRail
                  projectId={id}
                  orgId={orgId}
                  project={project as ProjectContextRailProject}
                />
              </DetailSidebar>
            )}
          </DetailLayout>
        </div>
        </ProjectVersionProvider>
      </FadeIn>

      {dupMode && (
        <DuplicateProjectDialog
          open={!!dupMode}
          onOpenChange={(open) => !open && setDupMode(null)}
          sourceProject={{
            id: project.id,
            projectNumber: project.projectNumber,
            name: project.name,
          }}
          mode={dupMode}
        />
      )}
      <CallSheetDialog
        projectId={id}
        open={callSheetOpen}
        onOpenChange={setCallSheetOpen}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete project?"
        description="This permanently removes the project and its line items, crew assignments, and documents. This cannot be undone."
        confirmLabel="Delete project"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
      <DeleteDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this project?"
        description="The project will be marked cancelled. Reservations release and items return to inventory. You can permanently delete a cancelled project later."
        confirmLabel="Cancel project"
        cancelLabel="Keep project"
        onConfirm={() => {
          archiveMutation.mutate();
          setCancelOpen(false);
        }}
        pending={archiveMutation.isPending}
      />
      <JustificationDialog {...justifiedStatusChange.dialogProps} status={project.status ?? undefined} />
      {orgId && (
        <>
          <UnlockSessionDialog
            open={unlockDialogOpen}
            onOpenChange={setUnlockDialogOpen}
            scope={lockStatus.tier === "HARD_LOCKED" ? "FULL" : "FINANCIAL"}
            pending={unlockPending}
            onConfirm={async (justification) => {
              setUnlockPending(true);
              try {
                await unlockSession.open(lockStatus.tier === "HARD_LOCKED" ? "FULL" : "FINANCIAL", justification);
                setUnlockDialogOpen(false);
                toast.success("Unlocked");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to unlock");
              } finally {
                setUnlockPending(false);
              }
            }}
          />
        </>
      )}
    </RequirePermission>
  );
}

function ProjectSummaryStrip({
  projectId,
  equipmentRevenue,
  total,
}: {
  projectId: string;
  equipmentRevenue: number | null;
  total: number | null;
}) {
  const { data: summaryOrg } = useActiveOrganization();
  const { data: labourData } = useProjectLabourCost(projectId, summaryOrg?.id);

  const { data: serviceData } = useProjectServicesSummary(projectId);

  // A faint em-dash for an empty/placeholder metric — calm, not loud.
  const emptyValue = <span className="text-faint">{"\u2014"}</span>;

  const metrics: {
    label: string;
    value: React.ReactNode;
    bold?: boolean;
  }[] = [
    {
      label: "Equipment",
      value: equipmentRevenue != null ? formatCurrency(equipmentRevenue) : emptyValue,
    },
    {
      // Lead with the charge; the cost rides along as a quiet muted sub-part.
      label: "Services",
      value: serviceData ? (
        <span>
          {formatCurrency(serviceData.chargeTotal)}
          <span className="font-normal text-muted"> · {formatCurrency(serviceData.costTotal)} cost</span>
        </span>
      ) : (
        emptyValue
      ),
    },
    {
      label: "Crew",
      value: labourData ? (
        <span>
          {formatCurrency(Number(labourData.totalLabourCost))}
          <span className="font-normal text-muted"> · {labourData.assignmentCount}</span>
        </span>
      ) : (
        emptyValue
      ),
    },
    {
      label: "Total",
      value: total != null ? formatCurrency(total) : emptyValue,
      bold: true,
    },
  ];

  // Inline metrics strip (single surface, vertical dividers) per DESIGN dashboard rule.
  return (
    <div className="grid grid-cols-2 gap-px rounded-[var(--r)] border border-line bg-line shadow-[var(--sh-card)] sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-line sm:bg-card">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="bg-card px-4 py-3 sm:first:rounded-l-[var(--r)] sm:last:rounded-r-[var(--r)]"
        >
          <div className="t-overline text-muted">
            {m.label}
          </div>
          <div
            className={
              m.bold
                ? "text-card-title font-bold tabular-nums tracking-tight text-ink"
                : "text-ui-text font-semibold tabular-nums text-ink-2"
            }
          >
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Phase 3 (#1080/#1093) tab slots — one per versioned tab. Each reads
 * `useProjectVersion()` (rendered inside `ProjectVersionProvider`, mounted
 * around the whole page body) and swaps the live component for the read-only
 * projection while a non-live version is being viewed. Kept as thin
 * switches, not full rewrites of the live tabs — see FEATUREDOCS/70 for why
 * the live components themselves aren't threaded with a version prop.
 */

function EquipmentTabSlot(props: React.ComponentProps<typeof EquipmentTab>) {
  const { isViewingVersion, hasCapturedState } = useProjectVersion();
  if (isViewingVersion) return hasCapturedState ? <VersionProjectedEquipment /> : null;
  return <EquipmentTab {...props} />;
}

function LabourTabSlot(props: React.ComponentProps<typeof ServicesPanel>) {
  const { isViewingVersion, hasCapturedState } = useProjectVersion();
  if (isViewingVersion) return hasCapturedState ? <VersionProjectedLabour /> : null;
  return <ServicesPanel {...props} />;
}

interface FinanceTabSlotProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId: string | null | undefined;
  projectStatus: string | null | undefined;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
  billingWeeksOverride: number | null;
  billingDaysOverride: number | null;
  categories: { groups: { title: string; quantity: number; price: unknown }[] }[] | undefined;
  equipmentRevenue: number | null;
  saleRevenue: number | null;
  saleCostTotal: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subHireCostTotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  margin: number | null;
  depositPaid: number | null;
  invoicedTotal: number | null;
}

function FinanceTabSlot(props: FinanceTabSlotProps) {
  const { isViewingVersion } = useProjectVersion();
  const allGroups = props.categories?.flatMap((c) => c.groups) ?? [];
  const totalGroupCount = allGroups.length;
  const pricedGroupCount = allGroups.filter((g) => g.price != null && Number(g.price) > 0).length;
  const groupBreakdown = allGroups
    .filter((g) => g.price != null && Number(g.price) > 0)
    .map((g) => ({ title: g.title, quantity: g.quantity, price: Number(g.price) }));

  return (
    <>
      {/* Recalculate is a live-data write action — not meaningful while
          viewing a read-only historical version. */}
      {!isViewingVersion && <StalePricingBanner projectId={props.projectId} orgId={props.orgId} />}
      {/* The invoice ledger is project-level, never per-version (design doc
          decision 3 — invoices are lineage-labelled, not per-version
          ledgers), so it stays live regardless of the viewed version. */}
      <ProjectFinancePanel
        projectId={props.projectId}
        projectNumber={props.projectNumber}
        clientId={props.clientId}
        projectStatus={props.projectStatus}
        subtotal={props.subtotal}
        taxAmount={props.taxAmount}
        total={props.total}
      />
      <div className="h-px bg-line" />
      {isViewingVersion ? (
        <VersionProjectedFinance />
      ) : (
        <>
          <BillingSummaryRow
            projectId={props.projectId}
            orgId={props.orgId}
            rentalStartDate={props.rentalStartDate}
            rentalEndDate={props.rentalEndDate}
            billingWeeksOverride={props.billingWeeksOverride}
            billingDaysOverride={props.billingDaysOverride}
          />
          <FinancialSummary
            equipmentRevenue={props.equipmentRevenue}
            saleRevenue={props.saleRevenue}
            saleCostTotal={props.saleCostTotal}
            serviceChargeTotal={
              props.subtotal != null && props.equipmentRevenue != null
                ? props.subtotal - props.equipmentRevenue - (props.saleRevenue ?? 0)
                : null
            }
            serviceCostTotal={props.serviceCostTotal}
            labourCostTotal={props.labourCostTotal}
            subHireCostTotal={props.subHireCostTotal}
            subtotal={props.subtotal}
            discountPercent={props.discountPercent}
            discountAmount={props.discountAmount}
            taxRate={props.taxRate}
            taxAmount={props.taxAmount}
            total={props.total}
            margin={props.margin}
            depositPaid={props.depositPaid}
            invoicedTotal={props.invoicedTotal}
            pricedGroupCount={pricedGroupCount}
            totalGroupCount={totalGroupCount}
            groupBreakdown={groupBreakdown}
          />
          <div className="h-px bg-line" />
          <ProjectCostsPanel projectId={props.projectId} />
        </>
      )}
    </>
  );
}

interface NotesTabSlotProps {
  liveCrewNotes: string;
  liveInternalNotes: string;
  liveClientNotes: string;
  onChanged: () => void;
  onSave: (field: "crewNotes" | "internalNotes" | "clientNotes", notes: string) => Promise<unknown>;
}

function ReadOnlyNoteBlock({ title, value }: { title: string; value: string | null }) {
  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
      <h3 className="text-card-title font-bold text-ink">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-ui-text text-ink-2">{value || "—"}</p>
    </div>
  );
}

function NotesTabSlot({ liveCrewNotes, liveInternalNotes, liveClientNotes, onChanged, onSave }: NotesTabSlotProps) {
  const { isViewingVersion, hasCapturedState, projected, viewingRevision } = useProjectVersion();

  if (isViewingVersion) {
    if (!hasCapturedState || !projected) return null;
    return (
      <div className="grid gap-4 pt-4">
        <p className="text-caption text-muted">Notes as captured in v{viewingRevision} — read-only.</p>
        <ReadOnlyNoteBlock title="Crew notes" value={projected.notes.crewNotes} />
        <ReadOnlyNoteBlock title="Internal notes" value={projected.notes.internalNotes} />
        <ReadOnlyNoteBlock title="Client notes" value={projected.notes.clientNotes} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 pt-4">
      <NotesEditor
        title="Crew notes"
        initialNotes={liveCrewNotes}
        onChanged={onChanged}
        onSave={(notes) => onSave("crewNotes", notes)}
        placeholder="Notes for crew members..."
        rows={4}
      />
      <NotesEditor
        title="Internal notes"
        initialNotes={liveInternalNotes}
        onChanged={onChanged}
        onSave={(notes) => onSave("internalNotes", notes)}
        placeholder="Internal notes (not visible to client)..."
        rows={4}
      />
      <NotesEditor
        title="Client notes"
        initialNotes={liveClientNotes}
        onChanged={onChanged}
        onSave={(notes) => onSave("clientNotes", notes)}
        placeholder="Notes visible to client on documents... supports **bold**, *italic*, and '- ' bullets."
        rows={4}
      />
    </div>
  );
}
