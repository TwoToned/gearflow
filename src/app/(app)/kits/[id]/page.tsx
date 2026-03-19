"use client";

import { use, useState, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Loader2, X, ScanBarcode, Camera, RotateCcw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotesEditor } from "@/components/ui/notes-editor";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { resolveKitPhotoUrl } from "@/lib/media-utils";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { BookingCalendar } from "@/components/bookings/booking-calendar";
import { BarcodeScanner } from "@/components/ui/barcode-scanner";
import { useActiveOrganization } from "@/lib/auth-client";
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

const statusColors: Record<string, string> = {
  AVAILABLE: "bg-green-500/10 text-green-500 border-green-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  IN_MAINTENANCE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  RETIRED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  INCOMPLETE: "bg-red-500/10 text-red-500 border-red-500/20",
};

const conditionColors: Record<string, string> = {
  NEW: "bg-green-500/10 text-green-500 border-green-500/20",
  GOOD: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  FAIR: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  POOR: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  DAMAGED: "bg-red-500/10 text-red-500 border-red-500/20",
};

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["kits"] });
      if (result.deleted) {
        toast.success("Prep-kit dissolved and all contents returned");
        router.push("/kits");
      } else {
        toast.success("Kit force returned to available");
        queryClient.invalidateQueries({ queryKey: ["kit", orgId, id] });
      }
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
  if (!kit) return <div className="py-20 text-center text-muted-foreground">Kit not found.</div>;

  const kitPhotos = ((kit.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const kitPhotoUrl = resolveKitPhotoUrl(kit, false);

  return (
    <RequirePermission resource="kit" action="read">
    <PageMeta title={kit ? `${kit.assetTag}${kit.name ? ` — ${kit.name}` : ""}` : undefined} />
    <div className="space-y-6">
      {/* Header */}
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
            <h1 className="t-title text-fg font-mono">{kit.assetTag}</h1>
            <CanDo resource="kit" action="update" fallback={
              <Badge variant="outline" className={statusColors[kit.status] || ""}>
                {kitStatusLabels[kit.status] || formatLabel(kit.status)}
              </Badge>
            }>
              <select
                value={kit.status}
                onChange={(e) => statusMutation.mutate(e.target.value)}
                disabled={statusMutation.isPending}
                className="h-7 rounded-md border border-input bg-transparent px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="AVAILABLE">Available</option>
                <option value="CHECKED_OUT">Deployed</option>
                <option value="IN_MAINTENANCE">In Maintenance</option>
                <option value="RETIRED">Retired</option>
                <option value="INCOMPLETE">Incomplete</option>
              </select>
            </CanDo>
            <Badge variant="outline" className={conditionColors[kit.condition] || ""}>
              {conditionLabels[kit.condition] || formatLabel(kit.condition)}
            </Badge>
            {kit.caseType && (
              <Badge variant="secondary">{kit.caseType}</Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {kit.name}
            {kit.category && <> &middot; {kit.category.name}</>}
          </p>
          </div>
        </div>
        <CanDo resource="kit" action="update">
          <div className="flex flex-wrap gap-2">
            {kit.status === "CHECKED_OUT" && (
              <Button
                variant="outline"
                size="sm"
                className="text-amber-600"
                onClick={() => { if (confirm("Force return this kit and all its contents? All project assignments will be marked as returned.")) forceReturnMutation.mutate(); }}
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
          </div>
        </CanDo>
      </div>

      {/* Kit Info Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Kit Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Case Type</span>
                <span className="font-medium">{kit.caseType || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Dimensions</span>
                <span className="font-medium">{kit.caseDimensions || "—"}</span>
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Weight</span>
                <span className="font-medium">{kit.weight ? `${Number(kit.weight)} kg` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Location</span>
                <span className="font-medium">{kit.location?.name || "—"}</span>
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Category</span>
                <span className="font-medium">{kit.category?.name || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Purchase Date</span>
                <span className="font-medium">{formatDate(kit.purchaseDate)}</span>
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Purchase Price</span>
                <span className="font-medium">
                  {kit.purchasePrice ? `$${Number(kit.purchasePrice).toFixed(2)}` : "—"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <BookingCalendar entityType="kit" entityId={id} initialDate={initialDate} />

      {/* Contents Card */}
      <Card id="kit-contents">
        <CardHeader>
          <CardTitle className="text-base">Contents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Serialized Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Serialized Items</h3>
              <CanDo resource="kit" action="update">
                <Button size="sm" variant="outline" onClick={() => setShowAddItem(true)}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add Item
                </Button>
              </CanDo>
            </div>
            {kit.serializedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No serialized items in this kit.
              </p>
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
                        <TableCell className="text-muted-foreground">
                          {item.position || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={conditionColors[item.asset.condition] || ""}>
                            {item.asset.condition}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <CanDo resource="kit" action="update">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive"
                              onClick={() => {
                                if (confirm("Remove this item from the kit?")) {
                                  removeItemMutation.mutate(item.assetId);
                                }
                              }}
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
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Bulk Items</h3>
              <CanDo resource="kit" action="update">
                <Button size="sm" variant="outline" onClick={() => setShowAddBulkItem(true)}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add Bulk Item
                </Button>
              </CanDo>
            </div>
            {kit.bulkItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No bulk items in this kit.
              </p>
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
                        <TableCell className="text-right font-medium">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.position || "—"}
                        </TableCell>
                        <TableCell>
                          <CanDo resource="kit" action="update">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive"
                              onClick={() => {
                                if (confirm("Remove this bulk item from the kit?")) {
                                  removeBulkMutation.mutate(item.id);
                                }
                              }}
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
        </CardContent>
      </Card>

      {/* History Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">History</CardTitle>
        </CardHeader>
        <CardContent>
          {kit.lineItems.length === 0 && kit.scanLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No history for this kit yet.
            </p>
          ) : (
            <div className="space-y-4">
              {kit.lineItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Project Assignments</h4>
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
                              <p className="text-xs text-muted-foreground">{li.project.projectNumber}</p>
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
                  <h4 className="text-sm font-medium mb-2">Recent Scans</h4>
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
                            <TableCell className="text-sm">{log.scannedBy?.name || "—"}</TableCell>
                            <TableCell className="text-sm">
                              {log.project ? (
                                <Link href={`/projects/${log.projectId}`} className="hover:underline">
                                  {log.project.name}
                                </Link>
                              ) : (
                                "—"
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
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photos ({kitPhotos.length})</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Notes */}
      <NotesEditor
        initialNotes={kit.notes || ""}
        queryKey={["kit", orgId, id]}
        onSave={(notes) => updateKitNotes(id, notes)}
        placeholder="Add notes about this kit..."
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
          <p className="text-sm text-muted-foreground">
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
                    <span className="text-muted-foreground ml-2 break-words">{item.modelName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStagedItems((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
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
    </div>
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
          <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
            className={`absolute right-2 top-2 rounded p-0.5 transition-colors ${cameraOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
        {showResults && search && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
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
                  <span className="text-muted-foreground">{asset.model.name}</span>
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
