"use client";

import { use, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectDetail, refreshProjectDetail } from "@/hooks/use-project-detail";
import { useProjectServicesSummary } from "@/hooks/use-project-services";
import { useProjectLabourCost } from "@/hooks/use-project-crew";
import { refreshProjectOverbooked } from "@/hooks/use-project-equipment";
import {
  Pencil,
  Archive,
  Trash2,
  Mail,
  Phone,
  MapPin,
  CalendarDays,
  DollarSign,
  FileText,
  ChevronDown,
  Copy,
  BookTemplate,
  MoreHorizontal,
  Navigation,
  Warehouse,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { EquipmentTab } from "@/components/projects/equipment-tab";
import { CrewPanel } from "@/components/projects/crew-panel";
import { CallSheetDialog } from "@/components/projects/call-sheet-dialog";
import { ServicesPanel } from "@/components/projects/services-panel";
import { TasksPanel } from "@/components/projects/tasks-panel";
import { FinancialSummary } from "@/components/projects/financial-summary";
import { ProjectCostsPanel } from "@/components/projects/project-costs-panel";
import { ProjectConflictsBanner } from "@/components/projects/project-conflicts-banner";
import { ProjectManagersPanel } from "@/components/projects/project-managers-panel";
import { PresenceAvatarStack } from "@/components/collaboration/presence-avatar-stack";
import { ProjectCommentsButton } from "@/components/collaboration/project-comments-button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import {
  updateProjectStatus,
  updateProjectNotes,
  archiveProject,
  deleteProject,
} from "@/server/projects";
import { DuplicateProjectDialog } from "@/components/projects/duplicate-project-dialog";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { PersonAvatar } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { cn, focusRing, disabledState } from "@/lib/utils";
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { addProjectMedia, removeProjectMedia } from "@/server/project-media";
import { getPublishedTemplatesForDropdown } from "@/server/document-templates";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { NotesEditor } from "@/components/ui/notes-editor";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import type { ProjectMediaType } from "@/generated/prisma/client";
import { FadeIn } from "@/components/ui/motion";
import { DateRangeBar } from "@/components/ui/sparkline";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { ProjectActivityFeed } from "@/components/collaboration/activity-feed";
import { formatCurrency, formatDate } from "@/lib/formatters";

const projectStatusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

