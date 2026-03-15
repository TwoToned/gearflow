"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  PackageCheck,
  PackagePlus,
  PackageX,
  PackageOpen,
  Trash2,
  X,
  ScanBarcode,
  Unlock,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import {
  getProjectPreps,
  createPrep,
  deletePrep,
  addPrepItem,
  removePrepItem,
  markPrepPacked,
  reopenPrep,
  checkOutPrep,
  checkInPrep,
  unpackPrep,
} from "@/server/preps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useActiveOrganization } from "@/lib/auth-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrepItemData {
  id: string;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  quantity: number;
  asset: { assetTag: string; model: { name: string } } | null;
  bulkAsset: { assetTag: string; model: { name: string } } | null;
  kit: { id: string; assetTag: string; name: string } | null;
  lineItem: { id: string } | null;
  addedBy: { name: string } | null;
  addedAt: string | Date;
}

interface PrepData {
  id: string;
  name: string;
  status: string;
  notes: string | null;
  containerAssetId: string | null;
  containerAsset: { assetTag: string; model: { name: string } } | null;
  items: PrepItemData[];
  preparedBy: { name: string } | null;
  preparedAt: string | Date | null;
  checkedOutAt: string | Date | null;
  returnedAt: string | Date | null;
  project: { id: string; name: string; projectNumber: string };
  createdAt: string | Date;
}

const prepStatusColors: Record<string, string> = {
  PACKING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  PACKED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  UNPACKED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
};

