"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation } from "@tanstack/react-query";
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

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", orgId, id],
    queryFn: () => getClient(id),
  });

  const archiveMutation = useMutation({
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
    return <div className="text-fg-3 py-12 text-center">Client not found.</div>;
  }

  // Compute financial summary from projects
  const totalProjects = client.projects.length;
  const activeProjects = client.projects.filter(
    (p: { status: string }) => !["CANCELLED", "COMPLETED", "INVOICED"].includes(p.status)
  );

  return (
    <RequirePermission resource="client" action="read">
      <PageMeta title={client?.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/clients" className="hover:text-fg transition-colors">
                Clients
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-fg font-medium truncate">{client.name}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-fg">{client.name}</h1>
                  <StatusIndicator
                    category="clientType"
                    value={client.type ?? "COMPANY"}
                    label={(client.type && clientTypeLabels[client.type]) || client.type || "Company"}
                  />
                  {!client.isActive && <Badge variant="destructive">Archived</Badge>}
                </div>
                <p className="t-body text-fg-3">
                  {client.contactName || "No primary contact"}
                  {client.contactEmail && <> &middot; {client.contactEmail}</>}
                </p>
              </div>
              <CanDo resource="client" action="update">
                <div className="flex gap-2">
                  <Button variant="outline" render={<Link href={`/clients/${id}/edit`} />}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  {client.isActive && (
                    <Button
                      variant="outline"
                      className="text-destructive"
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
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <h3 className="t-heading text-fg mb-4">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        All Projects
                      </div>
                    </h3>
                    {client.projects.length === 0 ? (
                      <EmptyState
                        preset="projects"
                        heading="No projects yet"
                        description="Projects for this client will appear here."
                      />
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Project #</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Line Items</TableHead>
                              <TableHead>Created</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {client.projects.map((project) => (
                              <TableRow key={project.id}>
                                <TableCell>
                                  <Link
                                    href={`/projects/${project.id}`}
                                    className="font-mono text-sm font-medium hover:underline"
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
                                      projectStatusLabels[project.status] ||
                                      formatLabel(project.status)
                                    }
                                    variant="pill"
                                  />
                                </TableCell>
                                <TableCell className="text-right t-data">
                                  {project._count.lineItems}
                                </TableCell>
                                <TableCell className="text-fg-3">
                                  {new Date(project.createdAt).toLocaleDateString()}
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
                    queryKey={["client", orgId, id]}
                    onSave={(notes) => updateClientNotes(id, notes)}
                    placeholder="Add notes about this client..."
                  />
                </TabsContent>

                <TabsContent value="files" className="mt-4">
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <h3 className="t-heading text-fg mb-4">Files</h3>
                    <MediaUploader
                      entityType="client"
                      entityId={id}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                      existingMedia={(client.media || []).map((m: MediaItem) => m)}
                      queryKey={["client", orgId, id]}
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
                  <div className="space-y-2 text-sm">
                    {client.contactName && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{client.contactName}</span>
                      </div>
                    )}
                    {client.contactEmail && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={`mailto:${client.contactEmail}`}
                          className="hover:underline truncate"
                        >
                          {client.contactEmail}
                        </a>
                      </div>
                    )}
                    {client.contactPhone && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a href={`tel:${client.contactPhone}`} className="hover:underline">
                          {client.contactPhone}
                        </a>
                      </div>
                    )}
                    {!client.contactName && !client.contactEmail && !client.contactPhone && (
                      <p className="text-fg-3">No contact info</p>
                    )}
                  </div>
                </SidebarSection>

                {/* Addresses */}
                <SidebarSection title="Addresses">
                  <div className="space-y-3 text-sm">
                    {client.billingAddress && (
                      <div>
                        <div className="flex items-center gap-1 text-xs text-fg-3 mb-1">
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
                        <div className="flex items-center gap-1 text-xs text-fg-3 mb-1">
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
                      <p className="text-fg-3">No addresses</p>
                    )}
                  </div>
                </SidebarSection>

                {/* Billing / Financial */}
                <SidebarSection title="Billing">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">ABN</span>
                      <span className="font-medium">{client.taxId || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Payment Terms</span>
                      <span className="font-medium">{client.paymentTerms || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Default Discount</span>
                      <span className="font-medium">
                        {client.defaultDiscount != null
                          ? `${Number(client.defaultDiscount)}%`
                          : "\u2014"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Total Projects</span>
                      <span className="font-medium">{totalProjects}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Active</span>
                      <span className="font-medium">{activeProjects.length}</span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Recent Projects (compact) */}
                {client.projects.length > 0 && (
                  <SidebarSection title="Recent Projects">
                    <div className="space-y-1">
                      {client.projects.slice(0, 5).map((project) => (
                        <Link
                          key={project.id}
                          href={`/projects/${project.id}`}
                          className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-bg-surface transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs text-fg-3 shrink-0">
                              {project.projectNumber}
                            </span>
                            <span className="truncate">{project.name}</span>
                          </div>
                          <StatusIndicator
                            category="project"
                            value={project.status}
                            label={
                              projectStatusLabels[project.status] ||
                              formatLabel(project.status)
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
