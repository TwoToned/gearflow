"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Pencil,
  Archive,
  Mail,
  Phone,
  MapPin,
  FileText,
  ChevronRight,
  DollarSign,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getClient, archiveClient, updateClientNotes } from "@/server/clients";
import { projectStatusLabels, clientTypeLabels, formatLabel } from "@/lib/status-labels";
import { formatCurrency } from "@/lib/formatters";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { PresenceAvatarStack } from "@/components/collaboration/presence-avatar-stack";
import { EntityCommentsButton } from "@/components/collaboration/entity-comments-button";
import { RequirePermission } from "@/components/auth/require-permission";
import { NotesEditor } from "@/components/ui/notes-editor";
import { addClientMedia, removeClientMedia } from "@/server/client-media";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { cn, focusRing } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: client, isLoading, refetch } = useServerQuery({
    queryKey: ["client", orgId, id],
    queryFn: () => getClient(id),
  });

  const archiveMutation = useServerMutation({
    mutationFn: () => archiveClient(id),
    onSuccess: () => {
      toast.success("Client archived");
      router.push("/clients");
    },
  });

  const [archiveOpen, setArchiveOpen] = useState(false);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!client) {
    return (
      <RequirePermission resource="client" action="read">
        <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Client not found.</p>
          <p className="mt-1 text-caption text-muted">It may have been archived, or you don&apos;t have access to it.</p>
          <Button variant="line" size="sm" className="mt-4" asChild>
            <Link href="/clients">Back to clients</Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  // Compute financial summary from projects
  const totalProjects = client.projects.length;
  const activeProjects = client.projects.filter(
    (p) => !["CANCELLED", "COMPLETED", "INVOICED"].includes(p.status ?? "")
  );

  return (
    <RequirePermission resource="client" action="read">
      <PageMeta title={client?.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 t-small text-muted">
              <Link href="/clients" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Clients
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="truncate font-medium text-ink">{client.name}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-ink">{client.name}</h1>
                  <StatusIndicator
                    category="clientType"
                    value={client.type ?? "COMPANY"}
                    label={(client.type && clientTypeLabels[client.type]) || client.type || "Company"}
                  />
                  {!client.isActive && <Badge status="overbooked">Archived</Badge>}
                </div>
                <p className="t-body text-muted">
                  {client.contactName || "No primary contact"}
                  {client.contactEmail && <> &middot; {client.contactEmail}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {orgId && (
                  <PresenceAvatarStack entityType="client" entityId={id} size="sm" />
                )}
                {orgId && (
                  <EntityCommentsButton orgId={orgId} entityType="client" entityId={id} />
                )}
                <CanDo resource="client" action="update">
                  <div className="flex gap-2">
                    <Button variant="line" asChild>
                      <Link href={`/clients/${id}/edit`}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Link>
                    </Button>
                    {client.isActive && (
                      <Button
                        variant="line"
                        className="text-t-out hover:border-t-out hover:bg-out-soft hover:text-t-out"
                        onClick={() => setArchiveOpen(true)}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        Archive
                      </Button>
                    )}
                  </div>
                </CanDo>
              </div>
            </div>
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* Main content */}
            <DetailMain>
              <Tabs defaultValue="projects">
                <TabsList>
                  <TabsTrigger value="projects">
                    Projects ({client.projects.length})
                  </TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="files">
                    Files ({client.media?.length || 0})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="projects" className="mt-4">
                  <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                    <h3 className="t-heading mb-4 text-ink">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        All projects
                      </div>
                    </h3>
                    {client.projects.length === 0 ? (
                      <EmptyState
                        title="No projects yet"
                        description="Projects for this client will appear here."
                      />
                    ) : (
                      <div className="rounded-[var(--r)] border border-line">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Project #</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Line items</TableHead>
                              <TableHead>Created</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {client.projects.map((project) => (
                              <TableRow key={project.id}>
                                <TableCell>
                                  <Link
                                    href={`/projects/${project.id}`}
                                    className={cn("rounded-sm t-mono text-ink hover:underline", focusRing)}
                                  >
                                    {project.projectNumber}
                                  </Link>
                                </TableCell>
                                <TableCell>{project.name}</TableCell>
                                <TableCell>
                                  <StatusIndicator
                                    category="project"
                                    value={project.status}
                                    label={
                                      projectStatusLabels[project.status ?? ""] ||
                                      formatLabel(project.status ?? "")
                                    }
                                    variant="pill"
                                  />
                                </TableCell>
                                <TableCell className="text-right t-data">
                                  {project._count.lineItems}
                                </TableCell>
                                <TableCell className="text-muted">
                                  {new Date((project.createdAt ?? project._creationTime) as number).toLocaleDateString()}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="notes" className="mt-4">
                  <NotesEditor
                    initialNotes={client.notes || ""}
                    onChanged={refetch}
                    onSave={(notes) => updateClientNotes(id, notes)}
                    placeholder="Add notes about this client..."
                  />
                </TabsContent>

                <TabsContent value="files" className="mt-4">
                  <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                    <h3 className="t-heading mb-4 text-ink">Files</h3>
                    <MediaUploader
                      entityType="client"
                      entityId={id}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                      existingMedia={(client.media || []).map((m: MediaItem) => m)}
                      onChanged={refetch}
                      onUploadComplete={async (fileUpload) => {
                        await addClientMedia({
                          clientId: id,
                          fileId: fileUpload.id,
                        });
                      }}
                      onRemove={async (mediaId) => {
                        await removeClientMedia(mediaId);
                      }}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <DetailSidebar>
                {/* Contact Info */}
                <SidebarSection title="Contact">
                  <div className="space-y-2 text-ui-text">
                    {client.contactName && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{client.contactName}</span>
                      </div>
                    )}
                    {client.contactEmail && (
                      <div className="flex items-center gap-2 text-muted">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={`mailto:${client.contactEmail}`}
                          className={cn("truncate rounded-sm text-link hover:underline", focusRing)}
                        >
                          {client.contactEmail}
                        </a>
                      </div>
                    )}
                    {client.contactPhone && (
                      <div className="flex items-center gap-2 text-muted">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a href={`tel:${client.contactPhone}`} className={cn("rounded-sm text-link hover:underline", focusRing)}>
                          {client.contactPhone}
                        </a>
                      </div>
                    )}
                    {!client.contactName && !client.contactEmail && !client.contactPhone && (
                      <p className="text-muted">No contact info</p>
                    )}
                  </div>
                </SidebarSection>

                {/* Addresses */}
                <SidebarSection title="Addresses">
                  <div className="space-y-3 text-ui-text">
                    {client.billingAddress && (
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-caption text-muted">
                          <MapPin className="h-3 w-3" />
                          Billing
                        </div>
                        <AddressDisplay
                          address={client.billingAddress}
                          latitude={client.billingLatitude}
                          longitude={client.billingLongitude}
                          label={`${client.name} — Billing`}
                          compact
                        />
                      </div>
                    )}
                    {client.shippingAddress && (
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-caption text-muted">
                          <MapPin className="h-3 w-3" />
                          Shipping
                        </div>
                        <AddressDisplay
                          address={client.shippingAddress}
                          latitude={client.shippingLatitude}
                          longitude={client.shippingLongitude}
                          label={`${client.name} — Shipping`}
                          compact
                        />
                      </div>
                    )}
                    {!client.billingAddress && !client.shippingAddress && (
                      <p className="text-muted">No addresses</p>
                    )}
                  </div>
                </SidebarSection>

                {/* Billing / Financial */}
                <SidebarSection title="Billing">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <span className="text-muted">ABN</span>
                      <span className="font-medium text-ink">{client.taxId || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Payment terms</span>
                      <span className="font-medium text-ink">{client.paymentTerms || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Default discount</span>
                      <span className="font-medium text-ink t-data">
                        {client.defaultDiscount != null
                          ? `${Number(client.defaultDiscount)}%`
                          : "\u2014"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Total projects</span>
                      <span className="font-medium text-ink t-data">{totalProjects}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Active</span>
                      <span className="font-medium text-ink t-data">{activeProjects.length}</span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Recent Projects (compact) */}
                {client.projects.length > 0 && (
                  <SidebarSection title="Recent projects">
                    <div className="space-y-1">
                      {client.projects.slice(0, 5).map((project) => (
                        <Link
                          key={project.id}
                          href={`/projects/${project.id}`}
                          className={cn(
                            "flex items-center justify-between rounded-[var(--r)] px-2 py-1.5 text-ui-text transition-colors hover:bg-elev",
                            focusRing,
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 t-mono text-muted">
                              {project.projectNumber}
                            </span>
                            <span className="truncate text-ink">{project.name}</span>
                          </div>
                          <StatusIndicator
                            category="project"
                            value={project.status ?? ""}
                            label={
                              projectStatusLabels[project.status ?? ""] ||
                              formatLabel(project.status ?? "")
                            }
                            variant="pill"
                          />
                        </Link>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Activity Timeline */}
                <SidebarSection title="Activity" divider={false}>
                  <ActivityTimeline entityType="client" entityId={id} />
                </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>
      <DeleteDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this client?"
        description="The client is hidden from new projects but past projects, quotes, and invoices remain. You can restore the client later from the archived view."
        confirmLabel="Archive client"
        onConfirm={() => {
          archiveMutation.mutate();
          setArchiveOpen(false);
        }}
        pending={archiveMutation.isPending}
      />
    </RequirePermission>
  );
}