const prepStatusLabels: Record<string, string> = {
  PACKING: "Packing",
  PACKED: "Packed",
  CHECKED_OUT: "Deployed",
  RETURNED: "Returned",
  UNPACKED: "Unpacked",
  CANCELLED: "Cancelled",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PrepsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailPrepId, setDetailPrepId] = useState<string | null>(null);
  const [newPrepName, setNewPrepName] = useState("");
  const [newPrepNotes, setNewPrepNotes] = useState("");

  const { data: preps, isLoading } = useQuery({
    queryKey: ["project-preps", orgId, projectId],
    queryFn: () => getProjectPreps(projectId),
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-preps", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-project", orgId, projectId] });
  }, [queryClient, orgId, projectId]);

  const createMutation = useMutation({
    mutationFn: () => createPrep({ projectId, name: newPrepName, notes: newPrepNotes || null }),
    onSuccess: (prep) => {
      toast.success(`Created prep "${prep.name}"`);
      setCreateOpen(false);
      setNewPrepName("");
      setNewPrepNotes("");
      invalidate();
      setDetailPrepId(prep.id);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePrep(id),
    onSuccess: () => { toast.success("Prep deleted"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const markPackedMutation = useMutation({
    mutationFn: (id: string) => markPrepPacked(id),
    onSuccess: () => { toast.success("Prep marked as packed"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => reopenPrep(id),
    onSuccess: () => { toast.success("Prep reopened for packing"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const checkOutMutation = useMutation({
    mutationFn: (id: string) => checkOutPrep(id),
    onSuccess: () => { toast.success("Prep deployed with all contents"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const checkInMutation = useMutation({
    mutationFn: (id: string) => checkInPrep(id),
    onSuccess: () => { toast.success("Prep returned"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const unpackMutation = useMutation({
    mutationFn: (id: string) => unpackPrep(id),
    onSuccess: () => { toast.success("Prep unpacked"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const detailPrep = preps?.find((p: PrepData) => p.id === detailPrepId) as PrepData | undefined;

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-center">Loading preps...</div>;
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {preps?.length ?? 0} prep{(preps?.length ?? 0) !== 1 ? "s" : ""} for this project
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PackagePlus className="mr-1.5 h-4 w-4" />
          New Prep
        </Button>
      </div>

      {/* Prep cards */}
      {preps && preps.length > 0 ? (
        <div className="grid gap-3">
          {(preps as PrepData[]).map((prep) => (
            <Card key={prep.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setDetailPrepId(prep.id)}>
              <CardContent className="py-3 flex items-center gap-3">
                <div className="shrink-0">
                  {prep.status === "PACKING" && <Package className="h-5 w-5 text-amber-500" />}
                  {prep.status === "PACKED" && <PackageCheck className="h-5 w-5 text-blue-500" />}
                  {prep.status === "CHECKED_OUT" && <PackageX className="h-5 w-5 text-purple-500" />}
                  {prep.status === "RETURNED" && <PackageOpen className="h-5 w-5 text-teal-500" />}
                  {(prep.status === "UNPACKED" || prep.status === "CANCELLED") && <Package className="h-5 w-5 text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{prep.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {prep.containerAsset && (
                      <span className="font-mono text-xs">{prep.containerAsset.assetTag}</span>
                    )}
                    <span>{prep.items.length} item{prep.items.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <Badge variant="outline" className={prepStatusColors[prep.status] || ""}>
                  {prepStatusLabels[prep.status] || prep.status}
                </Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No preps yet. Create one to start packing items.</p>
          </CardContent>
        </Card>
      )}

      {/* Create Prep Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Prep</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="prep-name">Name</Label>
              <Input
                id="prep-name"
                placeholder="e.g. FOH Rack, Mic Case A..."
                value={newPrepName}
                onChange={(e) => setNewPrepName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="prep-notes">Notes (optional)</Label>
              <Textarea
                id="prep-notes"
                placeholder="Any packing instructions..."
                value={newPrepNotes}
                onChange={(e) => setNewPrepNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newPrepName.trim() || createMutation.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prep Detail Dialog */}
      {detailPrep && (
        <PrepDetailDialog
          prep={detailPrep}
          onClose={() => setDetailPrepId(null)}
          onMarkPacked={(id) => markPackedMutation.mutate(id)}
          onReopen={(id) => reopenMutation.mutate(id)}
          onCheckOut={(id) => checkOutMutation.mutate(id)}
          onCheckIn={(id) => checkInMutation.mutate(id)}
          onUnpack={(id) => unpackMutation.mutate(id)}
          onDelete={(id) => { deleteMutation.mutate(id); setDetailPrepId(null); }}
          invalidate={invalidate}
          isPending={
            markPackedMutation.isPending ||
            reopenMutation.isPending ||
            checkOutMutation.isPending ||
            checkInMutation.isPending ||
            unpackMutation.isPending
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prep Detail Dialog (with scanner for adding items)
// ---------------------------------------------------------------------------

function PrepDetailDialog({
  prep,
  onClose,
  onMarkPacked,
  onReopen,
  onCheckOut,
  onCheckIn,
  onUnpack,
  onDelete,
  invalidate,
  isPending,
}: {
  prep: PrepData;
  onClose: () => void;
  onMarkPacked: (id: string) => void;
  onReopen: (id: string) => void;
  onCheckOut: (id: string) => void;
  onCheckIn: (id: string) => void;
  onUnpack: (id: string) => void;
  onDelete: (id: string) => void;
  invalidate: () => void;
  isPending: boolean;
}) {
  const [scanValue, setScanValue] = useState("");
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const addItemMutation = useMutation({
    mutationFn: (tag: string) => addPrepItem(prep.id, tag),
    onSuccess: (result) => {
      const matched = result.matchedLineItem ? "" : " (no matching line item)";
      toast.success(`Added ${result.assetTag} — ${result.assetName}${matched}`);
      setScanValue("");
      invalidate();
      scanInputRef.current?.focus();
    },
    onError: (err) => {
      toast.error(err.message);
      setScanValue("");
      scanInputRef.current?.focus();
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removePrepItem(itemId),
    onSuccess: () => { toast.success("Item removed"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const handleScan = useCallback((value: string) => {
    const tag = value.trim();
    if (!tag) return;
    addItemMutation.mutate(tag);
  }, [addItemMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const tag = scanValue.trim();
      if (tag) {
        addItemMutation.mutate(tag);
      }
    }
  }, [scanValue, addItemMutation]);

  const canAddItems = prep.status === "PACKING";

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {prep.name}
            <Badge variant="outline" className={prepStatusColors[prep.status] || ""}>
              {prepStatusLabels[prep.status] || prep.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {/* Container info */}
          {prep.containerAsset && (
            <div className="text-sm text-muted-foreground">
              Container: <span className="font-mono">{prep.containerAsset.assetTag}</span> — {prep.containerAsset.model.name}
            </div>
          )}

          {/* Scanner (only when packing) */}
          {canAddItems && (
            <div className="flex items-center gap-2">
              <ScanBarcode className="h-4 w-4 text-muted-foreground shrink-0" />
              <ScanInput
                ref={scanInputRef}
                placeholder="Scan or enter asset tag to add..."
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onScan={handleScan}
                continuous
                className="flex-1"
                disabled={addItemMutation.isPending}
              />
            </div>
          )}

          {/* Items list */}
          <div className="space-y-1">
            <div className="text-sm font-medium">
              Contents ({prep.items.length} item{prep.items.length !== 1 ? "s" : ""})
            </div>
            {prep.items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No items yet. Scan assets to add them.
              </p>
            ) : (
              <div className="divide-y">
                {prep.items.map((item) => {
                  const name = item.kit?.name || item.asset?.model.name || item.bulkAsset?.model.name || "Unknown";
                  const tag = item.kit?.assetTag || item.asset?.assetTag || item.bulkAsset?.assetTag || "";
                  return (
                    <div key={item.id} className="flex items-center gap-2 py-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-medium truncate">{name}</span>
                          {item.kitId && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Kit</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span className="font-mono text-xs">{tag}</span>
                          {item.bulkAssetId && <span>x{item.quantity}</span>}
                          {item.lineItem ? (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-500/10 text-green-600 border-green-500/20">
                              Matched
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20">
                              Unmatched
                            </Badge>
                          )}
                        </div>
                      </div>
                      {canAddItems && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => removeItemMutation.mutate(item.id)}
                          disabled={removeItemMutation.isPending}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <DialogFooter className="flex-wrap gap-2">
          {prep.status === "PACKING" && (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirmDelete) onDelete(prep.id);
                  else setConfirmDelete(true);
                }}
                disabled={isPending}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {confirmDelete ? "Confirm Delete" : "Delete"}
              </Button>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMarkPacked(prep.id)}
                disabled={isPending || prep.items.length === 0}
              >
                <PackageCheck className="mr-1 h-3.5 w-3.5" />
                Mark Packed
              </Button>
              <Button
                size="sm"
                onClick={() => onCheckOut(prep.id)}
                disabled={isPending || prep.items.length === 0}
              >
                <PackageX className="mr-1 h-3.5 w-3.5" />
                Deploy Now
              </Button>
            </>
          )}
          {prep.status === "PACKED" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReopen(prep.id)}
                disabled={isPending}
              >
                <Unlock className="mr-1 h-3.5 w-3.5" />
                Reopen
              </Button>
              <div className="flex-1" />
              <Button
                size="sm"
                onClick={() => onCheckOut(prep.id)}
                disabled={isPending}
              >
                <PackageX className="mr-1 h-3.5 w-3.5" />
                Deploy
              </Button>
            </>
          )}
          {prep.status === "CHECKED_OUT" && (
            <>
              <div className="flex-1" />
              <Button
                size="sm"
                onClick={() => onCheckIn(prep.id)}
                disabled={isPending}
              >
                <PackageOpen className="mr-1 h-3.5 w-3.5" />
                Return
              </Button>
            </>
          )}
          {prep.status === "RETURNED" && (
            <>
              <div className="flex-1" />
              <Button
                size="sm"
                onClick={() => onUnpack(prep.id)}
                disabled={isPending}
              >
                <PackageOpen className="mr-1 h-3.5 w-3.5" />
                Unpack
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
