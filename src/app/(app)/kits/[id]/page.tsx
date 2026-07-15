"use client";

import { use, useState, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useRouter, useSearchParams } from "next/navigation";
import { useNativeKit } from "@/hooks/use-native-kit";
import { useOptimisticKitNotes } from "@/hooks/use-native-kit-writes";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Pencil, Plus, Trash2, X, ScanBarcode, RotateCcw, ChevronRight, Package, Boxes } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

import {
  getKit,
  updateKit,
  updateKitNotes,
  addSerializedItemsToKit,
  removeSerializedItemFromKit,
  addBulkItemToKit,
  removeBulkItemFromKit,
  getAvailableAssetsForKit,
  getAvailableBulkAssetsForKit,
} from "@/server/kits";
import { forceReturnKit } from "@/server/warehouse";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotesEditor } from "@/components/ui/notes-editor";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { resolveKitPhotoUrl } from "@/lib/media-utils";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { BookingCalendar } from "@/components/bookings/booking-calendar";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import { KitChecksTab } from "@/components/kits/kit-checks-tab";
import { KitAllocationPanel } from "@/components/kits/kit-allocation-panel";
import { DeleteKitDialog } from "@/components/kits/delete-kit-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { kitStatusLabels, lineItemStatusLabels, conditionLabels, formatLabel } from "@/lib/status-labels";
import { formatDate } from "@/lib/formatters";
import { cn, focusRing, disabledState } from "@/lib/utils";


export default function KitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<DetailPageSkeleton />}>
      <KitDetailContent params={params} />
    </Suspense>
  );
}

function KitDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialDate = useMemo(() => {
    const d = searchParams.get("date");
    if (!d) return null;
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return null;
    const parsed = new Date(y, m - 1, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }, [searchParams]);

  // Dialog states – must be declared before any early returns
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddBulkItem, setShowAddBulkItem] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [forceReturnOpen, setForceReturnOpen] = useState(false);
  const [removeAssetId, setRemoveAssetId] = useState<string | null>(null);
  const [removeBulkItemId, setRemoveBulkItemId] = useState<string | null>(null);
  const [stagedItems, setStagedItems] = useState<Array<{ assetId: string; assetTag: string; modelName: string }>>([]);
  const [addBulkAssetId, setAddBulkAssetId] = useState("");
  const [addBulkQuantity, setAddBulkQuantity] = useState(1);
  const [addBulkPosition, setAddBulkPosition] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Native kit-detail read (Phase 4 — the version-vector server-action path is
  // retired). ONE live `kitDetail.bundle` subscription reconstructs the getKit
  // shape client-side, reactive over the WebSocket. Writes are still server actions
  // whose `convex.mutation` pushes the delta to this subscription, so the historic
  // post-mutation refetch calls are redundant — `refetchKit` is kept as a no-op
  // (belt-and-braces) to avoid touching every call site.
  const native = useNativeKit(id, orgId);
  const media = useMediaWrites("kit");
  const optimisticKitNotes = useOptimisticKitNotes(id, orgId);
  // The native reconstruction is a thin DTO of the same getKit shape (the page reads
  // only the fields it produces); cast to the server type so the page's typed field
  // access is preserved.
  type KitDetail = Awaited<ReturnType<typeof getKit>>;
  const kit = native.data as unknown as KitDetail | undefined;
  const isLoading = native.isLoading;
  const refetchKit = useCallback(() => {}, []);

  // Dialog-gated cross-domain reads (NOT in the SSE map; no cross-user liveness).
  // After an add, the mutation calls refetch() to drop the just-added rows.
  const { data: availableAssets = [], refetch: refetchAvailableAssets } = useServerQuery({
    queryKey: ["available-assets-for-kit", orgId],
    queryFn: () => getAvailableAssetsForKit(),
    enabled: showAddItem,
  });

  const { data: availableBulkAssets = [], refetch: refetchAvailableBulkAssets } = useServerQuery({
    queryKey: ["available-bulk-assets-for-kit", orgId],
    queryFn: () => getAvailableBulkAssetsForKit(),
    enabled: showAddBulkItem,
  });

  const statusMutation = useServerMutation({
    mutationFn: (newStatus: string) => {
      if (!kit) throw new Error("Kit not loaded");
      return updateKit(id, {
        name: kit.name,
        assetTag: kit.assetTag,
        status: newStatus as "AVAILABLE" | "CHECKED_OUT" | "IN_MAINTENANCE" | "RETIRED" | "INCOMPLETE",
        condition: kit.condition as "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED",
        description: kit.description || undefined,
        categoryId: kit.categoryId || undefined,
        locationId: kit.locationId || undefined,
        weight: kit.weight ? Number(kit.weight) : undefined,
        caseType: kit.caseType || undefined,
        caseDimensions: kit.caseDimensions || undefined,
        notes: kit.notes || undefined,
        purchaseDate: kit.purchaseDate ? new Date(kit.purchaseDate) : undefined,
        purchasePrice: kit.purchasePrice ? Number(kit.purchasePrice) : undefined,
      });
    },
    onSuccess: () => {
      toast.success("Status updated");
      refetchKit();
    },
    onError: (e) => toast.error(e.message),
  });

  const forceReturnMutation = useServerMutation({
    mutationFn: () => forceReturnKit(id),
    onSuccess: () => {
      toast.success("Kit force returned to available");
      refetchKit();
    },
    onError: (e) => toast.error(e.message),
  });

  const addItemsMutation = useServerMutation({
    mutationFn: () =>
      addSerializedItemsToKit(
        id,
        stagedItems.map((item) => ({ assetId: item.assetId })),
      ),
    onSuccess: () => {
      toast.success(`${stagedItems.length} item${stagedItems.length > 1 ? "s" : ""} added to kit`);
      refetchKit();
      refetchAvailableAssets();
      setShowAddItem(false);
      setStagedItems([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeItemMutation = useServerMutation({
    mutationFn: (assetId: string) => removeSerializedItemFromKit(id, assetId),
    onSuccess: () => {
      toast.success("Item removed from kit");
      refetchKit();
    },
    onError: (e) => toast.error(e.message),
  });

  const addBulkMutation = useServerMutation({
    mutationFn: () =>
      addBulkItemToKit(id, {
        bulkAssetId: addBulkAssetId,
        quantity: addBulkQuantity,
        position: addBulkPosition || undefined,
      }),
    onSuccess: () => {
      toast.success("Bulk item added to kit");
      refetchKit();
      refetchAvailableBulkAssets();
      setShowAddBulkItem(false);
      setAddBulkAssetId("");
      setAddBulkQuantity(1);
      setAddBulkPosition("");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeBulkMutation = useServerMutation({
    mutationFn: (bulkItemId: string) => removeBulkItemFromKit(id, bulkItemId),
    onSuccess: () => {
      toast.success("Bulk item removed from kit");
      refetchKit();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <DetailPageSkeleton />;
  if (!kit) return <div className="py-20 text-center text-muted">Kit not found.</div>;

  const kitPhotos = ((kit.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const kitPhotoUrl = resolveKitPhotoUrl(kit, false);

  // Find current assignment (active line item on a project)
  const currentAssignment = kit.lineItems.find(
    (li) => !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(li.status),
  );

  // ── Mobile card layouts for the sub-tables (rendered below `md`) ──
  const serializedItemColumns: ColumnDef<(typeof kit.serializedItems)[number]>[] = [
    {
      id: "assetTag",
      header: "Asset tag",
      mobile: "title",
      cell: (item) => (
        <Link
          href={`/assets/registry/${item.assetId}`}
          className={cn("t-mono text-table-cell text-ink hover:underline rounded-sm", focusRing)}
        >
          {item.asset.assetTag}
        </Link>
      ),
    },
    {
      id: "model",
      header: "Model",
      mobile: "subtitle",
      cell: (item) => <span className="text-ink">{item.asset.model?.name || "—"}</span>,
    },
    {
      id: "position",
      header: "Position",
      mobile: "meta",
      cell: (item) => <span className="text-muted">{item.position || "—"}</span>,
    },
    {
      id: "condition",
      header: "Condition",
      mobile: "badge",
      cell: (item) => (
        <StatusIndicator category="condition" value={item.asset.condition} label={conditionLabels[item.asset.condition] || formatLabel(item.asset.condition)} />
      ),
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (item) => (
        <CanDo resource="kit" action="update">
          <Button
            variant="ghost"
            size="icon"
            className="touch-target size-9 text-t-out hover:text-t-out"
            aria-label="Remove asset from kit"
            onClick={() => setRemoveAssetId(item.assetId)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </CanDo>
      ),
    },
  ];

  const bulkItemColumns: ColumnDef<(typeof kit.bulkItems)[number]>[] = [
    {
      id: "model",
      header: "Model",
      mobile: "title",
      cell: (item) => <span className="text-ink">{item.bulkAsset.model?.name || "—"}</span>,
    },
    {
      id: "quantity",
      header: "Quantity",
      mobile: "meta",
      cell: (item) => (
        <span className="text-right font-medium t-mono t-data text-ink">{item.quantity}</span>
      ),
    },
    {
      id: "position",
      header: "Position",
      mobile: "meta",
      cell: (item) => <span className="text-muted">{item.position || "—"}</span>,
    },
    {
      id: "actions",
      header: "",
      mobile: "actions",
      cell: (item) => (
        <CanDo resource="kit" action="update">
          <Button
            variant="ghost"
            size="icon"
            className="touch-target size-9 text-t-out hover:text-t-out"
            aria-label="Remove bulk item from kit"
            onClick={() => setRemoveBulkItemId(item.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </CanDo>
      ),
    },
  ];

  const lineItemColumns: ColumnDef<(typeof kit.lineItems)[number]>[] = [
    {
      id: "project",
      header: "Project",
      mobile: "title",
      cell: (li) => (
        <>
          <Link href={`/projects/${li.projectId}`} className={cn("text-ink hover:underline rounded-sm", focusRing)}>
            {li.project.name}
          </Link>
          <p className="t-mono text-caption text-muted">{li.project.projectNumber}</p>
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (li) => (
        <StatusIndicator category="lineItem" value={li.status} label={lineItemStatusLabels[li.status] || formatLabel(li.status)} variant="pill" />
      ),
    },
    {
      id: "deployed",
      header: "Deployed",
      mobile: "meta",
      cell: (li) => <span className="text-table-cell text-ink">{formatDate(li.checkedOutAt)}</span>,
    },
    {
      id: "returned",
      header: "Returned",
      mobile: "meta",
      cell: (li) => <span className="text-table-cell text-ink">{formatDate(li.returnedAt)}</span>,
    },
  ];

  const scanLogColumns: ColumnDef<(typeof kit.scanLogs)[number]>[] = [
    {
      id: "date",
      header: "Date",
      mobile: "title",
      cell: (log) => <span className="text-table-cell text-ink">{formatDate(log.scannedAt)}</span>,
    },
    {
      id: "scannedBy",
      header: "Scanned by",
      mobile: "subtitle",
      cell: (log) => (
        <span className="text-table-cell text-ink">
          {log.scannedBy?.name ? (
            <span className="inline-flex items-center gap-2">
              <PersonAvatar name={log.scannedBy.name} className="size-6" />
              {log.scannedBy.name}
            </span>
          ) : (
            "—"
          )}
        </span>
      ),
    },
    {
      id: "project",
      header: "Project",
      mobile: "meta",
      cell: (log) => (
        <span className="text-table-cell text-ink">
          {log.project ? (
            <Link href={`/projects/${log.projectId}`} className={cn("text-ink hover:underline rounded-sm", focusRing)}>
              {log.project.name}
            </Link>
          ) : (
            "—"
          )}
        </span>
      ),
    },
  ];

  return (
    <RequirePermission resource="kit" action="read">
    <PageMeta title={kit ? `${kit.assetTag}${kit.name ? ` \u2014 ${kit.name}` : ""}` : undefined} />
    <FadeIn>
    <div className="space-y-6">
      {/* ── Header (full width) ────────────────────────────────── */}
      <div>
        {/* Breadcrumb */}
        <nav className="mb-2 flex items-center gap-1 text-caption text-muted">
          <Link href="/kits" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
            Kits
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="t-mono text-ink-2">{kit.name || kit.assetTag}</span>
        </nav>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4 min-w-0">
            <MediaThumbnail
              url={kitPhotoUrl}
              alt={kit.assetTag}
              size={64}
              className="flex-shrink-0"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title text-ink">{kit.name || kit.assetTag}</h1>
                <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} />
                <Badge status="neutral" className="t-mono">{kit.assetTag}</Badge>
              </div>
              <p className="mt-1 text-caption text-muted">
                {kit.category && kit.category.name}
                {kit.category && kit.description && <> &middot; </>}
                {kit.description}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <CanDo resource="kit" action="update">
            <div className="flex flex-wrap gap-2">
              {kit.status === "CHECKED_OUT" && (
                <Button
                  variant="line"
                  size="sm"
                  className="border-warn/40 text-warn hover:bg-warn-soft hover:border-warn"
                  onClick={() => setForceReturnOpen(true)}
                  disabled={forceReturnMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  Force return
                </Button>
              )}
              <Button variant="line" size="sm" asChild>
                <Link href={`/kits/${id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <CanDo resource="kit" action="delete">
                <Button
                  variant="line"
                  size="sm"
                  className="border-red/40 text-red hover:bg-red hover:text-white hover:border-red"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </CanDo>
            </div>
          </CanDo>
        </div>
      </div>

      {/* ── 2-Column Layout ────────────────────────────────────── */}
      <DetailLayout>
        {/* ── Main Content (left) ──────────────────────────────── */}
        <DetailMain className="space-y-6">
          {/* Booking Calendar */}
          <BookingCalendar entityType="kit" entityId={id} initialDate={initialDate} />

          {/* Checks */}
          <div>
            <h3 className="t-heading text-ink mb-3">Checks</h3>
            <KitChecksTab kitId={id} checkMode={(kit as Record<string, unknown>).checkMode as string || "KIT_LEVEL"} />
          </div>

          {/* Contents */}
          <div id="kit-contents" className="space-y-6">
            {/* Serialized Items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="t-heading text-ink">Serialized items</h3>
                <CanDo resource="kit" action="update">
                  <Button size="sm" variant="line" onClick={() => setShowAddItem(true)}>
                    <Plus className="h-4 w-4" />
                    Add item
                  </Button>
                </CanDo>
              </div>
              {kit.serializedItems.length === 0 ? (
                <EmptyState title="No serialized items" description="Add individual tracked assets to this kit." />
              ) : (
                <>
                <div className="hidden md:block rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset tag</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kit.serializedItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Link
                              href={`/assets/registry/${item.assetId}`}
                              className={cn("t-mono text-table-cell text-ink hover:underline rounded-sm", focusRing)}
                            >
                              {item.asset.assetTag}
                            </Link>
                          </TableCell>
                          <TableCell className="text-ink">{item.asset.model?.name || "—"}</TableCell>
                          <TableCell className="text-muted">
                            {item.position || "\u2014"}
                          </TableCell>
                          <TableCell>
                            <StatusIndicator category="condition" value={item.asset.condition} label={conditionLabels[item.asset.condition] || formatLabel(item.asset.condition)} />
                          </TableCell>
                          <TableCell>
                            <CanDo resource="kit" action="update">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target size-9 text-t-out hover:text-t-out"
                                aria-label="Remove asset from kit"
                                onClick={() => setRemoveAssetId(item.assetId)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </CanDo>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {kit.serializedItems.length > 0 && (
                  <MobileCardList
                    className="md:hidden"
                    data={kit.serializedItems}
                    columns={serializedItemColumns}
                    getRowId={(item) => item.id}
                  />
                )}
                </>
              )}
            </div>

            {/* Bulk Items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="t-heading text-ink">Bulk items</h3>
                <CanDo resource="kit" action="update">
                  <Button size="sm" variant="line" onClick={() => setShowAddBulkItem(true)}>
                    <Plus className="h-4 w-4" />
                    Add bulk item
                  </Button>
                </CanDo>
              </div>
              {kit.bulkItems.length === 0 ? (
                <EmptyState title="No bulk items" description="Add consumable or quantity-tracked items to this kit." />
              ) : (
                <>
                <div className="hidden md:block rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kit.bulkItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-ink">{item.bulkAsset.model?.name || "—"}</TableCell>
                          <TableCell className="text-right font-medium t-mono t-data text-ink">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-muted">
                            {item.position || "\u2014"}
                          </TableCell>
                          <TableCell>
                            <CanDo resource="kit" action="update">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target size-9 text-t-out hover:text-t-out"
                                aria-label="Remove bulk item from kit"
                                onClick={() => setRemoveBulkItemId(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </CanDo>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {kit.bulkItems.length > 0 && (
                  <MobileCardList
                    className="md:hidden"
                    data={kit.bulkItems}
                    columns={bulkItemColumns}
                    getRowId={(item) => item.id}
                  />
                )}
                </>
              )}
            </div>
          </div>

          {/* Revenue allocation */}
          <div id="kit-revenue-allocation">
            <h3 className="t-heading text-ink mb-3">Revenue allocation</h3>
            <KitAllocationPanel kitId={id} />
          </div>

          {/* History */}
          {(kit.lineItems.length > 0 || kit.scanLogs.length > 0) && (
            <div className="space-y-4">
              {kit.lineItems.length > 0 && (
                <div>
                  <h3 className="t-heading text-ink mb-3">Project assignments</h3>
                  <div className="hidden md:block rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)] overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Deployed</TableHead>
                          <TableHead>Returned</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kit.lineItems.map((li) => (
                          <TableRow key={li.id}>
                            <TableCell>
                              <Link href={`/projects/${li.projectId}`} className={cn("text-ink hover:underline rounded-sm", focusRing)}>
                                {li.project.name}
                              </Link>
                              <p className="t-mono text-caption text-muted">{li.project.projectNumber}</p>
                            </TableCell>
                            <TableCell>
                              <StatusIndicator category="lineItem" value={li.status} label={lineItemStatusLabels[li.status] || formatLabel(li.status)} variant="pill" />
                            </TableCell>
                            <TableCell className="text-table-cell text-ink">{formatDate(li.checkedOutAt)}</TableCell>
                            <TableCell className="text-table-cell text-ink">{formatDate(li.returnedAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {kit.lineItems.length > 0 && (
                    <MobileCardList
                      className="md:hidden"
                      data={kit.lineItems}
                      columns={lineItemColumns}
                      getRowId={(li) => li.id}
                    />
                  )}
                </div>
              )}

              {kit.scanLogs.length > 0 && (
                <div>
                  <h3 className="t-heading text-ink mb-3">Recent scans</h3>
                  <div className="hidden md:block rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)] overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Scanned by</TableHead>
                          <TableHead>Project</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kit.scanLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-table-cell text-ink">{formatDate(log.scannedAt)}</TableCell>
                            <TableCell className="text-table-cell text-ink">
                              {log.scannedBy?.name ? (
                                <span className="inline-flex items-center gap-2">
                                  <PersonAvatar name={log.scannedBy.name} className="size-6" />
                                  {log.scannedBy.name}
                                </span>
                              ) : (
                                "\u2014"
                              )}
                            </TableCell>
                            <TableCell className="text-table-cell text-ink">
                              {log.project ? (
                                <Link href={`/projects/${log.projectId}`} className={cn("text-ink hover:underline rounded-sm", focusRing)}>
                                  {log.project.name}
                                </Link>
                              ) : (
                                "\u2014"
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {kit.scanLogs.length > 0 && (
                    <MobileCardList
                      className="md:hidden"
                      data={kit.scanLogs}
                      columns={scanLogColumns}
                      getRowId={(log) => log.id}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          <div>
            <h3 className="t-heading text-ink mb-3">Photos ({kitPhotos.length})</h3>
            <MediaUploader
              entityType="kit"
              entityId={id}
              accept="image/*"
              existingMedia={kitPhotos}
              onChanged={() => refetchKit()}
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

          {/* Notes */}
          <NotesEditor
            initialNotes={kit.notes || ""}
            onChanged={() => refetchKit()}
            onSave={(notes) =>
              optimisticKitNotes.enabled ? optimisticKitNotes.save(notes) : updateKitNotes(id, notes)
            }
            placeholder="Add notes about this kit..."
          />
        </DetailMain>

        {/* ── Sidebar (right) ──────────────────────────────────── */}
        <DetailSidebar>
            {/* Status */}
            <SidebarSection title="Status">
              <CanDo
                resource="kit"
                action="update"
                fallback={
                  <div className="flex items-center gap-2">
                    <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} />
                  </div>
                }
              >
                <select
                  value={kit.status}
                  onChange={(e) => statusMutation.mutate(e.target.value)}
                  disabled={statusMutation.isPending}
                  className={cn(
                    "flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink",
                    focusRing,
                    disabledState,
                  )}
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="CHECKED_OUT">Deployed</option>
                  <option value="IN_MAINTENANCE">In maintenance</option>
                  <option value="RETIRED">Retired</option>
                  <option value="INCOMPLETE">Incomplete</option>
                </select>
              </CanDo>
              <StatusIndicator category="condition" value={kit.condition} label={conditionLabels[kit.condition] || formatLabel(kit.condition)} />
            </SidebarSection>

            {/* Kit Info */}
            <SidebarSection title="Details">
              <div className="space-y-1 text-table-cell">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Asset tag</span>
                  <span className="t-mono font-medium text-ink t-data">{kit.assetTag}</span>
                </div>
                {kit.category && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Category</span>
                    <span className="font-medium text-ink text-right">{kit.category.name}</span>
                  </div>
                )}
                {kit.caseType && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Case type</span>
                    <span className="font-medium text-ink text-right">{kit.caseType}</span>
                  </div>
                )}
                {kit.caseDimensions && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Dimensions</span>
                    <span className="font-medium text-ink text-right">{kit.caseDimensions}</span>
                  </div>
                )}
                {kit.weight && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Weight</span>
                    <span className="font-medium text-ink t-data">{Number(kit.weight)} kg</span>
                  </div>
                )}
                {kit.location && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Location</span>
                    <span className="font-medium text-ink text-right">{kit.location.name}</span>
                  </div>
                )}
                {kit.purchaseDate && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Purchased</span>
                    <span className="font-medium text-ink">{formatDate(kit.purchaseDate)}</span>
                  </div>
                )}
                {kit.purchasePrice && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Purchase price</span>
                    <span className="font-medium text-ink t-data">${Number(kit.purchasePrice).toFixed(2)}</span>
                  </div>
                )}
                {kit.description && (
                  <p className="text-muted pt-1">{kit.description}</p>
                )}
              </div>
            </SidebarSection>

            {/* Contents Summary */}
            <SidebarSection title="Contents">
              <div className="space-y-1.5 text-table-cell">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-muted" />
                  <span className="t-mono t-data text-ink">{kit.serializedItems.length}</span>
                  <span className="text-muted">serialized item{kit.serializedItems.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Boxes className="h-3.5 w-3.5 text-muted" />
                  <span className="t-mono t-data text-ink">{kit.bulkItems.length}</span>
                  <span className="text-muted">bulk item{kit.bulkItems.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </SidebarSection>

            {/* Current Assignment */}
            <SidebarSection title="Assignment">
              {currentAssignment ? (
                <div className="text-table-cell space-y-1">
                  <Link
                    href={`/projects/${currentAssignment.projectId}`}
                    className={cn("font-medium text-ink hover:underline rounded-sm", focusRing)}
                  >
                    {currentAssignment.project.name}
                  </Link>
                  <p className="t-mono text-caption text-muted">{currentAssignment.project.projectNumber}</p>
                  <StatusIndicator
                    category="lineItem"
                    value={currentAssignment.status}
                    label={lineItemStatusLabels[currentAssignment.status] || formatLabel(currentAssignment.status)}
                    variant="pill"
                  />
                </div>
              ) : (
                <p className="text-table-cell text-muted">Not currently assigned</p>
              )}
            </SidebarSection>

            {/* Activity Timeline */}
            <SidebarSection title="Activity" divider={false}>
              <ActivityTimeline entityType="kit" entityId={id} />
            </SidebarSection>
        </DetailSidebar>
      </DetailLayout>
    </div>
    </FadeIn>

    <DeleteDialog
      open={forceReturnOpen}
      onOpenChange={setForceReturnOpen}
      title="Force return this kit?"
      description="All project assignments for the kit and its contents will be marked as returned. The kit moves back to available. Use when scanning isn't possible."
      confirmLabel="Force return kit"
      onConfirm={() => {
        forceReturnMutation.mutate();
        setForceReturnOpen(false);
      }}
      pending={forceReturnMutation.isPending}
    />
    <DeleteDialog
      open={!!removeAssetId}
      onOpenChange={(open) => !open && setRemoveAssetId(null)}
      title="Remove asset from kit?"
      description="The asset is removed from this kit's membership. The asset itself is not deleted."
      confirmLabel="Remove from kit"
      onConfirm={() => {
        if (removeAssetId) {
          removeItemMutation.mutate(removeAssetId);
          setRemoveAssetId(null);
        }
      }}
      pending={removeItemMutation.isPending}
    />
    <DeleteDialog
      open={!!removeBulkItemId}
      onOpenChange={(open) => !open && setRemoveBulkItemId(null)}
      title="Remove bulk item from kit?"
      description="The bulk item is removed from this kit's membership. Bulk inventory itself is not deleted."
      confirmLabel="Remove from kit"
      onConfirm={() => {
        if (removeBulkItemId) {
          removeBulkMutation.mutate(removeBulkItemId);
          setRemoveBulkItemId(null);
        }
      }}
      pending={removeBulkMutation.isPending}
    />

    {/* Add Serialized Items Dialog */}
    <Dialog
      open={showAddItem}
      onOpenChange={(open) => {
        setShowAddItem(open);
        if (!open) setStagedItems([]);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add items to kit</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-muted">
          Scan a barcode or search for an asset to add it to the list. Repeat for multiple items.
        </p>
        <ScanInput
          availableAssets={availableAssets}
          stagedIds={new Set(stagedItems.map((i) => i.assetId))}
          onAdd={(asset) => {
            setStagedItems((prev) => [
              ...prev,
              { assetId: asset.id, assetTag: asset.assetTag, modelName: asset.model?.name || "—" },
            ]);
          }}
        />
        {stagedItems.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {stagedItems.map((item, i) => (
              <div key={item.assetId} className="flex items-center gap-2 rounded-[var(--r)] border border-line px-3 py-1.5 text-ui-text">
                <div className="min-w-0 flex-1">
                  <span className="t-mono font-medium text-ink">{item.assetTag}</span>
                  <span className="text-muted ml-2 break-words">{item.modelName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStagedItems((prev) => prev.filter((_, j) => j !== i))}
                  className={cn("shrink-0 rounded-sm text-muted hover:text-t-out", focusRing)}
                  aria-label={`Remove ${item.assetTag}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="line" onClick={() => { setShowAddItem(false); setStagedItems([]); }}>
            Cancel
          </Button>
          <Button
            onClick={() => addItemsMutation.mutate()}
            disabled={stagedItems.length === 0}
            loading={addItemsMutation.isPending}
          >
            Add {stagedItems.length} item{stagedItems.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Add Bulk Item Dialog */}
    <Dialog open={showAddBulkItem} onOpenChange={setShowAddBulkItem}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add bulk item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Bulk asset</Label>
            <ComboboxPicker
              value={addBulkAssetId}
              onChange={setAddBulkAssetId}
              options={availableBulkAssets.map((a) => ({
                value: a.id,
                label: a.assetTag,
                description: `${a.model?.name || "—"} (${a.availableQuantity} available)`,
              }))}
              placeholder="Select a bulk asset..."
              searchPlaceholder="Search available bulk assets..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-bulk-quantity">Quantity</Label>
            <Input
              id="add-bulk-quantity"
              type="number"
              min={1}
              value={addBulkQuantity}
              onChange={(e) => setAddBulkQuantity(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-bulk-position">Position (optional)</Label>
            <Input
              id="add-bulk-position"
              value={addBulkPosition}
              onChange={(e) => setAddBulkPosition(e.target.value)}
              placeholder="e.g. Bottom compartment"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => addBulkMutation.mutate()}
            disabled={!addBulkAssetId || addBulkQuantity < 1}
            loading={addBulkMutation.isPending}
          >
            Add bulk item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <DeleteKitDialog
      kitId={id}
      kitLabel={kit.name || kit.assetTag}
      open={showDeleteDialog}
      onOpenChange={setShowDeleteDialog}
      onDeleted={() => {
        router.push("/kits");
      }}
    />
    </RequirePermission>
  );
}

// ─── Scan / Search Input for adding items ────────────────────────────────────

interface AvailableAsset {
  id: string;
  assetTag: string;
  model: { name: string } | null;
}

function ScanInput({
  availableAssets,
  stagedIds,
  onAdd,
}: {
  availableAssets: AvailableAsset[];
  stagedIds: Set<string>;
  onAdd: (asset: AvailableAsset) => void;
}) {
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter out already-staged assets
  const filtered = useMemo(() => {
    const remaining = availableAssets.filter((a) => !stagedIds.has(a.id));
    if (!search) return remaining.slice(0, 20);
    const lower = search.toLowerCase();
    return remaining.filter(
      (a) =>
        a.assetTag.toLowerCase().includes(lower) ||
        (a.model?.name.toLowerCase().includes(lower) ?? false),
    );
  }, [availableAssets, stagedIds, search]);

  const handleSelect = useCallback(
    (asset: AvailableAsset) => {
      onAdd(asset);
      setSearch("");
      setShowResults(false);
      // Refocus input for next scan
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [onAdd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && search) {
        e.preventDefault();
        // Try exact match on asset tag first, then first filtered result
        const exact = filtered.find(
          (a) => a.assetTag.toLowerCase() === search.toLowerCase(),
        );
        const match = exact || filtered[0];
        if (match) {
          handleSelect(match);
        } else {
          toast.error("No matching asset found");
        }
      }
    },
    [search, filtered, handleSelect],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="relative">
          <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => {
              // Delay to allow click on result
              setTimeout(() => setShowResults(false), 200);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Scan barcode or search by tag / model..."
            className="pl-9"
            autoFocus
          />
        </div>
        {showResults && search && (
          <div className="absolute z-50 mt-1 w-full rounded-[var(--r)] border border-line bg-elev shadow-[var(--sh-card)] max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-ui-text text-muted">
                No matching available assets.
              </div>
            ) : (
              filtered.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(asset)}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-ui-text hover:bg-paper-2 text-left rounded-sm", focusRing, disabledState)}
                >
                  <span className="t-mono font-medium text-ink">{asset.assetTag}</span>
                  <span className="text-muted">{asset.model?.name || "—"}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