const typeLabels: Record<string, string> = {
  DRY_HIRE: "Dry Hire",
  WET_HIRE: "Wet Hire",
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
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [dupMode, setDupMode] = useState<"duplicate" | "template" | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data: project, isLoading } = useProjectDetail(id);

  const { data: customTemplates } = useServerQuery({
    queryKey: ["document-templates-dropdown", orgId],
    queryFn: () => getPublishedTemplatesForDropdown(),
  });

  const statusMutation = useServerMutation({
    mutationFn: (nextStatus: string) =>
      updateProjectStatus(
        id,
        nextStatus as Parameters<typeof updateProjectStatus>[1]
      ),
    onSuccess: () => {
      toast.success("Status updated");
      refreshProjectDetail(id);
      // A status transition into CANCELLED/RETURNED/COMPLETED/INVOICED releases
      // stock; any other open project's overbook/availability caches are now stale.
      refreshProjectOverbooked(id);
    },
    onError: (e) => toast.error(e.message),
  });

  const archiveMutation = useServerMutation({
    mutationFn: () => archiveProject(id),
    onSuccess: () => {
      toast.success("Project cancelled");
      refreshProjectDetail(id);
      refreshProjectOverbooked(id);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      toast.success("Project deleted");
      router.push("/projects");
    },
    onError: (e) => toast.error(e.message),
  });

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

  const currentStatus = project.status;

  // Compute date range bar reference window (1 week before start to 1 week after end)
  const rentalStart = project.rentalStartDate
    ? new Date(project.rentalStartDate as unknown as string)
    : null;
  const rentalEnd = project.rentalEndDate
    ? new Date(project.rentalEndDate as unknown as string)
    : null;
  const rangeStart = rentalStart
    ? new Date(rentalStart.getTime() - 7 * 24 * 60 * 60 * 1000)
    : null;
  const rangeEnd = rentalEnd
    ? new Date(rentalEnd.getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;

  return (
    <RequirePermission resource="project" action="read">
      <PageMeta title={project ? `${project.projectNumber} ${project.name}` : undefined} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 text-caption text-muted">
              <Link href="/projects" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
                Projects
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="t-mono text-ink-2">{project.projectNumber}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="t-title text-ink">{project.name}</h1>
                  <StatusIndicator
                    category="project"
                    value={project.status}
                    label={projectStatusLabels[project.status] || formatLabel(project.status)}
                  />
                  {project.isTemplate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-2.5 py-1 text-badge font-bold text-blue">
                      <BookTemplate className="h-3 w-3" />
                      Template
                    </span>
                  )}
                  {/* PM Avatars */}
                  {project.projectManagers && (project.projectManagers as { user: { id: string; name: string | null; email: string; image: string | null } }[]).length > 0 && (
                    <div className="flex -space-x-1.5 ml-2">
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
                  {/* Live presence — who else is viewing this project */}
                  {orgId && !project.isTemplate && (
                    <PresenceAvatarStack
                      entityType="project"
                      entityId={id}
                      size="sm"
                      className="ml-1"
                    />
                  )}
                </div>
                {(project.client || project.location) && (
                  <p className="mt-1 text-caption text-muted">
                    {project.client && (
                      <Link
                        href={`/clients/${project.client.id}`}
                        className={cn("hover:text-ink-2 hover:underline rounded-sm", focusRing)}
                      >
                        {project.client.name}
                      </Link>
                    )}
                    {project.client && project.location && <> &middot; </>}
                    {project.location && project.location.name}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
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
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/projects/${id}/runsheet`}>
                      <ClipboardList className="h-4 w-4" />
                      <span className="hidden sm:inline">Runsheet</span>
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
                      {([
                        { label: "Quote / Proposal", type: "quote", apiType: "quote" },
                        { label: "Invoice", type: "invoice", apiType: "invoice" },
                        { label: "Pull Slip", type: "packing-list", apiType: "pull-slip" },
                        { label: "Delivery Docket", type: "delivery-docket", apiType: "delivery-docket" },
                        { label: "Return Sheet", type: "return-sheet", apiType: "return-sheet" },
                      ] as const).map(({ label, type, apiType }) => {
                        const templates = customTemplates?.filter((t: { type: string }) => t.type === type) || [];
                        if (templates.length === 0) {
                          return (
                            <DropdownMenuItem
                              key={type}
                              onClick={() => window.open(`/api/documents/${id}?type=${apiType}`, "_blank")}
                            >
                              {label}
                            </DropdownMenuItem>
                          );
                        }
                        return (
                          <DropdownMenuSub key={type}>
                            <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem
                                onClick={() => window.open(`/api/documents/${id}?type=${apiType}`, "_blank")}
                              >
                                Default
                              </DropdownMenuItem>
                              {templates.map((t: { id: string; name: string }) => (
                                <DropdownMenuItem
                                  key={t.id}
                                  onClick={() => window.open(`/api/documents/${id}?type=${apiType}&templateId=${t.id}`, "_blank")}
                                >
                                  {t.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        );
                      })}
                      <DropdownMenuItem onClick={() => setCallSheetOpen(true)}>
                        Call Sheet
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => window.open(`/api/documents/timeline/${id}`, "_blank")}
                      >
                        Project Timeline
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
                <CanDo resource="project" action="create">
                  {project.isTemplate ? (
                    <Button variant="line" size="sm" onClick={() => setDupMode("duplicate")}>
                      <Copy className="h-4 w-4" />
                      Use template
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="line" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDupMode("duplicate")}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate project
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDupMode("template")}>
                          <BookTemplate className="mr-2 h-4 w-4" />
                          Save as template
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CanDo>
                {!project.isTemplate && (
                  <CanDo resource="project" action="update">
                    {project.status === "CANCELLED" ? (
                      <Button
                        variant="line"
                        size="sm"
                        className="border-t-out/40 text-t-out hover:bg-t-out hover:text-paper hover:border-t-out"
                        onClick={() => setDeleteOpen(true)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    ) : (
                      <Button
                        variant="line"
                        size="sm"
                        className="border-t-out/40 text-t-out hover:bg-t-out hover:text-paper hover:border-t-out"
                        onClick={() => setCancelOpen(true)}
                        disabled={archiveMutation.isPending}
                      >
                        <Archive className="h-4 w-4" />
                        Cancel
                      </Button>
                    )}
                  </CanDo>
                )}
              </div>
            </div>
          </div>

          {/* ── Summary Strip ──────────────────────────────────────── */}
          {!project.isTemplate && (
            <ProjectSummaryStrip
              projectId={id}
              equipmentRevenue={project.equipmentRevenue as number | null}
              total={project.total as number | null}
            />
          )}

          {/* Reservation conflict banner — hides itself when clean */}
          {!project.isTemplate && <ProjectConflictsBanner projectId={id} />}

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* Main content */}
            <DetailMain>
              <Tabs defaultValue="equipment">
                <TabsList>
                  <TabsTrigger value="equipment">Equipment</TabsTrigger>
                  <TabsTrigger value="labour">Labour &amp; Logistics</TabsTrigger>
                  <TabsTrigger value="tasks">Tasks</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="files">Files ({(project.media || []).length})</TabsTrigger>
                </TabsList>

                {/* Equipment Tab — new category/group hierarchy */}
                <TabsContent value="equipment">
                  <div className="pt-4">
                    <EquipmentTab projectId={id} rentalStartDate={rentalStart} rentalEndDate={rentalEnd} />
                  </div>
                </TabsContent>

                {/* Labour & Logistics Tab — unified services + crew */}
                <TabsContent value="labour">
                  <div className="space-y-6 pt-4">
                    <ServicesPanel
                      projectId={id}
                      projectAddress={project.location?.address || ""}
                      projectLatitude={project.location?.latitude ?? null}
                      projectLongitude={project.location?.longitude ?? null}
                      projectLoadInDate={project.loadInDate ? new Date(project.loadInDate as unknown as string).toISOString().slice(0, 10) : ""}
                      projectLoadOutDate={project.loadOutDate ? new Date(project.loadOutDate as unknown as string).toISOString().slice(0, 10) : ""}
                      projectEventStartDate={project.eventStartDate ? new Date(project.eventStartDate as unknown as string).toISOString().slice(0, 10) : ""}
                      projectEventEndDate={project.eventEndDate ? new Date(project.eventEndDate as unknown as string).toISOString().slice(0, 10) : ""}
                    />
                    <div className="h-px bg-line" />
                    <CrewPanel projectId={id} />
                  </div>
                </TabsContent>

                {/* Tasks Tab */}
                <TabsContent value="tasks">
                  <div className="pt-4">
                    <TasksPanel projectId={id} />
                  </div>
                </TabsContent>

                {/* Notes Tab */}
                <TabsContent value="notes">
                  <div className="grid gap-4 pt-4">
                    <NotesEditor
                      title="Crew Notes"
                      initialNotes={project.crewNotes || ""}
                      onChanged={() =>
                        refreshProjectDetail(id)
                      }
                      onSave={(notes) => updateProjectNotes(id, "crewNotes", notes)}
                      placeholder="Notes for crew members..."
                      rows={4}
                    />
                    <NotesEditor
                      title="Internal Notes"
                      initialNotes={project.internalNotes || ""}
                      onChanged={() =>
                        refreshProjectDetail(id)
                      }
                      onSave={(notes) => updateProjectNotes(id, "internalNotes", notes)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={4}
                    />
                    <NotesEditor
                      title="Client Notes"
                      initialNotes={project.clientNotes || ""}
                      onChanged={() =>
                        refreshProjectDetail(id)
                      }
                      onSave={(notes) => updateProjectNotes(id, "clientNotes", notes)}
                      placeholder="Notes visible to client on documents..."
                      rows={4}
                    />
                  </div>
                </TabsContent>

                {/* Files Tab */}
                <TabsContent value="files">
                  <div className="pt-4">
                    <MediaUploader
                      entityType="project"
                      entityId={id}
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.txt"
                      existingMedia={(project.media || []) as MediaItem[]}
                      onChanged={() =>
                        refreshProjectDetail(id)
                      }
                      onUploadComplete={async (fileUpload) => {
                        await addProjectMedia({
                          projectId: id,
                          fileId: fileUpload.id,
                          type: "OTHER" as ProjectMediaType,
                        });
                      }}
                      onRemove={async (mediaId) => {
                        await removeProjectMedia(mediaId);
                      }}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <DetailSidebar>
                {/* Status */}
                {!project.isTemplate && (
                  <SidebarSection title="Status">
                    <CanDo
                      resource="project"
                      action="update"
                      fallback={
                        <div className="flex items-center gap-2">
                          <StatusIndicator
                            category="project"
                            value={currentStatus}
                            label={projectStatusLabels[currentStatus] || formatLabel(currentStatus)}
                          />
                        </div>
                      }
                    >
                      <select
                        value={currentStatus}
                        onChange={(e) => statusMutation.mutate(e.target.value)}
                        disabled={statusMutation.isPending}
                        className={cn(
                          "flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-ui-text text-ink transition-colors",
                          focusRing,
                          disabledState,
                        )}
                      >
                        {allStatuses.map((s) => (
                          <option key={s} value={s}>
                            {projectStatusLabels[s] || s}
                          </option>
                        ))}
                      </select>
                    </CanDo>
                  </SidebarSection>
                )}

                {/* Project Managers */}
                <ProjectManagersPanel
                  projectId={id}
                  managers={
                    (project.projectManagers as {
                      userId: string;
                      user: {
                        id: string;
                        name: string | null;
                        email: string;
                        image: string | null;
                      };
                    }[]) ?? []
                  }
                />

                {/* Client */}
                <SidebarSection title="Client">
                  {project.client ? (
                    <div className="space-y-1 text-ui-text">
                      <Link
                        href={`/clients/${project.client.id}`}
                        className={cn("font-medium text-ink hover:text-link hover:underline rounded-sm", focusRing)}
                      >
                        {project.client.name}
                      </Link>
                      {project.client.contactEmail && (
                        <div className="flex items-center gap-2 text-muted">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{project.client.contactEmail}</span>
                        </div>
                      )}
                      {project.client.contactPhone && (
                        <div className="flex items-center gap-2 text-muted">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          <span>{project.client.contactPhone}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-ui-text text-muted">No client assigned</p>
                  )}
                </SidebarSection>

                {/* Dates */}
                {!project.isTemplate && (
                  <SidebarSection title="Dates">
                    {rentalStart && rentalEnd && rangeStart && rangeEnd && (
                      <DateRangeBar
                        start={rentalStart}
                        end={rentalEnd}
                        rangeStart={rangeStart}
                        rangeEnd={rangeEnd}
                        className="mb-2"
                      />
                    )}
                    <div className="space-y-1 text-ui-text">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Rental
                        </span>
                        <span className="font-medium text-ink-2 tabular-nums text-right">
                          {formatDate(project.rentalStartDate as string | null)} &ndash;{" "}
                          {formatDate(project.rentalEndDate as string | null)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Load in</span>
                        <span className="font-medium text-ink-2 tabular-nums">
                          {formatDate(project.loadInDate as string | null)}
                          {project.loadInTime && ` ${project.loadInTime}`}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Load out</span>
                        <span className="font-medium text-ink-2 tabular-nums">
                          {formatDate(project.loadOutDate as string | null)}
                          {project.loadOutTime && ` ${project.loadOutTime}`}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Event start</span>
                        <span className="font-medium text-ink-2 tabular-nums">
                          {formatDate(project.eventStartDate as string | null)}
                          {project.eventStartTime && ` ${project.eventStartTime}`}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Event end</span>
                        <span className="font-medium text-ink-2 tabular-nums">
                          {formatDate(project.eventEndDate as string | null)}
                          {project.eventEndTime && ` ${project.eventEndTime}`}
                        </span>
                      </div>
                    </div>
                  </SidebarSection>
                )}

                {/* Location & Site Contact */}
                <SidebarSection title="Location">
                  <div className="space-y-1 text-ui-text">
                    {project.location ? (
                      <>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
                          <span className="font-medium text-ink-2">{project.location.name}</span>
                        </div>
                        {project.location.address && (
                          <p className="text-muted pl-5.5">{project.location.address}</p>
                        )}
                        {project.location.latitude != null && project.location.longitude != null && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${project.location.latitude},${project.location.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn("inline-flex items-center gap-1.5 text-caption text-link hover:underline pl-5.5 rounded-sm", focusRing)}
                          >
                            <Navigation className="h-3 w-3" />
                            Get directions
                          </a>
                        )}
                      </>
                    ) : (
                      <p className="text-muted">No location set</p>
                    )}
                    {project.siteContactName && (
                      <div className="mt-2 pt-2 border-t border-line">
                        <p className="font-medium text-ink-2">{project.siteContactName}</p>
                        {project.siteContactPhone && (
                          <div className="flex items-center gap-2 text-muted">
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span>{project.siteContactPhone}</span>
                          </div>
                        )}
                        {project.siteContactEmail && (
                          <div className="flex items-center gap-2 text-muted">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span>{project.siteContactEmail}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {/* Financial Summary */}
                {!project.isTemplate && (() => {
                  // Compute group pricing stats from categories
                  const allGroups = (project.categories as { groups: { title: string; quantity: number; price: unknown }[] }[] | undefined)
                    ?.flatMap((c) => c.groups) ?? [];
                  const totalGroupCount = allGroups.length;
                  const pricedGroupCount = allGroups.filter((g) => g.price != null && Number(g.price) > 0).length;
                  const groupBreakdown = allGroups
                    .filter((g) => g.price != null && Number(g.price) > 0)
                    .map((g) => ({ title: g.title, quantity: g.quantity, price: Number(g.price) }));

                  return (
                    <div className="border-b border-line pb-4">
                      <FinancialSummary
                        equipmentRevenue={project.equipmentRevenue as number | null}
                        serviceChargeTotal={
                          project.subtotal != null && project.equipmentRevenue != null
                            ? Number(project.subtotal) - Number(project.equipmentRevenue)
                            : null
                        }
                        serviceCostTotal={project.serviceCostTotal as number | null}
                        labourCostTotal={project.labourCostTotal as number | null}
                        subHireCostTotal={project.subHireCostTotal as number | null}
                        subtotal={project.subtotal as number | null}
                        discountPercent={project.discountPercent as number | null}
                        discountAmount={project.discountAmount as number | null}
                        taxRate={project.taxRate as number | null}
                        taxAmount={project.taxAmount as number | null}
                        total={project.total as number | null}
                        margin={project.margin as number | null}
                        depositPercent={project.depositPercent as number | null}
                        depositPaid={project.depositPaid as number | null}
                        pricedGroupCount={pricedGroupCount}
                        totalGroupCount={totalGroupCount}
                        groupBreakdown={groupBreakdown}
                      />
                    </div>
                  );
                })()}

                {/* Operational P&L — costs roll-up beyond the financial summary.
                    Hides itself when project has no revenue yet. */}
                {!project.isTemplate && (
                  <div className="border-b border-line pb-4">
                    <ProjectCostsPanel projectId={project.id} />
                  </div>
                )}

                {/* Quick Actions */}
                {!project.isTemplate && (
                  <SidebarSection title="Quick actions">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="line"
                        size="sm"
                        onClick={() => window.open(`/api/documents/${id}?type=quote`, "_blank")}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Generate quote
                      </Button>
                      <Button
                        variant="line"
                        size="sm"
                        onClick={() => window.open(`/api/documents/${id}?type=invoice`, "_blank")}
                      >
                        <DollarSign className="h-3.5 w-3.5" />
                        Send invoice
                      </Button>
                    </div>
                  </SidebarSection>
                )}

                {/* Project Info */}
                <SidebarSection title="Details">
                  <div className="text-ui-text space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Type</span>
                      <span className="font-medium text-ink-2">{typeLabels[project.type] || project.type}</span>
                    </div>
                    {project.description && (
                      <p className="text-ui-text text-muted whitespace-pre-wrap pt-1">{project.description}</p>
                    )}
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Created</span>
                      <span className="font-medium text-ink-2 tabular-nums">{formatDate(project.createdAt as unknown as string)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Updated</span>
                      <span className="font-medium text-ink-2 tabular-nums">{formatDate(project.updatedAt as unknown as string)}</span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Realtime collaboration feed (comments, blocking, reviews) */}
                {orgId && !project.isTemplate && (
                  <SidebarSection title="Collaboration" divider={false}>
                    <ProjectActivityFeed
                      orgId={orgId}
                      entityType="project"
                      entityId={id}
                      limit={20}
                      emptyText="No collaboration activity yet."
                    />
                  </SidebarSection>
                )}

                {/* Legacy audit timeline */}
                <SidebarSection title="Activity" divider={false}>
                  <ActivityTimeline entityType="project" entityId={id} />
                </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
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
        description="The project will be marked CANCELLED. Reservations release and items return to inventory. You can permanently delete a cancelled project later."
        confirmLabel="Cancel project"
        cancelLabel="Keep project"
        onConfirm={() => {
          archiveMutation.mutate();
          setCancelOpen(false);
        }}
        pending={archiveMutation.isPending}
      />
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
  const { data: labourData } = useProjectLabourCost(projectId);

  const { data: serviceData } = useProjectServicesSummary(projectId);

  const metrics = [
    {
      label: "Equipment",
      value: formatCurrency(equipmentRevenue),
    },
    {
      label: "Services",
      value: serviceData
        ? `${formatCurrency(serviceData.chargeTotal)} charge · ${formatCurrency(serviceData.costTotal)} cost`
        : "\u2014",
    },
    {
      label: "Crew",
      value: labourData
        ? `${formatCurrency(Number(labourData.totalLabourCost))} · ${labourData.assignmentCount}`
        : "\u2014",
    },
    {
      label: "Total",
      value: formatCurrency(total),
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
