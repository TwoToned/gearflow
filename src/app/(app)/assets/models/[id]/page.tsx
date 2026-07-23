"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, useMemo, Suspense, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Pencil, Archive, Plus, Trash2, RotateCcw, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { useModelWrites } from "@/hooks/use-model-writes";
import { useBulkAssetWrites } from "@/hooks/use-bulk-asset-writes";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
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
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { resolveModelPhotoUrl } from "@/lib/media-utils";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { BookingCalendar } from "@/components/bookings/booking-calendar";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { ModelChecksTab } from "@/components/assets/model-checks-tab";
import { ModelRoiTab } from "@/components/assets/model-roi-tab";
import { ModelFailureAnalytics } from "@/components/assets/model-failure-analytics";
import { ModelAccessoriesManager } from "@/components/assets/model-accessories-manager";

import { assetStatusLabels, bulkAssetStatusLabels, formatLabel } from "@/lib/status-labels";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Panel } from "@/components/ui/card";
import { cn, focusRing } from "@/lib/utils";

export default function ModelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="model" action="read">
      <Suspense fallback={<DetailPageSkeleton />}>
        <ModelDetailContent params={params} />
      </Suspense>
    </RequirePermission>
  );
}

function ModelDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const warehouseWrites = useWarehouseWrites();

  const initialDate = useMemo(() => {
    const d = searchParams.get("date");
    if (!d) return null;
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return null;
    const parsed = new Date(y, m - 1, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }, [searchParams]);

  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const modelWrites = useModelWrites();
  const bulkWrites = useBulkAssetWrites();

  const { data: model, isLoading, refetch } = useServerQuery({
    queryKey: ["model", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.models.detail, { id }),
    enabled: !!orgId && isAuthenticated,
  });
  const media = useMediaWrites("model");

  const archiveMutation = useServerMutation({
    mutationFn: () => modelWrites.archive(id),
    onSuccess: () => {
      toast.success("Model archived");
      router.push("/assets/models");
    },
  });

  const archiveBulkMutation = useServerMutation({
    mutationFn: (bulkId: string) => bulkWrites.archive(bulkId),
    onSuccess: () => {
      toast.success("Bulk asset archived");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteBulkMutation = useServerMutation({
    mutationFn: (bulkId: string) => bulkWrites.remove(bulkId),
    onSuccess: () => {
      toast.success("Bulk asset deleted");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const forceReturnMutation = useServerMutation({
    mutationFn: (assetId: string) => warehouseWrites.forceReturnAsset(assetId),
    onSuccess: () => {
      toast.success("Asset force returned to available");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Standardized destructive confirmations.
  const [archiveModelOpen, setArchiveModelOpen] = useState(false);
  const [forceReturnAssetId, setForceReturnAssetId] = useState<{
    id: string;
    tag: string;
  } | null>(null);
  const [archiveBulkId, setArchiveBulkId] = useState<string | null>(null);
  const [deleteBulkId, setDeleteBulkId] = useState<string | null>(null);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!model) {
    return (
      <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Model not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/assets/models">Back to models</Link>
        </Button>
      </div>
    );
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

  // Mobile card layouts for the sub-tables (rendered below `md`).
  const serializedColumns: ColumnDef<(typeof model.assets)[number]>[] = [
    {
      id: "assetTag",
      header: "Asset tag",
      mobile: "title",
      cell: (asset) => (
        <Link href={`/assets/registry/${asset.id}`} className={cn("t-mono text-table-cell font-medium text-ink hover:underline rounded-sm", focusRing)}>
          {asset.assetTag}
        </Link>
      ),
    },
    {
      id: "name",
      header: "Name",
      mobile: "subtitle",
      cell: (asset) => <span className="text-ink">{asset.customName || "—"}</span>,
    },
    {
      id: "serial",
      header: "Serial #",
      mobile: "meta",
      cell: (asset) => <span className="t-mono text-table-cell text-muted">{asset.serialNumber || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (asset) => (
        <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} variant="pill" />
      ),
    },
    {
      id: "location",
      header: "Location",
      mobile: "meta",
      cell: (asset) => <span className="text-muted">{asset.location?.name || "—"}</span>,
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (asset) => (
        <CanDo resource="warehouse" action="check_in">
          {asset.status === "CHECKED_OUT" && (
            <Button
              variant="ghost"
              size="icon"
              className="touch-target h-7 w-7 text-warn"
              title="Force return"
              onClick={() =>
                setForceReturnAssetId({
                  id: asset.id,
                  tag: asset.assetTag,
                })
              }
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </CanDo>
      ),
    },
  ];

  const bulkColumns: ColumnDef<(typeof model.bulkAssets)[number]>[] = [
    {
      id: "assetTag",
      header: "Asset tag",
      mobile: "title",
      cell: (ba) => (
        <span className="t-mono text-table-cell font-medium text-ink">
          {ba.assetTag}
        </span>
      ),
    },
    {
      id: "available",
      header: "Available",
      mobile: "meta",
      cell: (ba) => <span className="font-medium text-ink t-data">{ba.availableQuantity}</span>,
    },
    {
      id: "total",
      header: "Total",
      mobile: "meta",
      cell: (ba) => <span className="text-muted t-data">{ba.totalQuantity}</span>,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (ba) => (
        <StatusIndicator category="asset" value={ba.status} label={bulkAssetStatusLabels[ba.status] || formatLabel(ba.status)} variant="pill" />
      ),
    },
    {
      id: "location",
      header: "Location",
      mobile: "meta",
      cell: (ba) => <span className="text-muted">{ba.location?.name || "—"}</span>,
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (ba) => (
        <CanDo resource="asset" action="update">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="touch-target h-7 w-7"
              title="Edit"
              asChild
            >
              <Link href={`/assets/registry/${ba.id}/edit?type=bulk`}>
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </Button>
            {ba.isActive ? (
              <Button
                variant="ghost"
                size="icon"
                className="touch-target h-7 w-7 text-t-out"
                title="Archive"
                onClick={() => setArchiveBulkId(ba.id)}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="touch-target h-7 w-7 text-t-out"
                title="Delete"
                onClick={() => setDeleteBulkId(ba.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CanDo>
      ),
    },
  ];

  return (
    <>
    <FadeIn>
      <PageMeta title={model?.name} />
      <div className="space-y-6">
        {/* ── Header (full width) ────────────────────────────────── */}
        <div>
          {/* Breadcrumb */}
          <nav className="mb-2 flex items-center gap-1 text-caption text-muted">
            <Link href="/assets/registry" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
              Assets
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/assets/models" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
              Models
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-ink-2">{model.name}</span>
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
                  <h1 className="t-title text-ink">{model.name}</h1>
                  <Badge status="neutral">
                    {model.assetType === "SERIALIZED" ? "Serialised" : "Bulk"}
                  </Badge>
                  {!model.isActive && <Badge status="repair">Archived</Badge>}
                </div>
                <p className="text-caption text-muted truncate">
                  {[model.manufacturer, model.modelNumber, model.sku && `SKU: ${model.sku}`].filter(Boolean).join(" — ") || "No manufacturer info"}
                  {model.category && <> &middot; {model.category.name}</>}
                </p>
              </div>
            </div>
            <CanDo resource="model" action="update">
              <div className="flex flex-wrap gap-2">
                <Button variant="line" size="sm" asChild>
                  <Link href={`/assets/registry/new?modelId=${model.id}&type=${model.assetType === "SERIALIZED" ? "serialized" : "bulk"}`}>
                    <Plus className="h-4 w-4" />
                    Create asset
                  </Link>
                </Button>
                <Button variant="line" size="sm" asChild>
                  <Link href={`/assets/models/${id}/edit`}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                </Button>
                {model.isActive && (
                  <Button
                    variant="line"
                    size="sm"
                    className="border-t-out/40 text-t-out hover:bg-out-soft hover:border-t-out"
                    onClick={() => setArchiveModelOpen(true)}
                  >
                    <Archive className="h-4 w-4" />
                    Archive
                  </Button>
                )}
              </div>
            </CanDo>
          </div>
        </div>

        {/* ── 2-Column Layout ────────────────────────────────────── */}
        <DetailLayout>
          {/* Main content (left) */}
          <DetailMain>
            {/* `?tab=roi` deep-links from the Fleet ROI table. */}
            <Tabs defaultValue={searchParams.get("tab") ?? "details"}>
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max sm:w-auto">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="assets">
                    Assets ({model.assets.length + model.bulkAssets.length})
                  </TabsTrigger>
                  <TabsTrigger value="photos">Photos ({photos.length})</TabsTrigger>
                  <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
                  <TabsTrigger value="checks">Checks</TabsTrigger>
                  <TabsTrigger value="roi">ROI</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="details" className="space-y-4 mt-4">
                <BookingCalendar entityType="model" entityId={id} initialDate={initialDate} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-[var(--r)] border border-line bg-card p-4 shadow-[var(--sh-card)]">
                    <p className="text-caption font-medium text-muted mb-3">Rate card</p>
                    <div className="space-y-1 text-table-cell text-ink">
                      <div className="flex justify-between">
                        <span className="text-muted">Daily</span>
                        <span className="font-medium t-data">
                          {model.dailyRate ? `$${Number(model.dailyRate).toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Weekly</span>
                        <span className="font-medium t-data">
                          {model.weeklyRate ? `$${Number(model.weeklyRate).toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Monthly</span>
                        <span className="font-medium t-data">
                          {model.monthlyRate ? `$${Number(model.monthlyRate).toFixed(2)}` : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[var(--r)] border border-line bg-card p-4 shadow-[var(--sh-card)]">
                    <p className="text-caption font-medium text-muted mb-3">Cost &amp; valuation</p>
                    <div className="space-y-1 text-table-cell text-ink">
                      <div className="flex justify-between">
                        <span className="text-muted">Purchase price</span>
                        <span className="font-medium t-data">
                          {model.defaultPurchasePrice ? `$${Number(model.defaultPurchasePrice).toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Replacement cost</span>
                        <span className="font-medium t-data">
                          {model.replacementCost ? `$${Number(model.replacementCost).toFixed(2)}` : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[var(--r)] border border-line bg-card p-4 shadow-[var(--sh-card)]">
                    <p className="text-caption font-medium text-muted mb-3">Technical</p>
                    <div className="space-y-1 text-table-cell text-ink">
                      <div className="flex justify-between">
                        <span className="text-muted">Weight</span>
                        <span className="font-medium">{model.weight ? `${Number(model.weight)} kg` : "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Power draw</span>
                        <span className="font-medium">{model.powerDraw ? `${model.powerDraw}W` : "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[var(--r)] border border-line bg-card p-4 shadow-[var(--sh-card)]">
                    <p className="text-caption font-medium text-muted mb-3">Maintenance</p>
                    <div className="space-y-1 text-table-cell text-ink">
                      <div className="flex justify-between">
                        <span className="text-muted">Requires T&amp;T</span>
                        <span className="font-medium">{model.requiresTestAndTag ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Maintenance interval</span>
                        <span className="font-medium">
                          {model.maintenanceIntervalDays ? `${model.maintenanceIntervalDays} days` : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                {model.description && (
                  <Panel padding="responsive">
                    <p className="text-caption font-medium text-muted mb-3">Description</p>
                    <p className="text-table-cell text-ink-2 whitespace-pre-wrap">{model.description}</p>
                  </Panel>
                )}
              </TabsContent>

              <TabsContent value="assets" className="mt-4">
                {model.assetType === "SERIALIZED" ? (
                  model.assets.length === 0 ? (
                    <EmptyState
                      title="No assets yet"
                      description="Create individual tracked assets from this model."
                      action={
                        <Button size="sm" asChild>
                          <Link href={`/assets/registry/new?modelId=${model.id}&type=serialized`}>
                            <Plus className="h-4 w-4" />
                            Create asset
                          </Link>
                        </Button>
                      }
                    />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line overflow-x-auto md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset tag</TableHead>
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
                                <Link href={`/assets/registry/${asset.id}`} className={cn("t-mono text-table-cell font-medium text-ink hover:underline rounded-sm", focusRing)}>
                                  {asset.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell className="text-ink">{asset.customName || "—"}</TableCell>
                              <TableCell className="t-mono text-table-cell text-muted">{asset.serialNumber || "—"}</TableCell>
                              <TableCell>
                                <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} variant="pill" />
                              </TableCell>
                              <TableCell className="text-muted">{asset.location?.name || "—"}</TableCell>
                              <TableCell className="text-right">
                                <CanDo resource="warehouse" action="check_in">
                                  {asset.status === "CHECKED_OUT" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="touch-target h-7 w-7 text-warn"
                                      title="Force return"
                                      onClick={() =>
                                        setForceReturnAssetId({
                                          id: asset.id,
                                          tag: asset.assetTag,
                                        })
                                      }
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
                    <MobileCardList
                      className="md:hidden"
                      data={model.assets}
                      columns={serializedColumns}
                      getRowId={(asset) => asset.id}
                    />
                    </>
                  )
                ) : (
                  model.bulkAssets.length === 0 ? (
                    <EmptyState
                      title="No bulk stock"
                      description="Create bulk quantity entries for this model."
                      action={
                        <Button size="sm" asChild>
                          <Link href={`/assets/registry/new?modelId=${model.id}&type=bulk`}>
                            <Plus className="h-4 w-4" />
                            Create bulk asset
                          </Link>
                        </Button>
                      }
                    />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line overflow-x-auto md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset tag</TableHead>
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
                                <span className="t-mono text-table-cell font-medium text-ink">
                                  {ba.assetTag}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-medium text-ink t-data">{ba.availableQuantity}</TableCell>
                              <TableCell className="text-right text-muted t-data">{ba.totalQuantity}</TableCell>
                              <TableCell>
                                <StatusIndicator category="asset" value={ba.status} label={bulkAssetStatusLabels[ba.status] || formatLabel(ba.status)} variant="pill" />
                              </TableCell>
                              <TableCell className="text-muted">{ba.location?.name || "—"}</TableCell>
                              <TableCell className="text-right">
                                <CanDo resource="asset" action="update">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="touch-target h-7 w-7"
                                      title="Edit"
                                      asChild
                                    >
                                      <Link href={`/assets/registry/${ba.id}/edit?type=bulk`}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Link>
                                    </Button>
                                    {ba.isActive ? (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="touch-target h-7 w-7 text-t-out"
                                        title="Archive"
                                        onClick={() => setArchiveBulkId(ba.id)}
                                      >
                                        <Archive className="h-3.5 w-3.5" />
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="touch-target h-7 w-7 text-t-out"
                                        title="Delete"
                                        onClick={() => setDeleteBulkId(ba.id)}
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
                    <MobileCardList
                      className="md:hidden"
                      data={model.bulkAssets}
                      columns={bulkColumns}
                      getRowId={(ba) => ba.id}
                    />
                    </>
                  )
                )}
              </TabsContent>

              <TabsContent value="photos" className="mt-4">
                <Panel padding="responsive">
                  <h3 className="t-heading text-ink mb-4">Model photos</h3>
                    <MediaUploader
                      entityType="model"
                      entityId={id}
                      accept="image/*"
                      existingMedia={photos}
                      onChanged={refetch}
                      onUploadComplete={async (fileUpload) => {
                        await media.add({ parentId: id, fileId: fileUpload.id, type: "PHOTO" });
                      }}
                      onRemove={async (mediaId) => {
                        await media.remove(mediaId);
                      }}
                      onSetPrimary={async (mediaId) => {
                        await media.setPrimary(id, mediaId);
                      }}
                      onReorder={async (orderedIds) => {
                        await media.reorder(orderedIds);
                      }}
                    />
                </Panel>
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <Panel padding="responsive">
                  <h3 className="t-heading text-ink mb-4">Manuals &amp; documents</h3>
                    <MediaUploader
                      entityType="model"
                      entityId={id}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                      existingMedia={documents}
                      onChanged={refetch}
                      onUploadComplete={async (fileUpload) => {
                        await media.add({ parentId: id, fileId: fileUpload.id, type: "MANUAL" });
                      }}
                      onRemove={async (mediaId) => {
                        await media.remove(mediaId);
                      }}
                    />
                </Panel>
              </TabsContent>

              <TabsContent value="checks" className="mt-4">
                <div className="space-y-6">
                  <ModelChecksTab modelId={id} />
                  <ModelFailureAnalytics modelId={id} />
                </div>
              </TabsContent>

              <TabsContent value="roi" className="mt-4">
                <ModelRoiTab modelId={id} />
              </TabsContent>
            </Tabs>
          </DetailMain>

          {/* ── Sidebar (right) ──────────────────────────────────── */}
          <DetailSidebar>
              {/* Photo */}
              {primaryPhotoUrl && (
                <div className="border-b border-line pb-4">
                  <MediaThumbnail
                    url={primaryPhotoUrl}
                    alt={model.name}
                    size={340}
                    className="w-full rounded-[var(--r)]"
                  />
                </div>
              )}

              {/* Model Info */}
              <SidebarSection title="Model info">
                <div className="space-y-1 text-table-cell">
                  {model.manufacturer && (
                    <div className="flex justify-between">
                      <span className="text-muted">Manufacturer</span>
                      <span className="font-medium text-ink">{model.manufacturer}</span>
                    </div>
                  )}
                  {model.modelNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted">Model number</span>
                      <span className="t-mono font-medium text-ink t-data">{model.modelNumber}</span>
                    </div>
                  )}
                  {model.sku && (
                    <div className="flex justify-between">
                      <span className="text-muted">SKU</span>
                      <span className="t-mono font-medium text-ink t-data">{model.sku}</span>
                    </div>
                  )}
                  {model.category && (
                    <div className="flex justify-between">
                      <span className="text-muted">Category</span>
                      <span className="font-medium text-ink">{model.category.name}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Asset type</span>
                    <span className="font-medium text-ink">{model.assetType === "SERIALIZED" ? "Serialised" : "Bulk"}</span>
                  </div>
                </div>
              </SidebarSection>

              {/* Specifications */}
              {Object.keys(specs).length > 0 && (
                <SidebarSection title="Specifications">
                  <div className="space-y-1 text-table-cell">
                    {Object.entries(specs).map(([key, val]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted">{key}</span>
                        <span className="font-medium text-ink t-data">{val}</span>
                      </div>
                    ))}
                  </div>
                </SidebarSection>
              )}

              {/* Asset Summary */}
              <SidebarSection title="Asset summary">
                <div className="space-y-1 text-table-cell">
                  <div className="flex justify-between">
                    <span className="text-muted">Total</span>
                    <span className="font-medium text-ink t-data">{totalAssets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Available</span>
                    <span className="font-medium t-data text-ok">{availableCount}</span>
                  </div>
                  {model.assetType === "SERIALIZED" && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted">Deployed</span>
                        <span className="font-medium text-ink t-data">{deployedCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">In maintenance</span>
                        <span className="font-medium text-ink t-data">{maintenanceCount}</span>
                      </div>
                    </>
                  )}
                </div>
              </SidebarSection>

              {/* Replacement Cost */}
              {model.replacementCost && (
                <SidebarSection title="Replacement cost">
                  <p className="text-[18px] font-semibold text-ink t-data">
                    ${Number(model.replacementCost).toFixed(2)}
                  </p>
                </SidebarSection>
              )}

              {/* Default accessories — every asset of this model inherits these */}
              <SidebarSection title="Accessories">
                <CanDo
                  resource="model"
                  action="update"
                  fallback={
                    model.bulkAccessories && model.bulkAccessories.length > 0 ? (
                      <ul className="space-y-1 text-table-cell">
                        {model.bulkAccessories.map((c) => (
                          <li key={c.id} className="flex items-center gap-2">
                            <span className="text-faint select-none">└─</span>
                            <span className="font-medium text-ink">
                              {c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-table-cell text-muted">No default accessories.</p>
                    )
                  }
                >
                  <ModelAccessoriesManager
                    modelId={id}
                    bulkAccessories={model.bulkAccessories ?? []}
                    onChanged={refetch}
                  />
                </CanDo>
              </SidebarSection>

              {/* Activity Timeline */}
              <SidebarSection title="Activity" divider={false}>
                <ActivityTimeline entityType="model" entityId={id} />
              </SidebarSection>
          </DetailSidebar>
        </DetailLayout>
      </div>
    </FadeIn>
    <DeleteDialog
      open={archiveModelOpen}
      onOpenChange={setArchiveModelOpen}
      title="Archive this model?"
      description="The model is hidden from new quotes and the catalog. Existing assets remain. You can restore it from the archived view."
      confirmLabel="Archive model"
      onConfirm={() => {
        archiveMutation.mutate();
        setArchiveModelOpen(false);
      }}
      pending={archiveMutation.isPending}
    />
    <DeleteDialog
      open={!!forceReturnAssetId}
      onOpenChange={(open) => !open && setForceReturnAssetId(null)}
      title={`Force return ${forceReturnAssetId?.tag ?? ""}?`}
      description="Project assignments are marked returned, status resets, and the asset returns to its home location. Use when scanning isn't possible."
      confirmLabel="Force return"
      onConfirm={() => {
        if (forceReturnAssetId) {
          forceReturnMutation.mutate(forceReturnAssetId.id);
          setForceReturnAssetId(null);
        }
      }}
      pending={forceReturnMutation.isPending}
    />
    <DeleteDialog
      open={!!archiveBulkId}
      onOpenChange={(open) => !open && setArchiveBulkId(null)}
      title="Archive this bulk asset?"
      description="Hidden from new quotes and warehouse pulls. Existing reservations remain. You can restore it later."
      confirmLabel="Archive bulk asset"
      onConfirm={() => {
        if (archiveBulkId) {
          archiveBulkMutation.mutate(archiveBulkId);
          setArchiveBulkId(null);
        }
      }}
      pending={archiveBulkMutation.isPending}
    />
    <DeleteDialog
      open={!!deleteBulkId}
      onOpenChange={(open) => !open && setDeleteBulkId(null)}
      title="Permanently delete this bulk asset?"
      description="This removes the bulk inventory record and its history. This cannot be undone."
      confirmLabel="Delete bulk asset"
      onConfirm={() => {
        if (deleteBulkId) {
          deleteBulkMutation.mutate(deleteBulkId);
          setDeleteBulkId(null);
        }
      }}
      pending={deleteBulkMutation.isPending}
    />
    </>
  );
}
