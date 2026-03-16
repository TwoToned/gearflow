"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Archive, Plus, Package, Trash2, RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import { getModel, archiveModel } from "@/server/models";
import { archiveBulkAsset, deleteBulkAsset } from "@/server/bulk-assets";
import { forceReturnAsset } from "@/server/warehouse";
import {
  addModelMedia,
  removeModelMedia,
  setModelPrimaryPhoto,
  reorderModelMedia,
} from "@/server/model-media";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { resolveModelPhotoUrl } from "@/lib/media-utils";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { BookingCalendar } from "@/components/bookings/booking-calendar";

import { assetStatusLabels, bulkAssetStatusLabels, formatLabel } from "@/lib/status-labels";

const statusColors: Record<string, string> = {
  AVAILABLE: "bg-green-500/10 text-green-500 border-green-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  IN_MAINTENANCE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  RESERVED: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETIRED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  LOST: "bg-red-500/10 text-red-500 border-red-500/20",
  ACTIVE: "bg-green-500/10 text-green-500 border-green-500/20",
  LOW_STOCK: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  OUT_OF_STOCK: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function ModelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const initialDate = useMemo(() => {
    const d = searchParams.get("date");
    if (!d) return null;
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return null;
    const parsed = new Date(y, m - 1, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }, [searchParams]);

  const { data: model, isLoading } = useQuery({
    queryKey: ["model", orgId, id],
    queryFn: () => getModel(id),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveModel(id),
    onSuccess: () => {
      toast.success("Model archived");
      queryClient.invalidateQueries({ queryKey: ["models"] });
      router.push("/assets/models");
    },
  });

  const archiveBulkMutation = useMutation({
    mutationFn: (bulkId: string) => archiveBulkAsset(bulkId),
    onSuccess: () => {
      toast.success("Bulk asset archived");
      queryClient.invalidateQueries({ queryKey: ["model", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["bulk-assets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteBulkMutation = useMutation({
    mutationFn: (bulkId: string) => deleteBulkAsset(bulkId),
    onSuccess: () => {
      toast.success("Bulk asset deleted");
      queryClient.invalidateQueries({ queryKey: ["model", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["bulk-assets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const forceReturnMutation = useMutation({
    mutationFn: (assetId: string) => forceReturnAsset(assetId),
    onSuccess: () => {
      toast.success("Asset force returned to available");
      queryClient.invalidateQueries({ queryKey: ["model", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  if (!model) {
    return <div className="text-muted-foreground">Model not found.</div>;
  }

  const specs = (model.specifications as Record<string, string>) || {};

  const photos = ((model.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const documents = ((model.media || []) as MediaItem[]).filter((m) => m.type !== "PHOTO");
  const primaryPhotoUrl = resolveModelPhotoUrl(model, false);

  return (
    <RequirePermission resource="model" action="read">
    <PageMeta title={model?.name} />
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <MediaThumbnail
            url={primaryPhotoUrl}
            alt={model.name}
            size={64}
            className="flex-shrink-0"
          />
          <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{model.name}</h1>
            <Badge variant={model.assetType === "SERIALIZED" ? "default" : "outline"}>
              {model.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}
            </Badge>
            {!model.isActive && <Badge variant="destructive">Archived</Badge>}
          </div>
          <p className="text-muted-foreground">
            {[model.manufacturer, model.modelNumber].filter(Boolean).join(" — ") || "No manufacturer info"}
            {model.category && <> &middot; {model.category.name}</>}
          </p>
          </div>
        </div>
        <CanDo resource="model" action="update">
          <div className="flex gap-2">
            <Button variant="outline" render={<Link href={`/assets/registry/new?modelId=${model.id}&type=${model.assetType === "SERIALIZED" ? "serialized" : "bulk"}`} />}>
              <Plus className="mr-2 h-4 w-4" />
              Create Asset
            </Button>
            <Button variant="outline" render={<Link href={`/assets/models/${id}/edit`} />}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            {model.isActive && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => { if (confirm("Archive this model?")) archiveMutation.mutate(); }}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </Button>
            )}
          </div>
        </CanDo>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="assets">
            Assets ({model.assets.length + model.bulkAssets.length})
          </TabsTrigger>
          <TabsTrigger value="specs">Specifications</TabsTrigger>
          <TabsTrigger value="photos">Photos ({photos.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4 mt-4">
          <BookingCalendar entityType="model" entityId={id} initialDate={initialDate} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Pricing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Rental (per day)</span>
                  <span className="font-medium">
                    {model.defaultRentalPrice ? `$${Number(model.defaultRentalPrice).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Purchase price</span>
                  <span className="font-medium">
                    {model.defaultPurchasePrice ? `$${Number(model.defaultPurchasePrice).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Replacement cost</span>
                  <span className="font-medium">
                    {model.replacementCost ? `$${Number(model.replacementCost).toFixed(2)}` : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Technical</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Weight</span>
                  <span className="font-medium">{model.weight ? `${Number(model.weight)} kg` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Power draw</span>
                  <span className="font-medium">{model.powerDraw ? `${model.powerDraw}W` : "—"}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Maintenance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Requires T&T</span>
                  <span className="font-medium">{model.requiresTestAndTag ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Maintenance interval</span>
                  <span className="font-medium">
                    {model.maintenanceIntervalDays ? `${model.maintenanceIntervalDays} days` : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
          {model.description && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{model.description}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="assets" className="mt-4">
          {model.assetType === "SERIALIZED" ? (
            model.assets.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-8">
                  <Package className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No assets created from this model yet.</p>
                  <Button size="sm" render={<Link href={`/assets/registry/new?modelId=${model.id}&type=serialized`} />}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Asset
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset Tag</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Serial #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.assets.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell>
                          <Link href={`/assets/registry/${asset.id}`} className="font-mono text-sm font-medium hover:underline">
                            {asset.assetTag}
                          </Link>
                        </TableCell>
                        <TableCell>{asset.customName || "—"}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{asset.serialNumber || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[asset.status] || ""}>
                            {assetStatusLabels[asset.status] || formatLabel(asset.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{asset.location?.name || "—"}</TableCell>
                        <TableCell className="text-right">
                          <CanDo resource="warehouse" action="check_in">
                            {asset.status === "CHECKED_OUT" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-amber-500"
                                title="Force Return"
                                onClick={() => {
                                  if (confirm(`Force return ${asset.assetTag} to available? This will reset its status and location.`))
                                    forceReturnMutation.mutate(asset.id);
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </CanDo>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            model.bulkAssets.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-8">
                  <Package className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No bulk stock entries for this model yet.</p>
                  <Button size="sm" render={<Link href={`/assets/registry/new?modelId=${model.id}&type=bulk`} />}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Bulk Asset
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset Tag</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.bulkAssets.map((ba) => (
                      <TableRow key={ba.id}>
                        <TableCell>
                          <span className="font-mono text-sm font-medium">
                            {ba.assetTag}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">{ba.availableQuantity}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{ba.totalQuantity}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[ba.status] || ""}>
                            {bulkAssetStatusLabels[ba.status] || formatLabel(ba.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{ba.location?.name || "—"}</TableCell>
                        <TableCell className="text-right">
                          <CanDo resource="asset" action="update">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                render={<Link href={`/assets/registry/${ba.id}/edit?type=bulk`} />}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {ba.isActive ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => {
                                    if (confirm("Archive this bulk asset?"))
                                      archiveBulkMutation.mutate(ba.id);
                                  }}
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => {
                                    if (confirm("Permanently delete this bulk asset?"))
                                      deleteBulkMutation.mutate(ba.id);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </CanDo>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </TabsContent>

        <TabsContent value="specs" className="mt-4">
          {Object.keys(specs).length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No specifications defined. Edit this model to add them.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  {Object.entries(specs).map(([key, val]) => (
                    <div key={key} className="flex justify-between border-b pb-2 last:border-0">
                      <span className="text-sm text-muted-foreground">{key}</span>
                      <span className="text-sm font-medium">{val}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="photos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model Photos</CardTitle>
            </CardHeader>
            <CardContent>
              <MediaUploader
                entityType="model"
                entityId={id}
                accept="image/*"
                existingMedia={photos}
                queryKey={["model", orgId, id]}
                onUploadComplete={async (fileUpload) => {
                  await addModelMedia({
                    modelId: id,
                    fileId: fileUpload.id,
                    type: "PHOTO",
                  });
                }}
                onRemove={async (mediaId) => {
                  await removeModelMedia(mediaId);
                }}
                onSetPrimary={async (mediaId) => {
                  await setModelPrimaryPhoto(id, mediaId);
                }}
                onReorder={async (orderedIds) => {
                  await reorderModelMedia(id, orderedIds);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manuals & Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <MediaUploader
                entityType="model"
                entityId={id}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                existingMedia={documents}
                queryKey={["model", orgId, id]}
                onUploadComplete={async (fileUpload) => {
                  await addModelMedia({
                    modelId: id,
                    fileId: fileUpload.id,
                    type: "MANUAL",
                  });
                }}
                onRemove={async (mediaId) => {
                  await removeModelMedia(mediaId);
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
