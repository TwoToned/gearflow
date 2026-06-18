"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import { Plus, X, Cable } from "lucide-react";
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
        <p className="t-overline text-muted">
          Default accessories
        </p>
        <Button size="sm" variant="line" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {!hasAny ? (
        <div className="rounded-[var(--r)] border-2 border-dashed border-line-2 p-4 text-center text-ui-text text-muted">
          <Cable className="mx-auto mb-1 h-5 w-5 opacity-60" />
          No defaults yet. Bulk accessories added here travel with every asset of this
          model onto projects.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {bulkAccessories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-ui-text">
              <span className="text-faint select-none">└─</span>
              <span className="font-medium text-ink">
                <span className="t-data tabular-nums">{c.quantity}×</span> {c.bulkAsset?.model?.name ?? c.bulkAsset?.assetTag}
              </span>
              <span className="ml-auto text-badge text-muted">
                default
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
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
          <p className="text-caption text-muted">
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
              <Button disabled={!bulkId} loading={add.isPending} onClick={() => add.mutate()}>
                Add
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
