"use client";

import { use } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Pencil,
  Archive,
  Trash2,
  Mail,
  Phone,
  MapPin,
  CalendarDays,
  Package,
  DollarSign,
  FileText,
  ChevronDown,
  Copy,
  BookTemplate,
  MoreHorizontal,
  Navigation,
  Warehouse,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addProjectMedia, removeProjectMedia, getProjectMedia } from "@/server/project-media";
import { getPublishedTemplatesForDropdown } from "@/server/document-templates";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { NotesEditor } from "@/components/ui/notes-editor";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import type { ProjectMediaType } from "@/generated/prisma/client";

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
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
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
    return <div className="text-muted-foreground py-12 text-center">Project not found.</div>;
  }

  const currentStatus = project.status;

  return (
    <RequirePermission resource="project" action="read">
    <PageMeta title={project ? `${project.projectNumber} ${project.name}` : undefined} />
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              {project.projectNumber}
            </span>
            <StatusIndicator category="project" value={project.status} label={projectStatusLabels[project.status] || formatLabel(project.status)} />
            {project.isTemplate && (
              <Badge variant="outline" className="bg-indigo-500/10 text-indigo-500 border-indigo-500/20">
                <BookTemplate className="mr-1 h-3 w-3" />
                Template
              </Badge>
            )}
          </div>
          <h1 className="t-title text-fg mt-1">
            {project.name}
          </h1>
          {project.client && (
            <p className="text-muted-foreground">
              <Link
                href={`/clients/${project.client.id}`}
                className="hover:underline"
              >
                {project.client.name}
              </Link>
              {project.location && <> &middot; {project.location.name}</>}
            </p>
          )}
        </div>
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

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="crew">Crew</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="files">Files ({(project.media || []).length})</TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details">
          <div className="space-y-6 pt-4">
            {/* Status */}
            {!project.isTemplate && (
              <Card>
                <CardContent className="flex items-center gap-3 py-4">
                  <span className="text-sm font-medium text-muted-foreground">
                    Status:
                  </span>
                  <CanDo resource="project" action="update" fallback={
                    <StatusIndicator category="project" value={currentStatus} label={projectStatusLabels[currentStatus] || formatLabel(currentStatus)} />
                  }>
                    <select
                      value={currentStatus}
                      onChange={(e) => statusMutation.mutate(e.target.value)}
                      disabled={statusMutation.isPending}
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {allStatuses.map((s) => (
                        <option key={s} value={s}>
                          {projectStatusLabels[s] || s}
                        </option>
                      ))}
                    </select>
                  </CanDo>
                </CardContent>
              </Card>
            )}

            {/* Info cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Client Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Client
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {project.client ? (
                    <>
                      <Link
                        href={`/clients/${project.client.id}`}
                        className="font-medium hover:underline"
                      >
                        {project.client.name}
                      </Link>
                      {project.client.contactEmail && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" />
                          <span>{project.client.contactEmail}</span>
                        </div>
                      )}
                      {project.client.contactPhone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{project.client.contactPhone}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">No client assigned</p>
                  )}
                </CardContent>
              </Card>

              {/* Location & Site Contact */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Location &amp; Site Contact
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {project.location ? (
                    <>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{project.location.name}</span>
                      </div>
                      {project.location.address && (
                        <p className="text-muted-foreground">
                          {project.location.address}
                        </p>
                      )}
                      {project.location.latitude != null && project.location.longitude != null && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${project.location.latitude},${project.location.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-teal-500 hover:text-teal-400 mt-1"
                        >
                          <Navigation className="h-3 w-3" />
                          Get Directions
                        </a>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">No location set</span>
                    </div>
                  )}
                  {project.siteContactName && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="font-medium">{project.siteContactName}</p>
                      {project.siteContactPhone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{project.siteContactPhone}</span>
                        </div>
                      )}
                      {project.siteContactEmail && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" />
                          <span>{project.siteContactEmail}</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Dates */}
              {!project.isTemplate && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Dates
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Rental Period
                      </span>
                      <span className="font-medium">
                        {formatDate(project.rentalStartDate as string | null)} –{" "}
                        {formatDate(project.rentalEndDate as string | null)}
                      </span>
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Load In</span>
                      <span className="font-medium">
                        {formatDate(project.loadInDate as string | null)}
                        {project.loadInTime && ` ${project.loadInTime}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Load Out</span>
                      <span className="font-medium">
                        {formatDate(project.loadOutDate as string | null)}
                        {project.loadOutTime && ` ${project.loadOutTime}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Event Start</span>
                      <span className="font-medium">
                        {formatDate(project.eventStartDate as string | null)}
                        {project.eventStartTime &&
                          ` ${project.eventStartTime}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Event End</span>
                      <span className="font-medium">
                        {formatDate(project.eventEndDate as string | null)}
                        {project.eventEndTime && ` ${project.eventEndTime}`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Financial */}
              {!project.isTemplate && <Card className="sm:col-span-2 lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5" />
                      Financial Summary
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-8 text-sm">
                    <div>
                      <span className="text-muted-foreground">Subtotal</span>
                      <p className="font-medium">
                        {formatCurrency(project.subtotal as number | null)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Discount</span>
                      <p className="font-medium">
                        {project.discountPercent != null
                          ? `${Number(project.discountPercent)}%`
                          : "—"}
                        {project.discountAmount != null &&
                          ` (${formatCurrency(project.discountAmount as unknown as number)})`}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tax</span>
                      <p className="font-medium">
                        {formatCurrency(project.taxAmount as number | null)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total</span>
                      <p className="font-semibold text-base">
                        {formatCurrency(project.total as number | null)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Invoiced Total</span>
                      <p className="font-semibold text-base">
                        {project.invoicedTotal != null
                          ? formatCurrency(project.invoicedTotal as unknown as number)
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Deposit
                      </span>
                      <p className="font-medium">
                        {project.depositPercent != null
                          ? `${Number(project.depositPercent)}%`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Deposit Paid
                      </span>
                      <p className="font-medium">
                        {formatCurrency(project.depositPaid as number | null)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Est. Labour
                      </span>
                      <LabourCostDisplay projectId={id} />
                    </div>
                  </div>
                </CardContent>
              </Card>}
            </div>

            {/* Description */}
            {project.description && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Description
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">
                    {project.description}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Project Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Project Info
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium">
                    {typeLabels[project.type] || project.type}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">
                    {formatDate(project.createdAt as unknown as string)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Updated</span>
                  <span className="font-medium">
                    {formatDate(project.updatedAt as unknown as string)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Equipment Tab */}
        <TabsContent value="equipment">
          <div className="pt-4">
            <LineItemsPanel
              projectId={id}
              rentalStartDate={
                project.rentalStartDate
                  ? new Date(project.rentalStartDate as unknown as string)
                  : undefined
              }
              rentalEndDate={
                project.rentalEndDate
                  ? new Date(project.rentalEndDate as unknown as string)
                  : undefined
              }
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
          <div className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Project Files & Documents</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>

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
    <p className="font-medium">
      {data ? formatCurrency(Number(data.totalLabourCost)) : "—"}
    </p>
  );
}
