"use client";

import { useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Loader2, Plus, X, Cable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getAvailableAccessoryAssets,
  addSerializedChildToAsset,
  addBulkChildToAsset,
  removeSerializedChildFromAsset,
  removeBulkChildFromAsset,
} from "@/server/asset-accessories";
import { getAvailableBulkAssetsForKit } from "@/server/kits";

type SerializedChild = {
  id: string;
  assetTag: string;
  model?: { name?: string | null; manufacturer?: string | null } | null;
};
type BulkChild = {
  id: string;
  quantity: number;
  allocationMode: "SHIPS_WITH" | "DEDICATED";
  bulkAssetId?: string | null;
  bulkAsset?: { assetTag?: string | null; model?: { name?: string | null } | null } | null;
};

type InheritedBulk = {
  id: string;
  quantity: number;
  bulkAssetId: string;
  bulkAsset?: { assetTag?: string | null; model?: { name?: string | null } | null } | null;
};

interface Props {
  assetId: string;
  childAssets: SerializedChild[];
  childBulkItems: BulkChild[];
  /** Bulk accessories from the asset's MODEL — read-only, render with a "from model" tag.
   *  An entry is hidden when the asset has its own row for the same bulkAssetId (override). */
  inheritedBulkItems?: InheritedBulk[];
  /** Called after an attach/detach succeeds so the parent detail page re-reads
   *  getAsset (the source of truth for childAssets / childBulkItems). Replaces the
   *  old React Query `invalidateQueries(["asset"])` now that the page is on the
   *  Convex version-vector reactive composite. */
  onChanged?: () => void;
}

export function AssetAccessoriesManager({
  assetId,
  childAssets,
  childBulkItems,
  inheritedBulkItems = [],
  onChanged,
}: Props) {
  const ownBulkIds = new Set(childBulkItems.map((c) => c.bulkAssetId).filter(Boolean) as string[]);
  const visibleInherited = inheritedBulkItems.filter((i) => !ownBulkIds.has(i.bulkAssetId));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"serialized" | "bulk">("serialized");

  const [serialId, setSerialId] = useState("");
  const [bulkId, setBulkId] = useState("");
  const [bulkQty, setBulkQty] = useState(1);

  const refresh = () => onChanged?.();
  const hasAny =
    childAssets.length > 0 || childBulkItems.length > 0 || visibleInherited.length > 0;

  const { data: availableAssets = [] } = useServerQuery({
    queryKey: ["accessory-assets", assetId],
    queryFn: () => getAvailableAccessoryAssets(assetId) as Promise<SerializedChild[]>,
    enabled: open && tab === "serialized",
  });
  const { data: availableBulk = [] } = useServerQuery({
    queryKey: ["accessory-bulk"],
    queryFn: () =>
      getAvailableBulkAssetsForKit() as Promise<
        Array<{ id: string; assetTag: string; model: { name: string }; availableQuantity: number }>
      >,
    enabled: open && tab === "bulk",
  });

  const addSerial = useServerMutation({
    mutationFn: () => addSerializedChildToAsset(assetId, { childAssetId: serialId }),
    onSuccess: () => {
      toast.success("Accessory attached");
      setSerialId("");
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const addBulk = useServerMutation({
    mutationFn: () => addBulkChildToAsset(assetId, { bulkAssetId: bulkId, quantity: bulkQty }),
    onSuccess: () => {
      toast.success("Accessory attached");
      setBulkId("");
      setBulkQty(1);
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeSerial = useServerMutation({
    mutationFn: (childId: string) => removeSerializedChildFromAsset(assetId, childId),
    onSuccess: () => {
      toast.success("Accessory detached");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeBulk = useServerMutation({
    mutationFn: (bulkChildId: string) => removeBulkChildFromAsset(assetId, bulkChildId),
    onSuccess: () => {
      toast.success("Accessory detached");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Accessories</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Attach
        </Button>
      </div>

      {!hasAny ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          <Cable className="mx-auto mb-1 h-5 w-5 opacity-60" />
          No accessories attached. Cables, clamps and adaptors attached here travel
          with this asset onto projects and through the warehouse.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {childAssets.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground/60 select-none">└─</span>
              <span className="font-medium">{c.assetTag}</span>
              <span className="text-muted-foreground">{c.model?.name ?? ""}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">accessory</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeSerial.mutate(c.id)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
          {childBulkItems.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground/60 select-none">└─</span>
              <span className="font-medium">{c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {c.allocationMode === "DEDICATED" ? "dedicated" : "ships-with"}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">accessory</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeBulk.mutate(c.id)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
          {visibleInherited.map((c) => (
            <li key={`inh-${c.id}`} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground/60 select-none">└─</span>
              <span className="font-medium">{c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">from model</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">accessory</span>
              {/* No X — inherited rows are managed on the Model page. */}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach accessory</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2">
            <Button size="sm" variant={tab === "serialized" ? "default" : "outline"} onClick={() => setTab("serialized")}>
              Tracked asset
            </Button>
            <Button size="sm" variant={tab === "bulk" ? "default" : "outline"} onClick={() => setTab("bulk")}>
              Bulk item
            </Button>
          </div>

          {tab === "serialized" ? (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Accessory asset</Label>
                <ComboboxPicker
                  value={serialId}
                  onChange={setSerialId}
                  options={availableAssets.map((a) => ({
                    value: a.id,
                    label: a.assetTag,
                    description: a.model?.name ?? undefined,
                  }))}
                  placeholder="Select an asset..."
                  searchPlaceholder="Search available assets..."
                />
              </div>
              <DialogFooter>
                <Button disabled={!serialId || addSerial.isPending} onClick={() => addSerial.mutate()}>
                  {addSerial.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Attach
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>Bulk asset</Label>
                <ComboboxPicker
                  value={bulkId}
                  onChange={setBulkId}
                  options={availableBulk.map((a) => ({
                    value: a.id,
                    label: a.assetTag,
                    description: `${a.model.name} (${a.availableQuantity} available)`,
                  }))}
                  placeholder="Select a bulk asset..."
                  searchPlaceholder="Search bulk assets..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-qty">Quantity</Label>
                <Input id="acc-qty" type="number" min={1} value={bulkQty} onChange={(e) => setBulkQty(Number(e.target.value))} />
              </div>
              <p className="text-xs text-muted-foreground">
                These are drawn from the shared pool each time this asset goes
                out, then counted back in on return.
              </p>
              <DialogFooter>
                <Button disabled={!bulkId || addBulk.isPending} onClick={() => addBulk.mutate()}>
                  {addBulk.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Attach
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
