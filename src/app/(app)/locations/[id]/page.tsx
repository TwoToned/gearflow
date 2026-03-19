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
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getLocation, deleteLocation, updateLocationNotes } from "@/server/locations";
import { assetStatusLabels, bulkAssetStatusLabels, kitStatusLabels, projectStatusLabels, formatLabel } from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { addLocationMedia, removeLocationMedia } from "@/server/location-media";
import { NotesEditor } from "@/components/ui/notes-editor";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const typeLabels: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  VENUE: "Venue",
  VEHICLE: "Vehicle",
  OFFSITE: "Offsite",
};

const typeColors: Record<string, string> = {
  WAREHOUSE: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  VENUE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  VEHICLE: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  OFFSITE: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const projectStatusColors: Record<string, string> = {
  ENQUIRY: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  QUOTED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  PREPPING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  ON_SITE: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  COMPLETED: "bg-green-500/10 text-green-500 border-green-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
  INVOICED: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

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
    return <div className="text-muted-foreground py-12 text-center">Location not found.</div>;
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
            <Badge variant="outline" className={typeColors[location.type] || ""}>
              {typeLabels[location.type] || location.type}
            </Badge>
            {location.isDefault && (
              <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
            )}
          </div>
          <p className="text-muted-foreground">
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{location._count?.assets || 0}</span>
              <span className="text-sm text-muted-foreground">serialized</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bulk Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{location._count?.bulkAssets || 0}</span>
              <span className="text-sm text-muted-foreground">types</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Kits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Container className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{location._count?.kits || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{location._count?.projects || 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sub-locations */}
      {location.children && location.children.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Sub-locations ({location.children.length})
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {location.children.map((child: { id: string; name: string; _count?: { assets?: number; bulkAssets?: number } }) => (
                <Link
                  key={child.id}
                  href={`/locations/${child.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent/50"
                >
                  <span className="text-sm font-medium">{child.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(child._count?.assets || 0) + (child._count?.bulkAssets || 0)} assets
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Assets at this Location
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(location.assets?.length || 0) === 0 && (location.bulkAssets?.length || 0) === 0 && (location.kits?.length || 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No assets at this location.</p>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Projects at this Location
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(location.projects?.length || 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No projects at this location.</p>
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
                          <TableCell className="text-muted-foreground">{project.client?.name || "\u2014"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={projectStatusColors[project.status] || ""}>
                              {projectStatusLabels[project.status] || formatLabel(project.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(project.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Files</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </RequirePermission>
  );
}
