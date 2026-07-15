"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Pencil,
  Archive,
  Mail,
  Phone,
  MapPin,
  FileText,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";
import { useClientWrites } from "@/hooks/use-native-client-writes";
import { projectStatusLabels, clientTypeLabels, formatLabel } from "@/lib/status-labels";
import { formatCurrency } from "@/lib/formatters";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { PresenceAvatarStack } from "@/components/collaboration/presence-avatar-stack";
import { EntityCommentsButton } from "@/components/collaboration/entity-comments-button";
import { RequirePermission } from "@/components/auth/require-permission";
import { NotesEditor } from "@/components/ui/notes-editor";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { cn, focusRing } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="client" action="read">
      <ClientDetailContent params={params} />
    </RequirePermission>
  );
}

function ClientDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Browser-native reactive detail bundle (replaces the getClient server action).
  // Client writes (notes/archive) + media add/remove write to Convex, so this
  // subscription auto-updates — no manual refetch needed.
  const client = useAuthedQuery(api.clients.detail, orgId ? { orgId, id } : "skip");
  const isLoading = client === undefined;

  const clientWrites = useClientWrites();
  const media = useMediaWrites("client");
  const archiveMutation = useServerMutation({
    mutationFn: () => clientWrites.archive(id),
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
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Client not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been archived, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/clients">Back to clients</Link>
        </Button>
      </div>
    );
  }

  // Compute financial / activity summary from the projects the page already loads.
  const totalProjects = client.projects.length;
  const activeProjects = client.projects.filter(
    (p) => !["CANCELLED", "COMPLETED", "INVOICED"].includes(p.status ?? "")
  );
  const totalValue = client.projects.reduce(
    (sum: number, p: { total?: number | null }) => sum + (p.total != null ? Number(p.total) : 0),
    0,
  );
  const lastProjectAt = client.projects.reduce<number | null>((latest, p) => {
    const t = (p.createdAt ?? p._creationTime) as number | undefined;
    if (t == null) return latest;
    return latest == null || t > latest ? t : latest;
  }, null);

  // Mobile card layout for the projects sub-table (rendered below `md`).
  const projectColumns: ColumnDef<(typeof client.projects)[number]>[] = [
    {
      id: "name",
      header: "Name",
      mobile: "title",
      cell: (p) => (
        <Link href={`/projects/${p.id}`} className={cn("rounded-sm text-ink hover:underline", focusRing)}>
          {p.name}
        </Link>
      ),
    },
    {
      id: "number",
      header: "Project #",
      mobile: "subtitle",
      cell: (p) => <span className="t-mono">{p.projectNumber}</span>,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (p) => (
        <StatusIndicator
          category="project"
          value={p.status}
          label={projectStatusLabels[p.status ?? ""] || formatLabel(p.status ?? "")}
          variant="pill"
        />
      ),
    },
    {
      id: "lineItems",
      header: "Line items",
      mobile: "meta",
      cell: (p) => <span className="t-data">{p._count.lineItems}</span>,
    },
    {
      id: "created",
      header: "Created",
      mobile: "meta",
      cell: (p) => new Date((p.createdAt ?? p._creationTime) as number).toLocaleDateString(),
    },
  ];

  return (
    <>
      <PageMeta title={client?.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Hero card (breadcrumb + identity + compact actions) ── */}
          <div className="space-y-4 rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] sm:p-5">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-caption text-muted">
              <Link href="/clients" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Clients
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="truncate text-ink-2">{client.name}</span>
            </nav>

            {/* Identity + actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate font-display text-page-title font-extrabold text-ink">
                    {client.name}
                  </h1>
                  <StatusIndicator
                    category="clientType"
                    value={client.type ?? "COMPANY"}
                    label={(client.type && clientTypeLabels[client.type]) || client.type || "Company"}
                  />
                  {!client.isActive && <Badge status="overbooked">Archived</Badge>}
                </div>
                {/* Meta line: primary contact · email · phone */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  {client.contactName ? (
                    <span className="text-ink-2">{client.contactName}</span>
                  ) : (
                    <span>No primary contact</span>
                  )}
                  {client.contactEmail && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <a
                        href={`mailto:${client.contactEmail}`}
                        className={cn("rounded-sm hover:text-ink-2 hover:underline", focusRing)}
                      >
                        {client.contactEmail}
                      </a>
                    </>
                  )}
                  {client.contactPhone && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <a
                        href={`tel:${client.contactPhone}`}
                        className={cn("rounded-sm hover:text-ink-2 hover:underline", focusRing)}
                      >
                        {client.contactPhone}
                      </a>
                    </>
                  )}
                  {orgId && (
                    <PresenceAvatarStack entityType="client" entityId={id} size="sm" />
                  )}
                </div>
              </div>

              {/* Action buttons (compact) */}
              <div className="flex flex-wrap items-center gap-2">
                {orgId && (
                  <EntityCommentsButton orgId={orgId} entityType="client" entityId={id} />
                )}
                <CanDo resource="client" action="update">
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/clients/${id}/edit`}>
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                  {client.isActive && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="line" size="sm" aria-label="More actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setArchiveOpen(true)}
                          className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
                        >
                          <Archive className="mr-2 h-4 w-4" />
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CanDo>
              </div>
            </div>

            {/* At-a-glance stats strip */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-line bg-line sm:grid-cols-4">
              <HeroStat figure={String(totalProjects)} label="Total jobs" />
              <HeroStat figure={String(activeProjects.length)} label="Active jobs" />
              <HeroStat figure={formatCurrency(totalValue)} label="Total value" />
              <HeroStat
                figure={lastProjectAt ? new Date(lastProjectAt).toLocaleDateString() : "—"}
                label="Last job"
                muted={!lastProjectAt}
              />
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
                      <div className="hidden rounded-[var(--r)] border border-line md:block">
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
                    {client.projects.length > 0 && (
                      <MobileCardList
                        className="md:hidden"
                        data={client.projects}
                        columns={projectColumns}
                        getRowId={(p) => p.id}
                      />
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="notes" className="mt-4">
                  <NotesEditor
                    initialNotes={client.notes || ""}
                    onSave={(notes) => clientWrites.updateNotes(id, notes)}
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
                      onUploadComplete={async (fileUpload) => {
                        await media.add({ parentId: id, fileId: fileUpload.id, type: "DOCUMENT" });
                      }}
                      onRemove={async (mediaId) => {
                        await media.remove(mediaId);
                      }}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <DetailSidebar>
                {/* Contact */}
                <SidebarSection title="Contact">
                  {client.contactName || client.contactEmail || client.contactPhone ? (
                    <div className="space-y-2 text-table-cell">
                      {client.contactName && (
                        <p className="font-medium text-ink">{client.contactName}</p>
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
                    </div>
                  ) : (
                    <p className="text-table-cell text-muted">No contact info yet</p>
                  )}
                </SidebarSection>

                {/* Address & billing — merged: addresses + payment terms */}
                <SidebarSection title="Address & billing">
                  <div className="space-y-3 text-table-cell">
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
                    {/* Payment terms \u2014 only render rows that carry a value (calm-by-default) */}
                    {(client.taxId || client.paymentTerms || client.defaultDiscount != null) && (
                      <div
                        className={cn(
                          "space-y-1.5",
                          (client.billingAddress || client.shippingAddress) && "border-t border-line pt-3",
                        )}
                      >
                        {client.taxId && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted">ABN</span>
                            <span className="font-medium text-ink">{client.taxId}</span>
                          </div>
                        )}
                        {client.paymentTerms && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted">Payment terms</span>
                            <span className="font-medium text-ink">{client.paymentTerms}</span>
                          </div>
                        )}
                        {client.defaultDiscount != null && (
                          <div className="flex justify-between gap-2">
                            <span className="text-muted">Default discount</span>
                            <span className="font-medium text-ink t-data">
                              {Number(client.defaultDiscount)}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {!client.billingAddress &&
                      !client.shippingAddress &&
                      !client.taxId &&
                      !client.paymentTerms &&
                      client.defaultDiscount == null && (
                        <p className="text-muted">No address or billing details yet</p>
                      )}
                  </div>
                </SidebarSection>

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
    </>
  );
}

/** One cell in the hero's at-a-glance stats strip. */
function HeroStat({
  figure,
  label,
  muted = false,
}: {
  figure: React.ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p
        className={cn(
          "font-display font-extrabold leading-none tracking-tight tabular-nums",
          muted ? "text-[18px] text-faint" : "text-[18px] text-ink",
        )}
      >
        {figure}
      </p>
      <p className="mt-1 text-caption text-muted">{label}</p>
    </div>
  );
}
