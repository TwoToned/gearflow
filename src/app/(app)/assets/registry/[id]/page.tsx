"use client";

import { use, Suspense, useEffect, useMemo } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronRight, Pencil, Trash2, FileText, RotateCcw, MapPin, Wrench, CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import { getAsset, archiveAsset, deleteAsset, updateAssetNotes } from "@/server/assets";
import { forceReturnAsset } from "@/server/warehouse";
import { getBulkAsset, archiveBulkAsset, deleteBulkAsset, updateBulkAssetNotes } from "@/server/bulk-assets";
import {
  addAssetMedia,
  removeAssetMedia,
  setAssetPrimaryPhoto,
} from "@/server/asset-media";
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
import { AssetQRCode } from "@/components/assets/asset-qr-code";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { NotesEditor } from "@/components/ui/notes-editor";
import { resolveAssetPhotoUrl, isAssetPhotoCustom } from "@/lib/media-utils";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { BookingCalendar } from "@/components/bookings/booking-calendar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";

import { assetStatusLabels, lineItemStatusLabels, maintenanceTypeLabels, maintenanceStatusLabels, mediaTypeLabels, conditionLabels, formatLabel } from "@/lib/status-labels";

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="asset" action="read">
    <Suspense fallback={<DetailPageSkeleton />}>
      <AssetDetailContent params={params} />
    </Suspense>
    </RequirePermission>
  );
}

function AssetDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const isBulk = searchParams.get("type") === "bulk";
  const router = useRouter();
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

  const assetQuery = useQuery({
    queryKey: ["asset", orgId, id],
    queryFn: () => getAsset(id),
    enabled: !isBulk,
  });

  const bulkQuery = useQuery({
    queryKey: ["bulk-asset", orgId, id],
    queryFn: () => getBulkAsset(id),
    enabled: isBulk,
  });

  const archiveMutation = useMutation({
    mutationFn: async () => { isBulk ? await archiveBulkAsset(id) : await archiveAsset(id); },
    onSuccess: () => {
      toast.success("Asset archived");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["bulk-assets"] });
      router.push("/assets/registry");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { isBulk ? await deleteBulkAsset(id) : await deleteAsset(id); },
    onSuccess: () => {
      toast.success("Asset deleted");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["bulk-assets"] });
      router.push("/assets/registry");
    },
    onError: (e) => toast.error(e.message),
  });

  const forceReturnMutation = useMutation({
    mutationFn: () => forceReturnAsset(id),
    onSuccess: () => {
      toast.success("Asset force returned to available");
      queryClient.invalidateQueries({ queryKey: ["asset", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Bulk Asset → Redirect to Model page ────────────────────────────
  const bulkModelId = isBulk ? bulkQuery.data?.modelId : null;
  useEffect(() => {
    if (bulkModelId) {
      router.replace(`/assets/models/${bulkModelId}`);
    }
  }, [bulkModelId, router]);

  const isLoading = isBulk ? bulkQuery.isLoading : assetQuery.isLoading;
  if (isLoading) return <DetailPageSkeleton />;

  if (isBulk) {
    if (!bulkQuery.data) return <div className="text-fg-3 py-12 text-center">Bulk asset not found.</div>;
    return <div className="text-fg-3">Redirecting to model...</div>;
  }

  // ─── Serialized Asset Detail ─────────────────────────────────────────
  const asset = assetQuery.data;
  if (!asset) return <div className="text-fg-3 py-12 text-center">Asset not found.</div>;

  const assetPhotos = ((asset.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const photoUrl = resolveAssetPhotoUrl(asset, false);
  const hasCustomPhoto = isAssetPhotoCustom(asset);

  // Gather specs from model
  const specs = (asset.model?.specifications || []) as Array<{ key: string; value: string }>;

  return (
    <FadeIn>
      <PageMeta title={asset ? `${asset.assetTag}${asset.customName ? ` — ${asset.customName}` : ""}` : undefined} />
      <div className="space-y-6">
        {/* ── Header (full width) ────────────────────────────────── */}
        <div>
          {/* Breadcrumb */}
          <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
            <Link href="/assets/registry" className="hover:text-fg transition-colors">
              Assets
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href="/assets/registry" className="hover:text-fg transition-colors">
              Registry
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="font-mono text-fg-2">{asset.assetTag}</span>
          </nav>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4 min-w-0">
              <MediaThumbnail
                url={photoUrl}
                alt={asset.assetTag}
                size={64}
                className="flex-shrink-0"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="t-title text-fg">
                    {asset.customName || asset.model.name}
                  </h1>
                  <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} />
                  <StatusIndicator category="condition" value={asset.condition} label={conditionLabels[asset.condition] || asset.condition} />
                </div>
                <p className="text-fg-3 truncate">
                  <span className="font-mono">{asset.assetTag}</span>
                  {asset.customName && <> &middot; {asset.customName}</>}
                  {" "}&middot;{" "}
                  <Link href={`/assets/models/${asset.modelId}`} className="hover:underline">
                    {asset.model.name}
                  </Link>
                  {asset.model.category && <> &middot; {asset.model.category.name}</>}
                </p>
              </div>
            </div>
            <CanDo resource="asset" action="update">
              <div className="flex flex-wrap gap-2">
                {asset.status === "CHECKED_OUT" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-amber-600"
                    onClick={() => { if (confirm("Force return this asset? All project assignments will be marked as returned.")) forceReturnMutation.mutate(); }}
                    disabled={forceReturnMutation.isPending}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Force Return
                  </Button>
                )}
                <Button variant="outline" size="sm" render={<Link href={`/assets/registry/${id}/edit`} />}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                {asset.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => { if (confirm("Archive this asset?")) archiveMutation.mutate(); }}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    Archive
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => { if (confirm("Permanently delete this asset? This cannot be undone.")) deleteMutation.mutate(); }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </CanDo>
          </div>
        </div>

        {/* ── 2-Column Layout ────────────────────────────────────── */}
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Main content */}
          <div className="min-w-0 flex-1">
            <Tabs defaultValue="availability">
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max sm:w-auto">
                  <TabsTrigger value="availability">Availability</TabsTrigger>
                  <TabsTrigger value="history">History ({asset.lineItems.length})</TabsTrigger>
                  <TabsTrigger value="maintenance">Maintenance ({asset.maintenanceLinks.length})</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="photos">Photos</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                  <TabsTrigger value="qr">QR</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="availability" className="mt-4">
                <BookingCalendar entityType="asset" entityId={id} modelId={asset.modelId} initialDate={initialDate} />
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                {asset.lineItems.length === 0 ? (
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <p className="py-8 text-center text-sm text-fg-3">
                      This asset hasn&apos;t been assigned to any projects yet.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="hidden sm:table-cell">Deployed</TableHead>
                          <TableHead className="hidden sm:table-cell">Returned</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {asset.lineItems.map((li) => (
                          <TableRow key={li.id}>
                            <TableCell>
                              <Link href={`/projects/${li.projectId}`} className="hover:underline">
                                {li.project.name}
                              </Link>
                              <p className="text-xs text-fg-3">{li.project.projectNumber}</p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{lineItemStatusLabels[li.status] || formatLabel(li.status)}</Badge>
                            </TableCell>
                            <TableCell className="text-sm hidden sm:table-cell">{formatDate(li.checkedOutAt)}</TableCell>
                            <TableCell className="text-sm hidden sm:table-cell">{formatDate(li.returnedAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="maintenance" className="mt-4">
                {asset.maintenanceLinks.length === 0 ? (
                  <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                    <p className="py-8 text-center text-sm text-fg-3">
                      No maintenance records for this asset.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="hidden sm:table-cell">Date</TableHead>
                          <TableHead className="hidden sm:table-cell">Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {asset.maintenanceLinks.map((link) => {
                          const mr = link.maintenanceRecord;
                          return (
                            <TableRow key={mr.id}>
                              <TableCell className="font-medium">{mr.title}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{maintenanceTypeLabels[mr.type] || formatLabel(mr.type)}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{maintenanceStatusLabels[mr.status] || formatLabel(mr.status)}</Badge>
                              </TableCell>
                              <TableCell className="text-sm hidden sm:table-cell">
                                {formatDate(mr.completedDate || mr.scheduledDate)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                {mr.result ? (
                                  <Badge variant={mr.result === "PASS" ? "default" : "destructive"}>
                                    {mr.result}
                                  </Badge>
                                ) : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <NotesEditor
                  initialNotes={asset.notes || ""}
                  queryKey={["asset", orgId, id]}
                  onSave={(notes) => updateAssetNotes(id, notes)}
                  placeholder="Add notes about this asset..."
                />
              </TabsContent>

              <TabsContent value="photos" className="mt-4">
                <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                  <h3 className="t-heading text-fg mb-4">
                    Asset Photos
                    {!hasCustomPhoto && photoUrl && (
                      <span className="ml-2 text-xs font-normal text-fg-3">
                        Showing model photo — upload a custom photo to override
                      </span>
                    )}
                    {hasCustomPhoto && (
                      <span className="ml-2 text-xs font-normal text-fg-3">
                        Custom photo — remove to revert to model photo
                      </span>
                    )}
                  </h3>
                  <MediaUploader
                    entityType="asset"
                    entityId={id}
                    accept="image/*"
                    existingMedia={assetPhotos}
                    queryKey={["asset", orgId, id]}
                    onUploadComplete={async (fileUpload) => {
                      await addAssetMedia({
                        assetId: id,
                        fileId: fileUpload.id,
                        type: "PHOTO",
                      });
                    }}
                    onRemove={async (mediaId) => {
                      await removeAssetMedia(mediaId);
                    }}
                    onSetPrimary={async (mediaId) => {
                      await setAssetPrimaryPhoto(id, mediaId);
                    }}
                  />
                </div>
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                  <h3 className="t-heading text-fg mb-4">
                    Model Documents
                    <span className="ml-2 text-xs font-normal text-fg-3">
                      From {asset.model.name} — manage on the model page
                    </span>
                  </h3>
                  {(() => {
                    const modelDocs = (asset.model?.media || []).filter((m: MediaItem) => m.type !== "PHOTO");
                    if (modelDocs.length === 0) {
                      return (
                        <p className="text-sm text-fg-3 py-4 text-center">
                          No documents attached to this model.
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        {modelDocs.map((doc: MediaItem) => (
                          <a
                            key={doc.id}
                            href={doc.file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                          >
                            <FileText className="h-5 w-5 text-fg-3" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {doc.displayName || doc.file.fileName}
                              </p>
                              <p className="text-xs text-fg-3">
                                {mediaTypeLabels[doc.type] || formatLabel(doc.type)} — {(doc.file.fileSize / 1024).toFixed(0)} KB
                              </p>
                            </div>
                          </a>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </TabsContent>

              <TabsContent value="qr" className="mt-4">
                <div className="max-w-xs">
                  <AssetQRCode
                    assetTag={asset.assetTag}
                    label={`${asset.assetTag}${asset.customName ? ` — ${asset.customName}` : ""}`}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* ── Sidebar ──────────────────────────────────────────── */}
          <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
            <div className="lg:sticky lg:top-4 space-y-4">
              {/* Status */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Status" />
                <div className="flex items-center gap-2">
                  <StatusIndicator
                    category="asset"
                    value={asset.status}
                    label={assetStatusLabels[asset.status] || formatLabel(asset.status)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <StatusIndicator
                    category="condition"
                    value={asset.condition}
                    label={conditionLabels[asset.condition] || asset.condition}
                  />
                </div>
              </div>

              {/* Asset Info */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Asset Info" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Asset Tag</span>
                    <span className="font-mono font-medium t-data">{asset.assetTag}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Serial Number</span>
                    <span className="font-mono font-medium t-data">{asset.serialNumber || "—"}</span>
                  </div>
                  {asset.customName && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Custom Name</span>
                      <span className="font-medium">{asset.customName}</span>
                    </div>
                  )}
                  {asset.barcode && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Barcode</span>
                      <span className="font-mono font-medium t-data">{asset.barcode}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-fg-3">Model</span>
                    <Link href={`/assets/models/${asset.modelId}`} className="font-medium hover:underline truncate ml-2 text-right">
                      {asset.model.name}
                    </Link>
                  </div>
                  {asset.model.category && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Category</span>
                      <span className="font-medium">{asset.model.category.name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Purchase */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Purchase" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Date</span>
                    <span className="font-medium">{formatDate(asset.purchaseDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Price</span>
                    <span className="font-medium t-data">
                      {asset.purchasePrice ? `$${Number(asset.purchasePrice).toFixed(2)}` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Supplier</span>
                    <span className="font-medium">{asset.supplier?.name || asset.purchaseSupplier || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Warranty</span>
                    <span className="font-medium">{formatDate(asset.warrantyExpiry)}</span>
                  </div>
                </div>
              </div>

              {/* Location */}
              {asset.location && (
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Location" />
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                    <span className="font-medium">{asset.location.name}</span>
                  </div>
                </div>
              )}

              {/* Specifications */}
              {specs.length > 0 && (
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Specifications" />
                  <div className="space-y-1 text-sm">
                    {specs.map((spec, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="text-fg-3">{spec.key}</span>
                        <span className="font-medium t-data">{spec.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Test & Tag / Maintenance */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Test & Tag" />
                {asset.testTagAsset ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Status</span>
                      <span className="font-medium">{asset.testTagAsset.status?.replace(/_/g, " ") || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3 flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Last tested
                      </span>
                      <span className="font-medium">{formatDate(asset.testTagAsset.lastTestDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3 flex items-center gap-1">
                        <Wrench className="h-3.5 w-3.5" />
                        Next due
                      </span>
                      <span className="font-medium">{formatDate(asset.testTagAsset.nextDueDate)}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      render={<Link href={`/test-and-tag/${asset.testTagAsset.id}`} />}
                    >
                      View T&T Details
                    </Button>
                  </div>
                ) : (
                  <div className="text-sm">
                    <p className="text-fg-3">Not registered</p>
                    {asset.model?.requiresTestAndTag && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        render={<Link href={`/test-and-tag/new?assetId=${asset.id}`} />}
                      >
                        Register for T&T
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Activity */}
              <div className="space-y-2">
                <SectionHeader label="Activity" />
                <ActivityTimeline entityType="asset" entityId={id} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
