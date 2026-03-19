"use client";

import { use, useMemo, Suspense } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Archive, Plus, Package, Trash2, RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
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
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { StatusIndicator } from "@/components/ui/status-indicator";

export default function ModelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<DetailPageSkeleton />}>
      <ModelDetailContent params={params} />
    </Suspense>
  );
}

function ModelDetailContent({ params }: { params: Promise<{ id: string }> }) {
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
    return <DetailPageSkeleton />;
  }

  if (!model) {
    return <div className="text-fg-3 py-12 text-center">Model not found.</div>;
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
            <h1 className="t-title text-fg">{model.name}</h1>
            <Badge variant={model.assetType === "SERIALIZED" ? "default" : "outline"}>
              {model.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}
            </Badge>
            {!model.isActive && <Badge variant="destructive">Archived</Badge>}
          </div>
          <p className="text-fg-3">
            {[model.manufacturer, model.modelNumber, model.sku && `SKU: ${model.sku}`].filter(Boolean).join(" — ") || "No manufacturer info"}
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
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <p className="text-[13px] font-medium text-fg-3 mb-3">Pricing</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Rental (per day)</span>
                  <span className="font-medium t-data">
                    {model.defaultRentalPrice ? `$${Number(model.defaultRentalPrice).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Purchase price</span>
                  <span className="font-medium t-data">
                    {model.defaultPurchasePrice ? `$${Number(model.defaultPurchasePrice).toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Replacement cost</span>
                  <span className="font-medium t-data">
                    {model.replacementCost ? `$${Number(model.replacementCost).toFixed(2)}` : "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <p className="text-[13px] font-medium text-fg-3 mb-3">Technical</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Weight</span>
                  <span className="font-medium">{model.weight ? `${Number(model.weight)} kg` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Power draw</span>
                  <span className="font-medium">{model.powerDraw ? `${model.powerDraw}W` : "—"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <p className="text-[13px] font-medium text-fg-3 mb-3">Maintenance</p>
              <div className="space-y-1 text-sm">
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
              </div>
            </div>
          </div>
          {model.description && (
            <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
              <p className="text-[13px] font-medium text-fg-3 mb-3">Description</p>
              <p className="text-sm whitespace-pre-wrap">{model.description}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="assets" className="mt-4">
          {model.assetType === "SERIALIZED" ? (
            model.assets.length === 0 ? (
              <EmptyState
                preset="assets"
                heading="No assets yet"
                description="Create individual tracked assets from this model."
                action={{ label: "Create Asset", onClick: () => window.location.href = `/assets/registry/new?modelId=${model.id}&type=serialized` }}
              />
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
                        <TableCell className="font-mono text-sm text-fg-3">{asset.serialNumber || "—"}</TableCell>
                        <TableCell>
                          <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} variant="pill" />
                        </TableCell>
                        <TableCell className="text-fg-3">{asset.location?.name || "—"}</TableCell>
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
              <EmptyState
                preset="assets"
                heading="No bulk stock"
                description="Create bulk quantity entries for this model."
                action={{ label: "Create Bulk Asset", onClick: () => window.location.href = `/assets/registry/new?modelId=${model.id}&type=bulk` }}
              />
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
                        <TableCell className="text-right font-medium t-data">{ba.availableQuantity}</TableCell>
                        <TableCell className="text-right text-fg-3 t-data">{ba.totalQuantity}</TableCell>
                        <TableCell>
                          <StatusIndicator category="asset" value={ba.status} label={bulkAssetStatusLabels[ba.status] || formatLabel(ba.status)} variant="pill" />
                        </TableCell>
                        <TableCell className="text-fg-3">{ba.location?.name || "—"}</TableCell>
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
            <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
              <p className="py-8 text-center text-sm text-fg-3">
                No specifications defined. Edit this model to add them.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                <div className="space-y-2">
                  {Object.entries(specs).map(([key, val]) => (
                    <div key={key} className="flex justify-between border-b pb-2 last:border-0">
                      <span className="text-sm text-fg-3">{key}</span>
                      <span className="text-sm font-medium">{val}</span>
                    </div>
                  ))}
                </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="photos" className="mt-4">
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading text-fg mb-4">Model Photos</h3>
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
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading text-fg mb-4">Manuals & Documents</h3>
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
          </div>
        </TabsContent>
      </Tabs>
    </div>
    </RequirePermission>
  );
}
