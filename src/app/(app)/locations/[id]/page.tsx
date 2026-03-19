"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Trash2,
  MapPin,
  Star,
  Package,
  Boxes,
  Container,
  FolderOpen,
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
import { Badge } from "@/components/ui/badge";
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
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: location, isLoading } = useQuery({
    queryKey: ["location", orgId, id],
    queryFn: () => getLocation(id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLocation(id),
    onSuccess: () => {
      toast.success("Location deleted");
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      router.push("/locations");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!location) {
    return <div className="text-fg-3 py-12 text-center">Location not found.</div>;
  }

  const assetCount = (location._count?.assets || 0) + (location._count?.bulkAssets || 0) + (location._count?.kits || 0);

  return (
    <RequirePermission resource="location" action="read">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="t-title text-fg">{location.name}</h1>
            <StatusIndicator category="locationType" value={location.type} label={locationTypeLabels[location.type] || location.type} />
            {location.isDefault && (
              <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
            )}
          </div>
          <p className="text-fg-3">
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
              onClick={() => { if (confirm("Delete this location? This cannot be undone.")) deleteMutation.mutate(); }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </CanDo>
      </div>

      {/* Address Map — inherit from parent if child has none */}
      <AddressDisplay
        address={location.address || location.parent?.address}
        latitude={location.latitude ?? location.parent?.latitude}
        longitude={location.longitude ?? location.parent?.longitude}
        label={location.name}
      />

      {/* Info Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-bg-surface p-4 surface-ring">
          <p className="text-[13px] font-medium text-fg-3 mb-3">Assets</p>
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-fg-3" />
              <span className="text-2xl font-bold">{location._count?.assets || 0}</span>
              <span className="text-sm text-fg-3">serialized</span>
            </div>
        </div>

        <div className="rounded-lg bg-bg-surface p-4 surface-ring">
          <p className="text-[13px] font-medium text-fg-3 mb-3">Bulk Assets</p>
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-fg-3" />
              <span className="text-2xl font-bold">{location._count?.bulkAssets || 0}</span>
              <span className="text-sm text-fg-3">types</span>
            </div>
        </div>

        <div className="rounded-lg bg-bg-surface p-4 surface-ring">
          <p className="text-[13px] font-medium text-fg-3 mb-3">Kits</p>
            <div className="flex items-center gap-2">
              <Container className="h-4 w-4 text-fg-3" />
              <span className="text-2xl font-bold">{location._count?.kits || 0}</span>
            </div>
        </div>

        <div className="rounded-lg bg-bg-surface p-4 surface-ring">
          <p className="text-[13px] font-medium text-fg-3 mb-3">Projects</p>
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-fg-3" />
              <span className="text-2xl font-bold">{location._count?.projects || 0}</span>
            </div>
        </div>
      </div>

      {/* Sub-locations */}
      {location.children && location.children.length > 0 && (
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Sub-locations ({location.children.length})
              </div>
          </h3>
            <div className="space-y-1">
              {location.children.map((child: { id: string; name: string; _count?: { assets?: number; bulkAssets?: number } }) => (
                <Link
                  key={child.id}
                  href={`/locations/${child.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent/50"
                >
                  <span className="text-sm font-medium">{child.name}</span>
                  <span className="text-xs text-fg-3">
                    {(child._count?.assets || 0) + (child._count?.bulkAssets || 0)} assets
                  </span>
                </Link>
              ))}
            </div>
        </div>
      )}

      {/* Tabs */}
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
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading text-fg mb-4">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Assets at this Location
                </div>
            </h3>
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
          </div>
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading text-fg mb-4">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Projects at this Location
                </div>
            </h3>
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
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesEditor
            initialNotes={location.notes || ""}
            queryKey={["location", orgId, id]}
            onSave={(notes) => updateLocationNotes(id, notes)}
            placeholder="Add notes about this location..."
          />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading text-fg mb-4">Files</h3>
              <MediaUploader
                entityType="location"
                entityId={id}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                existingMedia={(location.media || []).map((m: MediaItem) => m)}
                queryKey={["location", orgId, id]}
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
          </div>
        </TabsContent>
      </Tabs>
    </div>
    </RequirePermission>
  );
}
