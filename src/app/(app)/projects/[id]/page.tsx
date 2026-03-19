"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { LineItemsPanel } from "@/components/projects/line-items-panel";
import { CrewPanel } from "@/components/projects/crew-panel";
import { ServicesPanel } from "@/components/projects/services-panel";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import {
  getProject,
  updateProjectStatus,
  updateProjectNotes,
  archiveProject,
  deleteProject,
} from "@/server/projects";
import { getProjectLabourCost } from "@/server/crew-assignments";
import { DuplicateProjectDialog } from "@/components/projects/duplicate-project-dialog";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
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
import { SectionHeader } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";

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

function formatDate(date: string | null | undefined): string {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [dupMode, setDupMode] = useState<"duplicate" | "template" | null>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", orgId, id],
    queryFn: () => getProject(id),
  });

  const { data: customTemplates } = useQuery({
    queryKey: ["document-templates-dropdown", orgId],
    queryFn: () => getPublishedTemplatesForDropdown(),
    staleTime: 60_000,
  });

  const statusMutation = useMutation({
    mutationFn: (nextStatus: string) =>
      updateProjectStatus(
        id,
        nextStatus as Parameters<typeof updateProjectStatus>[1]
      ),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["project", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveProject(id),
    onSuccess: () => {
      toast.success("Project cancelled");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!project) {
    return <div className="text-fg-3 py-12 text-center">Project not found.</div>;
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
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/projects" className="hover:text-fg transition-colors">
                Projects
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-mono text-fg-2">{project.projectNumber}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-fg">{project.name}</h1>
                  <StatusIndicator
                    category="project"
                    value={project.status}
                    label={projectStatusLabels[project.status] || formatLabel(project.status)}
                  />
                  {project.isTemplate && (
                    <Badge variant="outline" className="bg-indigo-500/10 text-indigo-500 border-indigo-500/20">
                      <BookTemplate className="mr-1 h-3 w-3" />
                      Template
                    </Badge>
                  )}
                </div>
                {(project.client || project.location) && (
                  <p className="mt-1 text-sm text-fg-3">
                    {project.client && (
                      <Link
                        href={`/clients/${project.client.id}`}
                        className="hover:underline"
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
                {!project.isTemplate && (
                  <Button variant="outline" size="sm" render={<Link href={`/warehouse/${id}`} />}>
                    <Warehouse className="mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">Warehouse</span>
                  </Button>
                )}
                {!project.isTemplate && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="outline" size="sm" />}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      <span className="hidden sm:inline">Documents</span>
                      <ChevronDown className="ml-1 h-3 w-3" />
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
                      <DropdownMenuItem
                        onClick={() => window.open(`/api/documents/call-sheet/${id}`, "_blank")}
                      >
                        Call Sheet
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <CanDo resource="project" action="update">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/projects/${id}/edit`} />}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </CanDo>
                <CanDo resource="project" action="create">
                  {project.isTemplate ? (
                    <Button variant="outline" size="sm" onClick={() => setDupMode("duplicate")}>
                      <Copy className="mr-2 h-4 w-4" />
                      Use Template
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDupMode("duplicate")}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate Project
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDupMode("template")}>
                          <BookTemplate className="mr-2 h-4 w-4" />
                          Save as Template
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CanDo>
                {!project.isTemplate && (
                  <CanDo resource="project" action="update">
                    {project.status === "CANCELLED" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Permanently delete this project? This cannot be undone.")) deleteMutation.mutate();
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Cancel this project?")) archiveMutation.mutate();
                        }}
                        disabled={archiveMutation.isPending}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    )}
                  </CanDo>
                )}
              </div>
            </div>
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Main content */}
            <div className="min-w-0 flex-1">
              <Tabs defaultValue="equipment">
                <TabsList>
                  <TabsTrigger value="equipment">Equipment</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                  <TabsTrigger value="crew">Crew</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="files">Files ({(project.media || []).length})</TabsTrigger>
                </TabsList>

                {/* Equipment Tab */}
                <TabsContent value="equipment">
                  <div className="pt-4">
                    <LineItemsPanel
                      projectId={id}
                      rentalStartDate={rentalStart ?? undefined}
                      rentalEndDate={rentalEnd ?? undefined}
                    />
                  </div>
                </TabsContent>

                {/* Services Tab */}
                <TabsContent value="services">
                  <div className="pt-4">
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
                  </div>
                </TabsContent>

                {/* Crew Tab */}
                <TabsContent value="crew">
                  <div className="pt-4">
                    <CrewPanel projectId={id} />
                  </div>
                </TabsContent>

                {/* Notes Tab */}
                <TabsContent value="notes">
                  <div className="grid gap-4 pt-4">
                    <NotesEditor
                      title="Crew Notes"
                      initialNotes={project.crewNotes || ""}
                      queryKey={["project", orgId, id]}
                      onSave={(notes) => updateProjectNotes(id, "crewNotes", notes)}
                      placeholder="Notes for crew members..."
                      rows={4}
                    />
                    <NotesEditor
                      title="Internal Notes"
                      initialNotes={project.internalNotes || ""}
                      queryKey={["project", orgId, id]}
                      onSave={(notes) => updateProjectNotes(id, "internalNotes", notes)}
                      placeholder="Internal notes (not visible to client)..."
                      rows={4}
                    />
                    <NotesEditor
                      title="Client Notes"
                      initialNotes={project.clientNotes || ""}
                      queryKey={["project", orgId, id]}
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
                      queryKey={["project", orgId, id]}
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
            </div>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
              <div className="lg:sticky lg:top-4 space-y-4">
                {/* Status */}
                {!project.isTemplate && (
                  <div className="border-b border-border pb-4 space-y-2">
                    <SectionHeader label="Status" />
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
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {allStatuses.map((s) => (
                          <option key={s} value={s}>
                            {projectStatusLabels[s] || s}
                          </option>
                        ))}
                      </select>
                    </CanDo>
                  </div>
                )}

                {/* Client */}
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Client" />
                  {project.client ? (
                    <div className="space-y-1 text-sm">
                      <Link
                        href={`/clients/${project.client.id}`}
                        className="font-medium text-fg hover:underline"
                      >
                        {project.client.name}
                      </Link>
                      {project.client.contactEmail && (
                        <div className="flex items-center gap-2 text-fg-3">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{project.client.contactEmail}</span>
                        </div>
                      )}
                      {project.client.contactPhone && (
                        <div className="flex items-center gap-2 text-fg-3">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          <span>{project.client.contactPhone}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-fg-3">No client assigned</p>
                  )}
                </div>

                {/* Dates */}
                {!project.isTemplate && (
                  <div className="border-b border-border pb-4 space-y-2">
                    <SectionHeader label="Dates" />
                    {rentalStart && rentalEnd && rangeStart && rangeEnd && (
                      <DateRangeBar
                        start={rentalStart}
                        end={rentalEnd}
                        rangeStart={rangeStart}
                        rangeEnd={rangeEnd}
                        className="mb-2"
                      />
                    )}
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-fg-3 flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Rental
                        </span>
                        <span className="font-medium">
                          {formatDate(project.rentalStartDate as string | null)} &ndash;{" "}
                          {formatDate(project.rentalEndDate as string | null)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Load In</span>
                        <span className="font-medium">
                          {formatDate(project.loadInDate as string | null)}
                          {project.loadInTime && ` ${project.loadInTime}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Load Out</span>
                        <span className="font-medium">
                          {formatDate(project.loadOutDate as string | null)}
                          {project.loadOutTime && ` ${project.loadOutTime}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Event Start</span>
                        <span className="font-medium">
                          {formatDate(project.eventStartDate as string | null)}
                          {project.eventStartTime && ` ${project.eventStartTime}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Event End</span>
                        <span className="font-medium">
                          {formatDate(project.eventEndDate as string | null)}
                          {project.eventEndTime && ` ${project.eventEndTime}`}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Location & Site Contact */}
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Location" />
                  <div className="space-y-1 text-sm">
                    {project.location ? (
                      <>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                          <span className="font-medium">{project.location.name}</span>
                        </div>
                        {project.location.address && (
                          <p className="text-fg-3 pl-5.5">{project.location.address}</p>
                        )}
                        {project.location.latitude != null && project.location.longitude != null && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${project.location.latitude},${project.location.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-teal-500 hover:text-teal-400 pl-5.5"
                          >
                            <Navigation className="h-3 w-3" />
                            Get Directions
                          </a>
                        )}
                      </>
                    ) : (
                      <p className="text-fg-3">No location set</p>
                    )}
                    {project.siteContactName && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="font-medium">{project.siteContactName}</p>
                        {project.siteContactPhone && (
                          <div className="flex items-center gap-2 text-fg-3">
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span>{project.siteContactPhone}</span>
                          </div>
                        )}
                        {project.siteContactEmail && (
                          <div className="flex items-center gap-2 text-fg-3">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span>{project.siteContactEmail}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Financial Summary */}
                {!project.isTemplate && (
                  <div className="border-b border-border pb-4 space-y-2">
                    <SectionHeader label="Financials" />
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-fg-3">Subtotal</span>
                        <span className="t-data font-medium">{formatCurrency(project.subtotal as number | null)}</span>
                      </div>
                      {project.discountPercent != null && (
                        <div className="flex justify-between">
                          <span className="text-fg-3">Discount</span>
                          <span className="t-data font-medium">
                            {Number(project.discountPercent)}%
                            {project.discountAmount != null && ` (${formatCurrency(project.discountAmount as unknown as number)})`}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-fg-3">Tax</span>
                        <span className="t-data font-medium">{formatCurrency(project.taxAmount as number | null)}</span>
                      </div>
                      <div className="flex justify-between items-center border-l-[3px] border-primary pl-2 -ml-2">
                        <span className="text-fg font-medium">Total</span>
                        <span className="t-data font-semibold text-base">{formatCurrency(project.total as number | null)}</span>
                      </div>
                      <div className="my-1 h-px bg-border" />
                      <div className="flex justify-between">
                        <span className="text-fg-3">Invoiced</span>
                        <span className="t-data font-medium">
                          {project.invoicedTotal != null
                            ? formatCurrency(project.invoicedTotal as unknown as number)
                            : "\u2014"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Deposit</span>
                        <span className="t-data font-medium">
                          {project.depositPercent != null ? `${Number(project.depositPercent)}%` : "\u2014"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Deposit Paid</span>
                        <span className="t-data font-medium">{formatCurrency(project.depositPaid as number | null)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Est. Labour</span>
                        <LabourCostDisplay projectId={id} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                {!project.isTemplate && (
                  <div className="border-b border-border pb-4 space-y-2">
                    <SectionHeader label="Quick Actions" />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => window.open(`/api/documents/${id}?type=quote`, "_blank")}
                      >
                        <FileText className="mr-1.5 h-3.5 w-3.5" />
                        Generate Quote
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => window.open(`/api/documents/${id}?type=invoice`, "_blank")}
                      >
                        <DollarSign className="mr-1.5 h-3.5 w-3.5" />
                        Send Invoice
                      </Button>
                    </div>
                  </div>
                )}

                {/* Project Info */}
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Details" />
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Type</span>
                      <span className="font-medium">{typeLabels[project.type] || project.type}</span>
                    </div>
                    {project.description && (
                      <p className="text-sm text-fg-3 whitespace-pre-wrap pt-1">{project.description}</p>
                    )}
                    <div className="flex justify-between">
                      <span className="text-fg-3">Created</span>
                      <span className="font-medium">{formatDate(project.createdAt as unknown as string)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Updated</span>
                      <span className="font-medium">{formatDate(project.updatedAt as unknown as string)}</span>
                    </div>
                  </div>
                </div>

                {/* Activity Timeline */}
                <div className="space-y-2">
                  <SectionHeader label="Activity" />
                  <ActivityTimeline entityType="project" entityId={id} />
                </div>
              </div>
            </div>
          </div>
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
    </RequirePermission>
  );
}

function LabourCostDisplay({ projectId }: { projectId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data } = useQuery({
    queryKey: ["project-labour-cost", orgId, projectId],
    queryFn: () => getProjectLabourCost(projectId),
  });
  return (
    <span className="t-data font-medium">
      {data ? formatCurrency(Number(data.totalLabourCost)) : "\u2014"}
    </span>
  );
}
