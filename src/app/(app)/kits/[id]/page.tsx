"use client";

import { use, useState, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Loader2, X, ScanBarcode, Camera, RotateCcw, ChevronRight, Package, Boxes } from "lucide-react";
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
import {
  addKitMedia,
  removeKitMedia,
  setKitPrimaryPhoto,
} from "@/server/kit-media";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { BarcodeScanner } from "@/components/ui/barcode-scanner";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { KitChecksTab } from "@/components/kits/kit-checks-tab";
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
  const queryClient = useQueryClient();

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

  const { data: kit, isLoading } = useQuery({
    queryKey: ["kit", orgId, id],
    queryFn: () => getKit(id),
  });

  const { data: availableAssets = [] } = useQuery({
    queryKey: ["available-assets-for-kit", orgId],
    queryFn: () => getAvailableAssetsForKit(),
    enabled: showAddItem,
  });

  const { data: availableBulkAssets = [] } = useQuery({
    queryKey: ["available-bulk-assets-for-kit", orgId],
    queryFn: () => getAvailableBulkAssetsForKit(),
    enabled: showAddBulkItem,
  });

  const statusMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const forceReturnMutation = useMutation({
    mutationFn: () => forceReturnKit(id),
    onSuccess: () => {
      toast.success("Kit force returned to available");
      queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const addItemsMutation = useMutation({
    mutationFn: () =>
      addSerializedItemsToKit(
        id,
        stagedItems.map((item) => ({ assetId: item.assetId })),
      ),
    onSuccess: () => {
      toast.success(`${stagedItems.length} item${stagedItems.length > 1 ? "s" : ""} added to kit`);
      queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["available-assets-for-kit", orgId] });
      setShowAddItem(false);
      setStagedItems([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeItemMutation = useMutation({
    mutationFn: (assetId: string) => removeSerializedItemFromKit(id, assetId),
    onSuccess: () => {
      toast.success("Item removed from kit");
      queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const addBulkMutation = useMutation({
    mutationFn: () =>
      addBulkItemToKit(id, {
        bulkAssetId: addBulkAssetId,
        quantity: addBulkQuantity,
        position: addBulkPosition || undefined,
      }),
    onSuccess: () => {
      toast.success("Bulk item added to kit");
      queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["available-bulk-assets-for-kit", orgId] });
      setShowAddBulkItem(false);
      setAddBulkAssetId("");
      setAddBulkQuantity(1);
      setAddBulkPosition("");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeBulkMutation = useMutation({
    mutationFn: (bulkItemId: string) => removeBulkItemFromKit(id, bulkItemId),
    onSuccess: () => {
      toast.success("Bulk item removed from kit");
      queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <DetailPageSkeleton />;
  if (!kit) return <div className="py-20 text-center text-fg-3">Kit not found.</div>;

  const kitPhotos = ((kit.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const kitPhotoUrl = resolveKitPhotoUrl(kit, false);

  // Find current assignment (active line item on a project)
  const currentAssignment = kit.lineItems.find(
    (li) => !["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"].includes(li.status),
  );

  return (
    <RequirePermission resource="kit" action="read">
    <PageMeta title={kit ? `${kit.assetTag}${kit.name ? ` \u2014 ${kit.name}` : ""}` : undefined} />
    <FadeIn>
    <div className="space-y-6">
      {/* ── Header (full width) ────────────────────────────────── */}
      <div>
        {/* Breadcrumb */}
        <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
          <Link href="/kits" className="hover:text-fg transition-colors">
            Kits
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-mono text-fg-2">{kit.name || kit.assetTag}</span>
        </nav>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <MediaThumbnail
              url={kitPhotoUrl}
              alt={kit.assetTag}
              size={64}
              className="flex-shrink-0"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="t-title text-fg">{kit.name || kit.assetTag}</h1>
                <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} />
                <Badge variant="secondary" className="font-mono">{kit.assetTag}</Badge>
              </div>
              <p className="mt-1 text-sm text-fg-3">
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
                  variant="outline"
                  size="sm"
                  className="text-amber-600"
                  onClick={() => setForceReturnOpen(true)}
                  disabled={forceReturnMutation.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Force Return
                </Button>
              )}
              <Button variant="outline" render={<Link href={`/kits/${id}/edit`} />}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <CanDo resource="kit" action="delete">
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
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
            <h3 className="t-heading text-fg mb-3">Checks</h3>
            <KitChecksTab kitId={id} checkMode={(kit as Record<string, unknown>).checkMode as string || "KIT_LEVEL"} />
          </div>

          {/* Contents */}
          <div id="kit-contents" className="space-y-6">
            {/* Serialized Items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="t-heading text-fg">Serialized Items</h3>
                <CanDo resource="kit" action="update">
                  <Button size="sm" variant="outline" onClick={() => setShowAddItem(true)}>
                    <Plus className="mr-1 h-3 w-3" />
                    Add Item
                  </Button>
                </CanDo>
              </div>
              {kit.serializedItems.length === 0 ? (
                <EmptyState preset="assets" heading="No serialized items" description="Add individual tracked assets to this kit." />
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset Tag</TableHead>
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
                              className="font-mono text-sm hover:underline"
                            >
                              {item.asset.assetTag}
                            </Link>
                          </TableCell>
                          <TableCell>{item.asset.model.name}</TableCell>
                          <TableCell className="text-fg-3">
                            {item.position || "\u2014"}
                          </TableCell>
                          <TableCell>
                            <StatusIndicator category="condition" value={item.asset.condition} label={conditionLabels[item.asset.condition] || formatLabel(item.asset.condition)} />
                          </TableCell>
                          <TableCell>
                            <CanDo resource="kit" action="update">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
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
              )}
            </div>

            {/* Bulk Items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="t-heading text-fg">Bulk Items</h3>
                <CanDo resource="kit" action="update">
                  <Button size="sm" variant="outline" onClick={() => setShowAddBulkItem(true)}>
                    <Plus className="mr-1 h-3 w-3" />
                    Add Bulk Item
                  </Button>
                </CanDo>
              </div>
              {kit.bulkItems.length === 0 ? (
                <EmptyState preset="assets" heading="No bulk items" description="Add consumable or quantity-tracked items to this kit." />
              ) : (
                <div className="rounded-md border">
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
                          <TableCell>{item.bulkAsset.model.name}</TableCell>
                          <TableCell className="text-right font-medium t-data">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-fg-3">
                            {item.position || "\u2014"}
                          </TableCell>
                          <TableCell>
                            <CanDo resource="kit" action="update">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
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
              )}
            </div>
          </div>

          {/* History */}
          {(kit.lineItems.length > 0 || kit.scanLogs.length > 0) && (
            <div className="space-y-4">
              {kit.lineItems.length > 0 && (
                <div>
                  <h3 className="t-heading text-fg mb-3">Project Assignments</h3>
                  <div className="rounded-md border">
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
                              <Link href={`/projects/${li.projectId}`} className="hover:underline">
                                {li.project.name}
                              </Link>
                              <p className="text-xs text-fg-3">{li.project.projectNumber}</p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{lineItemStatusLabels[li.status] || formatLabel(li.status)}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{formatDate(li.checkedOutAt)}</TableCell>
                            <TableCell className="text-sm">{formatDate(li.returnedAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {kit.scanLogs.length > 0 && (
                <div>
                  <h3 className="t-heading text-fg mb-3">Recent Scans</h3>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Scanned By</TableHead>
                          <TableHead>Project</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kit.scanLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-sm">{formatDate(log.scannedAt)}</TableCell>
                            <TableCell className="text-sm">{log.scannedBy?.name || "\u2014"}</TableCell>
                            <TableCell className="text-sm">
                              {log.project ? (
                                <Link href={`/projects/${log.projectId}`} className="hover:underline">
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
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          <div>
            <h3 className="t-heading text-fg mb-3">Photos ({kitPhotos.length})</h3>
            <MediaUploader
              entityType="kit"
              entityId={id}
              accept="image/*"
              existingMedia={kitPhotos}
              queryKey={["kit", orgId, id]}
              onUploadComplete={async (fileUpload) => {
                await addKitMedia({
                  kitId: id,
                  fileId: fileUpload.id,
                  type: "PHOTO",
                });
              }}
              onRemove={async (mediaId) => {
                await removeKitMedia(mediaId);
              }}
              onSetPrimary={async (mediaId) => {
                await setKitPrimaryPhoto(id, mediaId);
              }}
            />
          </div>

          {/* Notes */}
          <NotesEditor
            initialNotes={kit.notes || ""}
            queryKey={["kit", orgId, id]}
            onSave={(notes) => updateKitNotes(id, notes)}
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
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="CHECKED_OUT">Deployed</option>
                  <option value="IN_MAINTENANCE">In Maintenance</option>
                  <option value="RETIRED">Retired</option>
                  <option value="INCOMPLETE">Incomplete</option>
                </select>
              </CanDo>
              <StatusIndicator category="condition" value={kit.condition} label={conditionLabels[kit.condition] || formatLabel(kit.condition)} />
            </SidebarSection>

            {/* Kit Info */}
            <SidebarSection title="Details">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-fg-3">Asset Tag</span>
                  <span className="font-mono font-medium">{kit.assetTag}</span>
                </div>
                {kit.category && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Category</span>
                    <span className="font-medium">{kit.category.name}</span>
                  </div>
                )}
                {kit.caseType && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Case Type</span>
                    <span className="font-medium">{kit.caseType}</span>
                  </div>
                )}
                {kit.caseDimensions && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Dimensions</span>
                    <span className="font-medium">{kit.caseDimensions}</span>
                  </div>
                )}
                {kit.weight && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Weight</span>
                    <span className="font-medium t-data">{Number(kit.weight)} kg</span>
                  </div>
                )}
                {kit.location && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Location</span>
                    <span className="font-medium">{kit.location.name}</span>
                  </div>
                )}
                {kit.purchaseDate && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Purchased</span>
                    <span className="font-medium">{formatDate(kit.purchaseDate)}</span>
                  </div>
                )}
                {kit.purchasePrice && (
                  <div className="flex justify-between">
                    <span className="text-fg-3">Purchase Price</span>
                    <span className="font-medium t-data">${Number(kit.purchasePrice).toFixed(2)}</span>
                  </div>
                )}
                {kit.description && (
                  <p className="text-fg-3 pt-1">{kit.description}</p>
                )}
              </div>
            </SidebarSection>

            {/* Contents Summary */}
            <SidebarSection title="Contents">
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-fg-3" />
                  <span className="t-data">{kit.serializedItems.length}</span>
                  <span className="text-fg-3">serialized item{kit.serializedItems.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Boxes className="h-3.5 w-3.5 text-fg-3" />
                  <span className="t-data">{kit.bulkItems.length}</span>
                  <span className="text-fg-3">bulk item{kit.bulkItems.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </SidebarSection>

            {/* Current Assignment */}
            <SidebarSection title="Assignment">
              {currentAssignment ? (
                <div className="text-sm space-y-1">
                  <Link
                    href={`/projects/${currentAssignment.projectId}`}
                    className="font-medium text-fg hover:underline"
                  >
                    {currentAssignment.project.name}
                  </Link>
                  <p className="text-xs text-fg-3">{currentAssignment.project.projectNumber}</p>
                  <Badge variant="outline">
                    {lineItemStatusLabels[currentAssignment.status] || formatLabel(currentAssignment.status)}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-fg-3">Not currently assigned</p>
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
      description="All project assignments for the kit and its contents will be marked as returned. The kit moves back to AVAILABLE. Use when scanning isn't possible."
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
          <DialogTitle>Add Items to Kit</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-3">
          Scan a barcode or search for an asset to add it to the list. Repeat for multiple items.
        </p>
        <ScanInput
          availableAssets={availableAssets}
          stagedIds={new Set(stagedItems.map((i) => i.assetId))}
          onAdd={(asset) => {
            setStagedItems((prev) => [
              ...prev,
              { assetId: asset.id, assetTag: asset.assetTag, modelName: asset.model.name },
            ]);
          }}
        />
        {stagedItems.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {stagedItems.map((item, i) => (
              <div key={item.assetId} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-mono font-medium">{item.assetTag}</span>
                  <span className="text-fg-3 ml-2 break-words">{item.modelName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStagedItems((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 text-fg-3 hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowAddItem(false); setStagedItems([]); }}>
            Cancel
          </Button>
          <Button
            onClick={() => addItemsMutation.mutate()}
            disabled={stagedItems.length === 0 || addItemsMutation.isPending}
          >
            {addItemsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {stagedItems.length} Item{stagedItems.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Add Bulk Item Dialog */}
    <Dialog open={showAddBulkItem} onOpenChange={setShowAddBulkItem}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Bulk Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Bulk Asset</Label>
            <ComboboxPicker
              value={addBulkAssetId}
              onChange={setAddBulkAssetId}
              options={availableBulkAssets.map((a) => ({
                value: a.id,
                label: a.assetTag,
                description: `${a.model.name} (${a.availableQuantity} available)`,
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
            disabled={!addBulkAssetId || addBulkQuantity < 1 || addBulkMutation.isPending}
          >
            {addBulkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Bulk Item
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
  model: { name: string };
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter out already-staged assets
  const filtered = useMemo(() => {
    const remaining = availableAssets.filter((a) => !stagedIds.has(a.id));
    if (!search) return remaining.slice(0, 20);
    const lower = search.toLowerCase();
    return remaining.filter(
      (a) =>
        a.assetTag.toLowerCase().includes(lower) ||
        a.model.name.toLowerCase().includes(lower),
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

  const handleCameraScan = useCallback(
    (value: string) => {
      const remaining = availableAssets.filter((a) => !stagedIds.has(a.id));
      const lower = value.toLowerCase();
      const exact = remaining.find((a) => a.assetTag.toLowerCase() === lower);
      const partial = remaining.find(
        (a) => a.assetTag.toLowerCase().includes(lower) || a.model.name.toLowerCase().includes(lower),
      );
      const match = exact || partial;
      if (match) {
        onAdd(match);
        toast.success(`Added ${match.assetTag}`);
      } else {
        toast.error(`No matching asset for "${value}"`);
      }
    },
    [availableAssets, stagedIds, onAdd],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="relative">
          <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-fg-3" />
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
            className="pl-9 pr-10"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setCameraOpen((v) => !v)}
            className={`absolute right-2 top-2 rounded p-0.5 transition-colors ${cameraOpen ? "text-primary bg-primary/10" : "text-fg-3 hover:text-fg"}`}
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
        {showResults && search && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-fg-3">
                No matching available assets.
              </div>
            ) : (
              filtered.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(asset)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <span className="font-mono font-medium">{asset.assetTag}</span>
                  <span className="text-fg-3">{asset.model.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {cameraOpen && (
        <BarcodeScanner
          open={cameraOpen}
          onScan={handleCameraScan}
          onClose={() => setCameraOpen(false)}
          title="Scan asset barcode"
          continuous
        />
      )}
    </div>
  );
}
