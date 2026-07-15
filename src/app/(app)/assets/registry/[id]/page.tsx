"use client";

import { use, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useSearchParams } from "next/navigation";
import { useNativeAsset } from "@/hooks/use-native-asset";
import { useOptimisticAssetNotes } from "@/hooks/use-native-asset-writes";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Archive,
  ChevronRight,
  Pencil,
  Trash2,
  FileText,
  RotateCcw,
  MapPin,
  Wrench,
  CalendarClock,
  Cable,
  QrCode,
  MoreHorizontal,
  Briefcase,
  PackageCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";

import { getAsset, archiveAsset, deleteAsset, updateAssetNotes } from "@/server/assets";
import { AssetChecksTab } from "@/components/assets/asset-checks-tab";
import { AssetAccessoriesManager } from "@/components/assets/asset-accessories-manager";
import { forceReturnAsset } from "@/server/warehouse";
import { getBulkAsset, archiveBulkAsset, deleteBulkAsset } from "@/server/bulk-assets";
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
import { AssetQRCode } from "@/components/assets/asset-qr-code";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { NotesEditor } from "@/components/ui/notes-editor";
import { resolveAssetPhotoUrl, isAssetPhotoCustom } from "@/lib/media-utils";
import { CanDo } from "@/components/auth/permission-gate";
import { PresenceAvatarStack } from "@/components/collaboration/presence-avatar-stack";
import { EntityCommentsButton } from "@/components/collaboration/entity-comments-button";
import { RequirePermission } from "@/components/auth/require-permission";
import { BookingCalendar } from "@/components/bookings/booking-calendar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { CustomFieldsDisplay } from "@/components/custom-fields/custom-fields-display";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";

