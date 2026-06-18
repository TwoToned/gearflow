"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Pencil,
  Trash2,
  MapPin,
  Star,
  Package,
  Boxes,
  Container,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getLocation, deleteLocation, updateLocationNotes } from "@/server/locations";
import { assetStatusLabels, bulkAssetStatusLabels, kitStatusLabels, projectStatusLabels, locationTypeLabels, formatLabel } from "@/lib/status-labels";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { cn, focusRing } from "@/lib/utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { addLocationMedia, removeLocationMedia } from "@/server/location-media";
import { NotesEditor } from "@/components/ui/notes-editor";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
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



export default function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: location, isLoading, refetch } = useServerQuery({
    queryKey: ["location", orgId, id],
    queryFn: () => getLocation(id),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => deleteLocation(id),
    onSuccess: () => {
      toast.success("Location deleted");
      router.push("/locations");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!location) {
    return (
      <RequirePermission resource="location" action="read">
        <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Location not found.</p>
          <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
          <Button variant="line" size="sm" className="mt-4" asChild>
            <Link href="/locations">Back to locations</Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  const assetCount = (location._count?.assets || 0) + (location._count?.bulkAssets || 0) + (location._count?.kits || 0);

  return (
    <RequirePermission resource="location" action="read">
      <PageMeta title={location.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 t-small text-muted">
              <Link href="/locations" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Locations
              </Link>
              {location.parent && (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <Link href={`/locations/${location.parent.id}`} className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                    {location.parent.name}
                  </Link>
                </>
              )}
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="truncate font-medium text-ink">{location.name}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-ink">{location.name}</h1>
                  <StatusIndicator category="locationType" value={location.type} label={locationTypeLabels[location.type] || location.type} />
                  {location.isDefault && (
                    <Star className="h-4 w-4 fill-warn text-warn" />
                  )}
                </div>
                <p className="t-body text-muted">
                  {location.address || "No address"}
                  {location.parent && <> &middot; Sub-location of {location.parent.name}</>}
                </p>
              </div>
              <CanDo resource="location" action="update">
                <div className="flex gap-2">
                  <Button variant="line" asChild>
                    <Link href={`/locations/${id}/edit`}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="line"
                    className="text-t-out hover:border-red hover:bg-red hover:text-white"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CanDo>
            </div>
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* Main content */}
            <DetailMain>
              {/* Address Map */}
              <div className="mb-6">
                <AddressDisplay
                  address={location.address || location.parent?.address}
                  latitude={location.latitude ?? location.parent?.latitude}
                  longitude={location.longitude ?? location.parent?.longitude}
                  label={location.name}
                />
              </div>

              <Tabs defaultValue="assets">
                <TabsList>
                  <TabsTrigger value="assets">
                    Assets ({assetCount})
                  </TabsTrigger>
                  <TabsTrigger value="projects">
                    Projects ({location._count?.projects || 0})
                  </TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="files">
                    Files ({location.media?.length || 0})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="assets" className="mt-4">
                  {(location.assets?.length || 0) === 0 && (location.bulkAssets?.length || 0) === 0 && (location.kits?.length || 0) === 0 ? (
                    <EmptyState title="No assets here" description="Assets checked in to this location will appear here." />
                  ) : (
                    <div className="rounded-[var(--r)] border border-line">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset tag</TableHead>
                            <TableHead>Name / model</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {location.assets?.map((asset: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => (
                            <TableRow key={asset.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${asset.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {asset.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{asset.model?.name || "\u2014"}</TableCell>
                              <TableCell>
                                <Badge status="neutral">Serialised</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                          {location.bulkAssets?.map((bulk: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => (
                            <TableRow key={bulk.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${bulk.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {bulk.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{bulk.model?.name || "\u2014"}</TableCell>
                              <TableCell>
                                <Badge status="neutral">Bulk</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="bulkAsset" value={bulk.status} label={bulkAssetStatusLabels[bulk.status] || formatLabel(bulk.status)} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                          {location.kits?.map((kit: { id: string; assetTag: string; name: string; status: string }) => (
                            <TableRow key={kit.id}>
                              <TableCell>
                                <Link href={`/kits/${kit.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {kit.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{kit.name}</TableCell>
                              <TableCell>
                                <Badge status="neutral">Kit</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="projects" className="mt-4">
                  {(location.projects?.length || 0) === 0 ? (
                    <EmptyState title="No projects here" description="Projects using this as a venue or delivery address will appear here." />
                  ) : (
                    <div className="rounded-[var(--r)] border border-line">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Project #</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {location.projects?.map((project: { id: string; projectNumber: string; name: string; status: string; client?: { name?: string } | null; createdAt: string | Date }) => (
                            <TableRow key={project.id}>
                              <TableCell>
                                <Link href={`/projects/${project.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {project.projectNumber}
                                </Link>
                              </TableCell>
                              <TableCell>{project.name}</TableCell>
                              <TableCell className="text-muted">{project.client?.name || "\u2014"}</TableCell>
                              <TableCell>
                                <StatusIndicator category="project" value={project.status} label={projectStatusLabels[project.status] || formatLabel(project.status)} variant="pill" />
                              </TableCell>
                              <TableCell className="text-muted">
                                {new Date(project.createdAt).toLocaleDateString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="notes" className="mt-4">
                  <NotesEditor
                    initialNotes={location.notes || ""}
                    onChanged={refetch}
                    onSave={(notes) => updateLocationNotes(id, notes)}
                    placeholder="Add notes about this location..."
                  />
                </TabsContent>

                <TabsContent value="files" className="mt-4">
                  <MediaUploader
                    entityType="location"
                    entityId={id}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                    existingMedia={(location.media || []).map((m: MediaItem) => m)}
                    onChanged={refetch}
                    onUploadComplete={async (fileUpload) => {
                      await addLocationMedia({
                        locationId: id,
                        fileId: fileUpload.id,
                      });
                    }}
                    onRemove={async (mediaId) => {
                      await removeLocationMedia(mediaId);
                    }}
                  />
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <DetailSidebar>
                {/* Location info */}
                <SidebarSection title="Location info">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <span className="text-muted">Type</span>
                      <StatusIndicator category="locationType" value={location.type} label={locationTypeLabels[location.type] || location.type} />
                    </div>
                    {location.isDefault && (
                      <div className="flex justify-between">
                        <span className="text-muted">Default</span>
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-warn text-warn" />
                          <span className="font-medium text-ink">Yes</span>
                        </div>
                      </div>
                    )}
                    {location.address && (
                      <div className="flex justify-between">
                        <span className="text-muted">Address</span>
                        <span className="max-w-[200px] truncate text-right font-medium text-ink">{location.address}</span>
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {/* Parent location */}
                {location.parent && (
                  <SidebarSection title="Parent location">
                    <Link
                      href={`/locations/${location.parent.id}`}
                      className={cn("flex items-center gap-2 rounded-[var(--r)] px-2 py-1.5 text-ui-text transition-colors hover:bg-elev", focusRing)}
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="font-medium text-ink">{location.parent.name}</span>
                    </Link>
                  </SidebarSection>
                )}

                {/* Sub-locations */}
                {location.children && location.children.length > 0 && (
                  <SidebarSection title={`Sub-locations (${location.children.length})`}>
                    <div className="space-y-1">
                      {location.children.map((child: { id: string; name: string; _count?: { assets?: number; bulkAssets?: number } }) => (
                        <Link
                          key={child.id}
                          href={`/locations/${child.id}`}
                          className={cn("flex items-center justify-between rounded-[var(--r)] px-2 py-1.5 text-ui-text transition-colors hover:bg-elev", focusRing)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" />
                            <span className="truncate text-ink">{child.name}</span>
                          </div>
                          <span className="shrink-0 text-caption text-muted tabular-nums">
                            {(child._count?.assets || 0) + (child._count?.bulkAssets || 0)} assets
                          </span>
                        </Link>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Asset counts */}
                <SidebarSection title="Inventory">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <Package className="h-3.5 w-3.5" />
                        <span>Serialised</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.assets || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <Boxes className="h-3.5 w-3.5" />
                        <span>Bulk</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.bulkAssets || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <Container className="h-3.5 w-3.5" />
                        <span>Kits</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.kits || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>Projects</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.projects || 0}</span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Activity Timeline */}
                <SidebarSection title="Activity" divider={false}>
                  <ActivityTimeline entityType="location" entityId={id} />
                </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete location?"
        description="This permanently removes the location. Assets, kits, and projects referencing it will be unlinked. This cannot be undone."
        confirmLabel="Delete location"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
    </RequirePermission>
  );
}
