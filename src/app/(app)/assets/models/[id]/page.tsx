"use client";

import { use, useMemo, Suspense } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Archive, Plus, Trash2, RotateCcw, ChevronRight } from "lucide-react";
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
import { FadeIn } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { ModelChecksTab } from "@/components/assets/model-checks-tab";
import { ModelFailureAnalytics } from "@/components/assets/model-failure-analytics";

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

  // Asset summary counts
  const serializedCount = model.assets.length;
  const bulkTotalQty = model.bulkAssets.reduce((sum, ba) => sum + (ba.totalQuantity ?? 0), 0);
  const totalAssets = serializedCount + bulkTotalQty;

  const availableSerialised = model.assets.filter((a) => a.status === "AVAILABLE").length;
  const availableBulk = model.bulkAssets.reduce((sum, ba) => sum + (ba.availableQuantity ?? 0), 0);
  const availableCount = availableSerialised + availableBulk;

  const deployedCount = model.assets.filter((a) => a.status === "CHECKED_OUT").length;
  const maintenanceCount = model.assets.filter((a) => a.status === "IN_MAINTENANCE").length;

  return (
    <RequirePermission resource="model" action="read">
    <FadeIn>
      <PageMeta title={model?.name} />
      <div className="space-y-6">
        {/* ── Header (full width) ────────────────────────────────── */}
        <div>
          {/* Breadcrumb */}
          <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
            <Link href="/assets/registry" className="hover:text-fg transition-colors">
              Assets
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href="/assets/models" className="hover:text-fg transition-colors">
              Models
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-fg-2">{model.name}</span>
          </nav>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4 min-w-0">
              <MediaThumbnail
                url={primaryPhotoUrl}
                alt={model.name}
                size={64}
                className="flex-shrink-0"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="t-title text-fg">{model.name}</h1>
                  <Badge variant={model.assetType === "SERIALIZED" ? "default" : "outline"}>
                    {model.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}
                  </Badge>
                  {!model.isActive && <Badge variant="destructive">Archived</Badge>}
                </div>
                <p className="text-fg-3 truncate">
                  {[model.manufacturer, model.modelNumber, model.sku && `SKU: ${model.sku}`].filter(Boolean).join(" — ") || "No manufacturer info"}
                  {model.category && <> &middot; {model.category.name}</>}
                </p>
              </div>
            </div>
            <CanDo resource="model" action="update">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" render={<Link href={`/assets/registry/new?modelId=${model.id}&type=${model.assetType === "SERIALIZED" ? "serialized" : "bulk"}`} />}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Asset
                </Button>
                <Button variant="outline" size="sm" render={<Link href={`/assets/models/${id}/edit`} />}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                {model.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
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
        </div>

        {/* ── 2-Column Layout ────────────────────────────────────── */}
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Main content (left) */}
          <div className="min-w-0 flex-1">
            <Tabs defaultValue="details">
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max sm:w-auto">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="assets">
                    Assets ({model.assets.length + model.bulkAssets.length})
                  </TabsTrigger>
                  <TabsTrigger value="photos">Photos ({photos.length})</TabsTrigger>
                  <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
                  <TabsTrigger value="checks">Checks</TabsTrigger>
                </TabsList>
              </div>

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

              <TabsContent value="checks" className="mt-4">
                <div className="space-y-6">
                  <ModelChecksTab modelId={id} />
                  <ModelFailureAnalytics modelId={id} />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* ── Sidebar (right) ──────────────────────────────────── */}
          <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
            <div className="lg:sticky lg:top-4 space-y-4">
              {/* Photo */}
              {primaryPhotoUrl && (
                <div className="border-b border-border pb-4">
                  <MediaThumbnail
                    url={primaryPhotoUrl}
                    alt={model.name}
                    size={340}
                    className="w-full rounded-lg"
                  />
                </div>
              )}

              {/* Model Info */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Model Info" />
                <div className="space-y-1 text-sm">
                  {model.manufacturer && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Manufacturer</span>
                      <span className="font-medium">{model.manufacturer}</span>
                    </div>
                  )}
                  {model.modelNumber && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Model Number</span>
                      <span className="font-mono font-medium t-data">{model.modelNumber}</span>
                    </div>
                  )}
                  {model.sku && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">SKU</span>
                      <span className="font-mono font-medium t-data">{model.sku}</span>
                    </div>
                  )}
                  {model.category && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Category</span>
                      <span className="font-medium">{model.category.name}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-fg-3">Asset Type</span>
                    <span className="font-medium">{model.assetType === "SERIALIZED" ? "Serialized" : "Bulk"}</span>
                  </div>
                </div>
              </div>

              {/* Specifications */}
              {Object.keys(specs).length > 0 && (
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Specifications" />
                  <div className="space-y-1 text-sm">
                    {Object.entries(specs).map(([key, val]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-fg-3">{key}</span>
                        <span className="font-medium t-data">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Asset Summary */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Asset Summary" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Total</span>
                    <span className="font-medium t-data">{totalAssets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Available</span>
                    <span className="font-medium t-data text-emerald-500">{availableCount}</span>
                  </div>
                  {model.assetType === "SERIALIZED" && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-fg-3">Deployed</span>
                        <span className="font-medium t-data">{deployedCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-fg-3">In Maintenance</span>
                        <span className="font-medium t-data">{maintenanceCount}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Replacement Cost */}
              {model.replacementCost && (
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Replacement Cost" />
                  <p className="text-lg font-semibold t-data">
                    ${Number(model.replacementCost).toFixed(2)}
                  </p>
                </div>
              )}

              {/* Activity Timeline */}
              <div className="space-y-2">
                <SectionHeader label="Activity" />
                <ActivityTimeline entityType="model" entityId={id} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
    </RequirePermission>
  );
}