import { assetStatusLabels, lineItemStatusLabels, maintenanceTypeLabels, maintenanceStatusLabels, mediaTypeLabels, conditionLabels, formatLabel } from "@/lib/status-labels";
import { formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";

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

  // Native asset-detail read (Phase 4 — the version-vector server-action path is
  // retired). ONE live `assetDetail.bundle` subscription reconstructs the getAsset
  // shape client-side (serialized assets only — the bulk path redirects to the model
  // page and loads via a plain useServerQuery below), reactive over the WebSocket.
  // Writes are still server actions whose `convex.mutation` pushes the delta to this
  // subscription, so the historic post-mutation refetch calls are redundant —
  // `refetchAsset` is kept as a no-op (belt-and-braces) to avoid touching call sites.
  const native = useNativeAsset(isBulk ? undefined : id, orgId);
  const media = useMediaWrites("asset");
  // Phase 5d — optimistic native notes write (flag-gated, default off).
  const optimisticNotes = useOptimisticAssetNotes(id, orgId);
  // Thin DTO of the getAsset shape (the page reads only produced fields); cast to the
  // server type so the page's typed field access is preserved.
  type AssetDetail = Awaited<ReturnType<typeof getAsset>>;
  const asset = native.data as unknown as AssetDetail | undefined;
  const assetLoading = !isBulk && native.isLoading;
  const refetchAsset = useCallback(() => {}, []);

  const { data: bulkAsset, isLoading: bulkLoading } = useServerQuery({
    queryKey: ["bulk-asset", orgId, id],
    queryFn: () => getBulkAsset(id),
    enabled: isBulk,
  });

  const archiveMutation = useServerMutation({
    mutationFn: async () => { isBulk ? await archiveBulkAsset(id) : await archiveAsset(id); },
    onSuccess: () => {
      toast.success("Asset archived");
      router.push("/assets/registry");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: async () => { isBulk ? await deleteBulkAsset(id) : await deleteAsset(id); },
    onSuccess: () => {
      toast.success("Asset deleted");
      router.push("/assets/registry");
    },
    onError: (e) => toast.error(e.message),
  });

  const forceReturnMutation = useServerMutation({
    mutationFn: () => forceReturnAsset(id),
    onSuccess: () => {
      toast.success("Asset force returned to available");
      refetchAsset();
    },
    onError: (e) => toast.error(e.message),
  });

  const [forceReturnOpen, setForceReturnOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ─── Bulk Asset → Redirect to Model page ────────────────────────────
  const bulkModelId = isBulk ? bulkAsset?.modelId : null;
  useEffect(() => {
    if (bulkModelId) {
      router.replace(`/assets/models/${bulkModelId}`);
    }
  }, [bulkModelId, router]);

  const isLoading = isBulk ? bulkLoading : assetLoading;
  if (isLoading) return <DetailPageSkeleton />;

  if (isBulk) {
    if (!bulkAsset) {
      return (
        <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Bulk asset not found.</p>
          <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
          <Button variant="line" size="sm" className="mt-4" asChild>
            <Link href="/assets/registry">Back to registry</Link>
          </Button>
        </div>
      );
    }
    return <div className="text-table-cell text-muted">Redirecting to model…</div>;
  }

  // ─── Serialized Asset Detail ─────────────────────────────────────────
  if (!asset) {
    return (
      <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Asset not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/assets/registry">Back to registry</Link>
        </Button>
      </div>
    );
  }

  const assetPhotos = ((asset.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const photoUrl = resolveAssetPhotoUrl({ ...asset, model: asset.model ?? undefined }, false);
  const hasCustomPhoto = isAssetPhotoCustom(asset);

  // Gather specs from model
  const specs = (asset.model?.specifications || []) as Array<{ key: string; value: string }>;

  // Model documents (used both in the Files tab and the sidebar count is implicit)
  const modelDocs = ((asset.model?.media || []) as MediaItem[]).filter((m) => m.type !== "PHOTO");

  // ── "Where is it now?" — the #1 question for a physical unit ──────────
  // CHECKED_OUT → the active (not-yet-returned) project assignment.
  const activeLineItem =
    asset.status === "CHECKED_OUT"
      ? asset.lineItems.find((li) => li.status === "CHECKED_OUT" && !li.returnedAt) ??
        asset.lineItems.find((li) => li.status === "CHECKED_OUT")
      : null;
  const homeLocationName = asset.location?.name ?? null;
  const whereIsIt: { icon: typeof Briefcase; node: React.ReactNode } = (() => {
    if (asset.status === "CHECKED_OUT" && activeLineItem) {
      return {
        icon: Briefcase,
        node: (
          <span>
            Deployed on{" "}
            <Link
              href={`/projects/${activeLineItem.projectId}`}
              className={cn("font-semibold text-ink hover:text-link hover:underline rounded-sm", focusRing)}
            >
              {activeLineItem.project.name}
            </Link>
            <span className="t-mono text-muted"> · {activeLineItem.project.projectNumber}</span>
          </span>
        ),
      };
    }
    if (asset.status === "IN_MAINTENANCE") {
      return {
        icon: Wrench,
        node: (
          <span className="text-ink-2">
            In maintenance{homeLocationName ? <span className="text-muted"> · home: {homeLocationName}</span> : null}
          </span>
        ),
      };
    }
    if (asset.status === "AVAILABLE") {
      return {
        icon: PackageCheck,
        node: (
          <span className="text-ink-2">
            Available{homeLocationName ? <> · <span className="font-semibold text-ink">{homeLocationName}</span></> : <span className="text-muted"> · no home location set</span>}
          </span>
        ),
      };
    }
    // RESERVED / RETIRED / LOST and any other state — surface status + home location.
    return {
      icon: MapPin,
      node: (
        <span className="text-ink-2">
          {assetStatusLabels[asset.status] || formatLabel(asset.status)}
          {homeLocationName ? <span className="text-muted"> · {homeLocationName}</span> : null}
        </span>
      ),
    };
  })();
  const WhereIcon = whereIsIt.icon;

  // Mobile card layout for the maintenance-history sub-table (rendered below `md`).
  const maintenanceColumns: ColumnDef<(typeof asset.maintenanceLinks)[number]>[] = [
    {
      id: "title",
      header: "Title",
      mobile: "title",
      cell: (link) => <span className="font-medium text-ink">{link.maintenanceRecord.title}</span>,
    },
    {
      id: "type",
      header: "Type",
      mobile: "subtitle",
      cell: (link) => (
        <Badge status="neutral">
          {maintenanceTypeLabels[link.maintenanceRecord.type] || formatLabel(link.maintenanceRecord.type)}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (link) => (
        <StatusIndicator
          category="maintenance"
          value={link.maintenanceRecord.status}
          label={maintenanceStatusLabels[link.maintenanceRecord.status] || formatLabel(link.maintenanceRecord.status)}
          variant="pill"
        />
      ),
    },
    {
      id: "date",
      header: "Date",
      mobile: "meta",
      cell: (link) => (
        <span className="tabular-nums">
          {formatDate(link.maintenanceRecord.completedDate || link.maintenanceRecord.scheduledDate)}
        </span>
      ),
    },
    {
      id: "result",
      header: "Result",
      mobile: "meta",
      mobileEmpty: (link) => !link.maintenanceRecord.result,
      cell: (link) =>
        link.maintenanceRecord.result ? (
          <Badge status={link.maintenanceRecord.result === "PASS" ? "ok" : "overbooked"}>
            {link.maintenanceRecord.result === "PASS" ? "Pass" : formatLabel(link.maintenanceRecord.result)}
          </Badge>
        ) : (
          <span className="text-faint">{"—"}</span>
        ),
    },
  ];

  return (
    <FadeIn>
      <PageMeta title={asset ? `${asset.assetTag}${asset.customName ? ` — ${asset.customName}` : ""}` : undefined} />
      <div className="space-y-6">
        {/* ── Hero card (breadcrumb + identity/where-is-it + actions) ── */}
        <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] space-y-4 sm:p-5">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-caption text-muted">
            <Link href="/assets/registry" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
              Assets
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/assets/registry" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
              Registry
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="t-mono text-ink-2">{asset.assetTag}</span>
          </nav>

          {/* Identity + actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-4">
              <MediaThumbnail
                url={photoUrl}
                alt={asset.assetTag}
                size={72}
                className="flex-shrink-0"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-page-title font-extrabold text-ink truncate">
                    {asset.customName || asset.model?.name || "Untitled asset"}
                  </h1>
                  <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} />
                  <StatusIndicator category="condition" value={asset.condition} label={conditionLabels[asset.condition] || asset.condition} />
                </div>
                {/* Meta line: tag · category · brand/model */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  <span className="t-mono text-ink-2">{asset.assetTag}</span>
                  {asset.model?.category && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <span>{asset.model.category.name}</span>
                    </>
                  )}
                  <span aria-hidden>&middot;</span>
                  <Link href={`/assets/models/${asset.modelId}`} className={cn("hover:text-ink-2 hover:underline rounded-sm", focusRing)}>
                    {asset.model?.name || "Model"}
                  </Link>
                  {orgId && (
                    <PresenceAvatarStack entityType="asset" entityId={id} size="sm" />
                  )}
                </div>
                {/* "Where is it now?" — the prominent locator line */}
                <div className="mt-3 inline-flex items-center gap-2 rounded-[var(--r)] border border-line bg-paper-2 px-3 py-1.5 text-ui-text">
                  <WhereIcon className="h-4 w-4 text-muted shrink-0" aria-hidden />
                  {whereIsIt.node}
                </div>
              </div>
            </div>

            {/* Action buttons (compact) */}
            <div className="flex flex-wrap items-center gap-2">
              {orgId && (
                <EntityCommentsButton orgId={orgId} entityType="asset" entityId={id} />
              )}
              {/* QR — moved out of the tabs into a hero popover action */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="line" size="sm" aria-label="Show QR code">
                    <QrCode className="h-4 w-4" />
                    <span className="hidden sm:inline">QR</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-3">
                  <div className="max-w-xs">
                    <AssetQRCode
                      assetTag={asset.assetTag}
                      label={`${asset.assetTag}${asset.customName ? ` — ${asset.customName}` : ""}`}
                    />
                  </div>
                </PopoverContent>
              </Popover>
              <CanDo resource="asset" action="update">
                <Button variant="line" size="sm" asChild>
                  <Link href={`/assets/registry/${id}/edit`}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                </Button>
                {/* Overflow ⋯ — force-return / archive / delete */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="line" size="sm" aria-label="More actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {asset.status === "CHECKED_OUT" && (
                      <DropdownMenuItem
                        onClick={() => setForceReturnOpen(true)}
                        disabled={forceReturnMutation.isPending}
                        className="text-warn data-[highlighted]:bg-warn-soft data-[highlighted]:text-warn"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Force return
                      </DropdownMenuItem>
                    )}
                    {asset.isActive && (
                      <DropdownMenuItem
                        onClick={() => setArchiveOpen(true)}
                        className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        Archive
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      disabled={deleteMutation.isPending}
                      className="text-red data-[highlighted]:bg-red data-[highlighted]:text-white"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CanDo>
            </div>
          </div>
        </div>

        {/* ── 2-Column Layout ────────────────────────────────────── */}
        <DetailLayout>
          {/* Main content */}
          <DetailMain>
            <Tabs defaultValue="history">
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max sm:w-auto">
                  <TabsTrigger value="history">History ({asset.lineItems.length})</TabsTrigger>
                  <TabsTrigger value="availability">Availability</TabsTrigger>
                  <TabsTrigger value="maintenance">Maintenance ({asset.maintenanceLinks.length})</TabsTrigger>
                  <TabsTrigger value="checks">Checks</TabsTrigger>
                  <TabsTrigger value="files">Files ({assetPhotos.length + modelDocs.length})</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
              </div>

              {/* History — project check-out feed (timeline, not a dense table) */}
              <TabsContent value="history" className="mt-4">
                {asset.lineItems.length === 0 ? (
                  <div className="rounded-[var(--r-lg)] border-2 border-border p-7 text-center">
                    <p className="text-ui-text text-ink-2">No project history yet</p>
                    <p className="mt-1 text-caption text-muted">
                      This asset hasn&apos;t been assigned to a project — it&apos;ll show up here once it&apos;s on a job.
                    </p>
                  </div>
                ) : (
                  <ol className="relative space-y-0">
                    {asset.lineItems.map((li, i) => {
                      const isLast = i === asset.lineItems.length - 1;
                      return (
                        <li key={li.id} className="group/row relative flex gap-3 pb-5 last:pb-0">
                          {/* timeline rail + node */}
                          <div className="relative flex w-4 shrink-0 flex-col items-center">
                            <span
                              className={cn(
                                "mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-paper",
                                li.status === "CHECKED_OUT" && !li.returnedAt ? "bg-blue" : "bg-line-2",
                              )}
                              aria-hidden
                            />
                            {!isLast && <span className="w-px flex-1 bg-line" aria-hidden />}
                          </div>
                          {/* content */}
                          <div className="-mt-0.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <Link
                                href={`/projects/${li.projectId}`}
                                className={cn("font-semibold text-ink hover:text-link hover:underline rounded-sm", focusRing)}
                              >
                                {li.project.name}
                              </Link>
                              <span className="t-mono text-caption text-muted">{li.project.projectNumber}</span>
                              <StatusIndicator
                                category="lineItem"
                                value={li.status}
                                label={lineItemStatusLabels[li.status] || formatLabel(li.status)}
                                variant="pill"
                              />
                            </div>
                            <p className="mt-0.5 text-caption text-muted tabular-nums">
                              {li.checkedOutAt ? (
                                <>Deployed {formatDate(li.checkedOutAt)}</>
                              ) : (
                                <>Assigned</>
                              )}
                              {li.returnedAt ? <> · returned {formatDate(li.returnedAt)}</> : li.checkedOutAt ? <> · still out</> : null}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </TabsContent>

              {/* Availability — real booking calendar */}
              <TabsContent value="availability" className="mt-4">
                <BookingCalendar entityType="asset" entityId={id} modelId={asset.modelId} initialDate={initialDate} />
              </TabsContent>

              {/* Maintenance */}
              <TabsContent value="maintenance" className="mt-4">
                {asset.maintenanceLinks.length === 0 ? (
                  <div className="rounded-[var(--r-lg)] border-2 border-border p-7 text-center">
                    <p className="text-ui-text text-ink-2">No maintenance records</p>
                    <p className="mt-1 text-caption text-muted">
                      Servicing, repairs, and test &amp; tag history for this asset land here.
                    </p>
                  </div>
                ) : (
                  <>
                  <div className="hidden rounded-[var(--r)] border border-line overflow-x-auto md:block">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[40%]">Title</TableHead>
                          <TableHead className="w-[18%]">Type</TableHead>
                          <TableHead className="w-[18%]">Status</TableHead>
                          <TableHead className="hidden w-[12%] sm:table-cell">Date</TableHead>
                          <TableHead className="hidden w-[12%] sm:table-cell">Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {asset.maintenanceLinks.map((link) => {
                          const mr = link.maintenanceRecord;
                          return (
                            <TableRow key={mr.id}>
                              <TableCell className="truncate font-medium text-ink">{mr.title}</TableCell>
                              <TableCell>
                                <Badge status="neutral">{maintenanceTypeLabels[mr.type] || formatLabel(mr.type)}</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="maintenance" value={mr.status} label={maintenanceStatusLabels[mr.status] || formatLabel(mr.status)} variant="pill" />
                              </TableCell>
                              <TableCell className="text-table-cell text-muted tabular-nums hidden sm:table-cell">
                                {formatDate(mr.completedDate || mr.scheduledDate)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                {mr.result ? (
                                  <Badge status={mr.result === "PASS" ? "ok" : "overbooked"}>
                                    {mr.result === "PASS" ? "Pass" : formatLabel(mr.result)}
                                  </Badge>
                                ) : (
                                  <span className="text-faint">{"—"}</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <MobileCardList
                    className="md:hidden"
                    data={asset.maintenanceLinks}
                    columns={maintenanceColumns}
                    getRowId={(link) => link.maintenanceRecord.id}
                  />
                  </>
                )}
              </TabsContent>

              {/* Checks */}
              <TabsContent value="checks" className="mt-4">
                <AssetChecksTab assetId={id} />
              </TabsContent>

              {/* Files — merged Photos + Model documents */}
              <TabsContent value="files" className="mt-4 space-y-6">
                <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                  <h3 className="t-heading text-ink mb-4">
                    Asset photos
                    {!hasCustomPhoto && photoUrl && (
                      <span className="ml-2 text-caption font-normal text-muted">
                        Showing model photo — upload a custom photo to override
                      </span>
                    )}
                    {hasCustomPhoto && (
                      <span className="ml-2 text-caption font-normal text-muted">
                        Custom photo — remove to revert to model photo
                      </span>
                    )}
                  </h3>
                  <MediaUploader
                    entityType="asset"
                    entityId={id}
                    accept="image/*"
                    existingMedia={assetPhotos}
                    onChanged={() => refetchAsset()}
                    onUploadComplete={async (fileUpload) => {
                      await media.add({ parentId: id, fileId: fileUpload.id, type: "PHOTO" });
                    }}
                    onRemove={async (mediaId) => {
                      await media.remove(mediaId);
                    }}
                    onSetPrimary={async (mediaId) => {
                      await media.setPrimary(id, mediaId);
                    }}
                  />
                </div>

                <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                  <h3 className="t-heading text-ink mb-4">
                    Model documents
                    <span className="ml-2 text-caption font-normal text-muted">
                      From {asset.model?.name || "this model"} — manage on the model page
                    </span>
                  </h3>
                  {modelDocs.length === 0 ? (
                    <p className="text-table-cell text-muted py-4 text-center">
                      No documents attached to this model.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {modelDocs.map((doc) => (
                        <a
                          key={doc.id}
                          href={doc.file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn("flex items-center gap-3 rounded-[var(--r)] border border-line p-3 hover:border-line-2 hover:bg-paper-2 transition-colors", focusRing)}
                        >
                          <FileText className="h-5 w-5 text-muted" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-table-cell font-medium text-ink">
                              {doc.displayName || doc.file.fileName}
                            </p>
                            <p className="text-caption text-muted">
                              {mediaTypeLabels[doc.type] || formatLabel(doc.type)} — {(doc.file.fileSize / 1024).toFixed(0)} KB
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes */}
              <TabsContent value="notes" className="mt-4">
                <NotesEditor
                  initialNotes={asset.notes || ""}
                  onChanged={() => refetchAsset()}
                  onSave={optimisticNotes.enabled ? optimisticNotes.save : (notes) => updateAssetNotes(id, notes)}
                  placeholder="Add notes about this asset..."
                />
              </TabsContent>
            </Tabs>
          </DetailMain>

          {/* ── Sidebar (lean: Details · Location · Specs · Activity) ─ */}
          <DetailSidebar>
            {/* Details — identity + purchase + T&T, omit unset rows */}
            <SidebarSection title="Details">
              <div className="space-y-1 text-table-cell">
                <KvRow label="Asset tag" value={<span className="t-mono font-medium text-ink t-data">{asset.assetTag}</span>} />
                {asset.serialNumber && (
                  <KvRow label="Serial" value={<span className="t-mono font-medium text-ink t-data">{asset.serialNumber}</span>} />
                )}
                {asset.barcode && (
                  <KvRow label="Barcode" value={<span className="t-mono font-medium text-ink t-data">{asset.barcode}</span>} />
                )}
                <KvRow
                  label="Category"
                  value={
                    asset.model?.category ? (
                      <span className="font-medium text-ink">{asset.model.category.name}</span>
                    ) : (
                      <span className="text-faint">Not set</span>
                    )
                  }
                />
                <KvRow
                  label="Model"
                  value={
                    <Link
                      href={`/assets/models/${asset.modelId}`}
                      className={cn("font-medium text-ink hover:underline truncate text-right rounded-sm", focusRing)}
                    >
                      {asset.model?.name || "—"}
                    </Link>
                  }
                />
                <KvRow
                  label="Condition"
                  value={<span className="font-medium text-ink">{conditionLabels[asset.condition] || asset.condition}</span>}
                />
                {asset.purchaseDate && (
                  <KvRow label="Purchased" value={<span className="font-medium text-ink">{formatDate(asset.purchaseDate)}</span>} />
                )}
                {asset.purchasePrice != null && (
                  <KvRow label="Cost" value={<span className="font-medium text-ink t-data">${Number(asset.purchasePrice).toFixed(2)}</span>} />
                )}
                {(asset.supplier?.name || asset.purchaseSupplier) && (
                  <KvRow label="Supplier" value={<span className="font-medium text-ink">{asset.supplier?.name || asset.purchaseSupplier}</span>} />
                )}
                {asset.warrantyExpiry && (
                  <KvRow label="Warranty" value={<span className="font-medium text-ink">{formatDate(asset.warrantyExpiry)}</span>} />
                )}
              </div>

              {/* Test & tag — folded into Details (compliance is part of "what is it") */}
              {asset.testTagAsset ? (
                <div className="mt-3 space-y-1 border-t border-line pt-3 text-table-cell">
                  <KvRow label="Test & tag" value={<span className="font-medium text-ink">{asset.testTagAsset.status?.replace(/_/g, " ") || "—"}</span>} />
                  <KvRow
                    label={<span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />Last tested</span>}
                    value={<span className="font-medium text-ink">{formatDate(asset.testTagAsset.lastTestDate)}</span>}
                  />
                  <KvRow
                    label={<span className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />Next due</span>}
                    value={<span className="font-medium text-ink">{formatDate(asset.testTagAsset.nextDueDate)}</span>}
                  />
                  <Button variant="line" size="sm" className="mt-2 w-full" asChild>
                    <Link href={`/test-and-tag/${asset.testTagAsset.id}`}>View T&amp;T details</Link>
                  </Button>
                </div>
              ) : asset.model?.requiresTestAndTag ? (
                <div className="mt-3 border-t border-line pt-3 text-table-cell">
                  <p className="text-muted">Test &amp; tag not registered</p>
                  <Button variant="line" size="sm" className="mt-2 w-full" asChild>
                    <Link href={`/test-and-tag/new?assetId=${asset.id}`}>Register for T&amp;T</Link>
                  </Button>
                </div>
              ) : null}
            </SidebarSection>

            {/* Location — where it lives + parent/accessories */}
            <SidebarSection title="Location">
              <div className="space-y-1 text-table-cell">
                {asset.location ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
                    <span className="font-medium text-ink">{asset.location.name}</span>
                  </div>
                ) : (
                  <p className="text-faint">No home location set</p>
                )}
              </div>

              {/* This asset is itself an accessory of another */}
              {asset.parentAsset && (
                <Link
                  href={`/assets/registry/${asset.parentAsset.id}`}
                  className={cn("mt-2 flex items-center gap-2 text-table-cell text-ink hover:underline rounded-sm", focusRing)}
                >
                  <Cable className="h-3.5 w-3.5 text-muted shrink-0" />
                  <span className="font-medium">Accessory of {asset.parentAsset.assetTag}</span>
                  {asset.parentAsset.customName && (
                    <span className="text-muted">{asset.parentAsset.customName}</span>
                  )}
                </Link>
              )}

              {/* Accessories manager — only for top-level assets (not children) */}
              {!asset.parentAsset && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="t-overline text-muted mb-1.5">Accessories</p>
                  <CanDo resource="asset" action="update" fallback={
                    (() => {
                      const ownBulkIds = new Set(asset.childBulkItems.map((c) => c.bulkAssetId));
                      const inherited = (asset.model?.bulkAccessories ?? []).filter(
                        (m: { bulkAssetId: string }) => !ownBulkIds.has(m.bulkAssetId),
                      );
                      const total =
                        asset.childAssets.length + asset.childBulkItems.length + inherited.length;
                      if (total === 0) return <p className="text-table-cell text-muted">No accessories attached.</p>;
                      return (
                        <ul className="space-y-1 text-table-cell">
                          {asset.childAssets.map((c) => (
                            <li key={c.id} className="flex items-center gap-2">
                              <span className="text-faint select-none">└─</span>
                              <span className="font-medium text-ink">{c.assetTag}</span>
                              <span className="text-muted">{c.model?.name ?? ""}</span>
                            </li>
                          ))}
                          {asset.childBulkItems.map((c) => (
                            <li key={c.id} className="flex items-center gap-2">
                              <span className="text-faint select-none">└─</span>
                              <span className="font-medium text-ink">{c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}</span>
                            </li>
                          ))}
                          {inherited.map((c: { id: string; quantity: number; bulkAsset: { model: { name: string } | null; assetTag: string } | null }) => (
                            <li key={c.id} className="flex items-center gap-2">
                              <span className="text-faint select-none">└─</span>
                              <span className="font-medium text-ink">{c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}</span>
                              <span className="text-badge text-muted">from model</span>
                            </li>
                          ))}
                        </ul>
                      );
                    })()
                  }>
                    <AssetAccessoriesManager
                      assetId={asset.id}
                      childAssets={asset.childAssets}
                      childBulkItems={asset.childBulkItems}
                      inheritedBulkItems={asset.model?.bulkAccessories ?? []}
                      onChanged={() => refetchAsset()}
                    />
                  </CanDo>
                </div>
              )}
            </SidebarSection>

            {/* Specs — model specifications + operator custom fields */}
            {(specs.length > 0 ||
              (asset.customFieldValues && Object.keys(asset.customFieldValues as Record<string, string>).length > 0)) && (
              <SidebarSection title="Specs">
                {specs.length > 0 && (
                  <div className="space-y-1 text-table-cell">
                    {specs.map((spec, i) => (
                      <KvRow key={i} label={spec.key} value={<span className="font-medium text-ink t-data">{spec.value}</span>} />
                    ))}
                  </div>
                )}
                <CustomFieldsDisplay
                  entityType="ASSET"
                  values={asset.customFieldValues as Record<string, string> | null | undefined}
                />
              </SidebarSection>
            )}

            {/* Activity — realtime feed */}
            <SidebarSection title="Activity" divider={false}>
              <ActivityTimeline entityType="asset" entityId={id} />
            </SidebarSection>
          </DetailSidebar>
        </DetailLayout>
      </div>
      <DeleteDialog
        open={forceReturnOpen}
        onOpenChange={setForceReturnOpen}
        title="Force return this asset?"
        description="All project assignments for this asset will be marked as returned. The asset moves back to AVAILABLE. Use this when scanning isn't possible."
        confirmLabel="Force return"
        onConfirm={() => {
          forceReturnMutation.mutate();
          setForceReturnOpen(false);
        }}
        pending={forceReturnMutation.isPending}
      />
      <DeleteDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this asset?"
        description="The asset is hidden from quoting and warehouse pulls but retained for reporting. You can restore it later."
        confirmLabel="Archive asset"
        onConfirm={() => {
          archiveMutation.mutate();
          setArchiveOpen(false);
        }}
        pending={archiveMutation.isPending}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete asset?"
        description="This permanently removes the asset and its maintenance / test-tag history. This cannot be undone."
        confirmLabel="Delete asset"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
    </FadeIn>
  );
}

/** Compact key·value row for the lean sidebar. */
function KvRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted shrink-0">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  );
}
