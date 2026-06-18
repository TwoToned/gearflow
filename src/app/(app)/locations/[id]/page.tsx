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
    return <div className="text-fg-3 py-12 text-center">Location not found.</div>;
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
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/locations" className="hover:text-fg transition-colors">
                Locations
              </Link>
              {location.parent && (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <Link href={`/locations/${location.parent.id}`} className="hover:text-fg transition-colors">
                    {location.parent.name}
                  </Link>
                </>
              )}
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-fg font-medium truncate">{location.name}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-fg">{location.name}</h1>
                  <StatusIndicator category="locationType" value={location.type} label={locationTypeLabels[location.type] || location.type} />
                  {location.isDefault && (
                    <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                  )}
                </div>
                <p className="t-body text-fg-3">
                  {location.address || "No address"}
                  {location.parent && <> &middot; Sub-location of {location.parent.name}</>}
                </p>
              </div>
              <CanDo resource="location" action="update">
                <div className="flex gap-2">
                  <Button variant="outline" render={<Link href={`/locations/${id}/edit`} />}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive"
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
                    <EmptyState preset="assets" heading="No assets here" description="Assets checked in to this location will appear here." />
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset Tag</TableHead>
                            <TableHead>Name / Model</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {location.assets?.map((asset: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => (
                            <TableRow key={asset.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${asset.id}`} className="font-mono text-sm font-medium hover:underline">
                                  {asset.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{asset.model?.name || "\u2014"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">Serialized</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{assetStatusLabels[asset.status] || formatLabel(asset.status)}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {location.bulkAssets?.map((bulk: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => (
                            <TableRow key={bulk.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${bulk.id}`} className="font-mono text-sm font-medium hover:underline">
                                  {bulk.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{bulk.model?.name || "\u2014"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">Bulk</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{bulkAssetStatusLabels[bulk.status] || formatLabel(bulk.status)}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {location.kits?.map((kit: { id: string; assetTag: string; name: string; status: string }) => (
                            <TableRow key={kit.id}>
                              <TableCell>
                                <Link href={`/kits/${kit.id}`} className="font-mono text-sm font-medium hover:underline">
                                  {kit.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{kit.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">Kit</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{kitStatusLabels[kit.status] || formatLabel(kit.status)}</Badge>
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
                    <EmptyState preset="projects" heading="No projects here" description="Projects using this as a venue or delivery address will appear here." />
                  ) : (
                    <div className="rounded-md border">
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
                                <Link href={`/projects/${project.id}`} className="font-mono text-sm font-medium hover:underline">
                                  {project.projectNumber}
                                </Link>
                              </TableCell>
                              <TableCell>{project.name}</TableCell>
                              <TableCell className="text-fg-3">{project.client?.name || "\u2014"}</TableCell>
                              <TableCell>
                                <StatusIndicator category="project" value={project.status} label={projectStatusLabels[project.status] || formatLabel(project.status)} variant="pill" />
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
                    existingMedia={(location.media || []).filter((m) => m.file).map((m) => m as MediaItem)}
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
                {/* Location Info */}
                <SidebarSection title="Location Info">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Type</span>
                      <StatusIndicator category="locationType" value={location.type} label={locationTypeLabels[location.type] || location.type} />
                    </div>
                    {location.isDefault && (
                      <div className="flex justify-between">
                        <span className="text-fg-3">Default</span>
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                          <span className="font-medium">Yes</span>
                        </div>
                      </div>
                    )}
                    {location.address && (
                      <div className="flex justify-between">
                        <span className="text-fg-3">Address</span>
                        <span className="font-medium text-right max-w-[200px] truncate">{location.address}</span>
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {/* Parent Location */}
                {location.parent && (
                  <SidebarSection title="Parent Location">
                    <Link
                      href={`/locations/${location.parent.id}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-surface transition-colors"
                    >
                      <MapPin className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                      <span className="font-medium">{location.parent.name}</span>
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
                          className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-bg-surface transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <MapPin className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                            <span className="truncate">{child.name}</span>
                          </div>
                          <span className="text-xs text-fg-3 shrink-0">
                            {(child._count?.assets || 0) + (child._count?.bulkAssets || 0)} assets
                          </span>
                        </Link>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Asset Counts */}
                <SidebarSection title="Inventory">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-fg-3">
                        <Package className="h-3.5 w-3.5" />
                        <span>Serialized</span>
                      </div>
                      <span className="font-medium">{location._count?.assets || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-fg-3">
                        <Boxes className="h-3.5 w-3.5" />
                        <span>Bulk</span>
                      </div>
                      <span className="font-medium">{location._count?.bulkAssets || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-fg-3">
                        <Container className="h-3.5 w-3.5" />
                        <span>Kits</span>
                      </div>
                      <span className="font-medium">{location._count?.kits || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-fg-3">
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>Projects</span>
                      </div>
                      <span className="font-medium">{location._count?.projects || 0}</span>
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
