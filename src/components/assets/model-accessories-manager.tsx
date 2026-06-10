"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
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
  addModelBulkAccessory,
  removeModelBulkAccessory,
} from "@/server/model-accessories";
import { getAvailableBulkAssetsForKit } from "@/server/kits";

type BulkAccessory = {
  id: string;
  quantity: number;
  bulkAsset?: { assetTag?: string | null; model?: { name?: string | null } | null } | null;
};

interface Props {
  modelId: string;
  bulkAccessories: BulkAccessory[];
  /** Called after an add/remove so the parent detail page can refetch. */
  onChanged?: () => void;
}

export function ModelAccessoriesManager({ modelId, bulkAccessories, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [bulkId, setBulkId] = useState("");
  const [bulkQty, setBulkQty] = useState(1);

  const refresh = () => onChanged?.();
  const hasAny = bulkAccessories.length > 0;

  const { data: availableBulk = [] } = useServerQuery({
    queryKey: ["model-accessory-bulk"],
    queryFn: () =>
      getAvailableBulkAssetsForKit() as Promise<
        Array<{ id: string; assetTag: string; model: { name: string }; availableQuantity: number }>
      >,
    enabled: open,
  });

  const add = useServerMutation({
    mutationFn: () => addModelBulkAccessory(modelId, { bulkAssetId: bulkId, quantity: bulkQty }),
    onSuccess: () => {
      toast.success("Default accessory added");
      setBulkId("");
      setBulkQty(1);
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useServerMutation({
    mutationFn: (id: string) => removeModelBulkAccessory(modelId, id),
    onSuccess: () => {
      toast.success("Default accessory removed");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Default accessories
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {!hasAny ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          <Cable className="mx-auto mb-1 h-5 w-5 opacity-60" />
          No defaults yet. Bulk accessories added here travel with every asset of this
          model onto projects.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {bulkAccessories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground/60 select-none">└─</span>
              <span className="font-medium">
                {c.quantity}× {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                default
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => remove.mutate(c.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add default accessory</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Every asset of this model will inherit this. A specific asset can override
            the quantity with its own attachment.
          </p>
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
              <Label htmlFor="acc-qty">Quantity per asset</Label>
              <Input
                id="acc-qty"
                type="number"
                min={1}
                value={bulkQty}
                onChange={(e) => setBulkQty(Number(e.target.value))}
              />
            </div>
            <DialogFooter>
              <Button disabled={!bulkId || add.isPending} onClick={() => add.mutate()}>
                {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
