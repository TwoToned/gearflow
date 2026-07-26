"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import { Plus, X, Cable, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModelAccessoryWrites } from "@/hooks/use-model-accessories-writes";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";

type Inclusion = "DEFAULT" | "OPTIONAL";

type BulkAccessory = {
  id: string;
  quantity: number;
  inclusion?: Inclusion;
  bulkAsset?: { assetTag?: string | null; model?: { name?: string | null } | null } | null;
};

interface Props {
  modelId: string;
  bulkAccessories: BulkAccessory[];
  /** Called after an add/remove/update so the parent detail page can refetch. */
  onChanged?: () => void;
}

const INCLUSION_LABEL: Record<Inclusion, string> = {
  DEFAULT: "default",
  OPTIONAL: "optional",
};

/** Edit-accessory dialog — split out of ModelAccessoriesManager so the parent's
 *  own branch count stays under the complexity ratchet (R-3.6); this component
 *  owns its own qty/inclusion draft state, reset via `key={accessory.id}` by
 *  the caller (see below). */
function EditAccessoryDialog({
  accessory,
  onClose,
  onSave,
  saving,
}: {
  accessory: BulkAccessory;
  onClose: () => void;
  onSave: (values: { quantity: number; inclusion: Inclusion }) => void;
  saving: boolean;
}) {
  const [editQty, setEditQty] = useState(accessory.quantity);
  const [editInclusion, setEditInclusion] = useState<Inclusion>(accessory.inclusion ?? "DEFAULT");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {accessory.bulkAsset?.model?.name ?? accessory.bulkAsset?.assetTag}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="acc-edit-qty">Quantity per asset</Label>
            <Input
              id="acc-edit-qty"
              type="number"
              min={1}
              value={editQty}
              onChange={(e) => setEditQty(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>Inclusion</Label>
            <Select value={editInclusion} onValueChange={(v) => setEditInclusion(v as Inclusion)}>
              <SelectTrigger>
                <SelectValue>{INCLUSION_LABEL[editInclusion]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">Default (auto-attaches)</SelectItem>
                <SelectItem value="OPTIONAL">Optional (PM picks at add-time)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button loading={saving} onClick={() => onSave({ quantity: editQty, inclusion: editInclusion })}>
              Save
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ModelAccessoriesManager({ modelId, bulkAccessories, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [bulkId, setBulkId] = useState("");
  const [bulkQty, setBulkQty] = useState(1);
  const [inclusion, setInclusion] = useState<Inclusion>("DEFAULT");

  const [editing, setEditing] = useState<BulkAccessory | null>(null);

  const refresh = () => onChanged?.();
  const hasAny = bulkAccessories.length > 0;
  const writes = useModelAccessoryWrites();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: availableBulk = [] } = useServerQuery({
    queryKey: ["model-accessory-bulk", orgId, isAuthenticated],
    queryFn: () =>
      convex.query(api.kits.availableBulkAssets, { orgId: orgId as string }) as unknown as Promise<
        Array<{ id: string; assetTag: string; model: { name: string }; availableQuantity: number }>
      >,
    enabled: open && !!orgId && isAuthenticated,
  });

  const add = useServerMutation({
    mutationFn: () => writes.add(modelId, { bulkAssetId: bulkId, quantity: bulkQty, inclusion }),
    onSuccess: () => {
      toast.success("Accessory added");
      setBulkId("");
      setBulkQty(1);
      setInclusion("DEFAULT");
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useServerMutation({
    mutationFn: (id: string) => writes.remove(modelId, id),
    onSuccess: () => {
      toast.success("Accessory removed");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = useServerMutation({
    mutationFn: (values: { quantity: number; inclusion: Inclusion }) => {
      if (!editing) throw new Error("Nothing to edit");
      return writes.update(modelId, editing.id, values);
    },
    onSuccess: () => {
      toast.success("Accessory updated");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="t-overline text-muted">
          Accessories
        </p>
        <Button size="sm" variant="line" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {!hasAny ? (
        <div className="rounded-[var(--r)] border-2 border-dashed border-line-2 p-4 text-center text-ui-text text-muted">
          <Cable className="mx-auto mb-1 h-5 w-5 opacity-60" />
          No accessories yet. Defaults travel with every asset of this model onto
          projects automatically; optionals are offered as a pick when adding to a
          project.
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
                {INCLUSION_LABEL[c.inclusion ?? "DEFAULT"]}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="touch-target size-7"
                onClick={() => setEditing(c)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="touch-target size-7"
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
            <DialogTitle>Add accessory</DialogTitle>
          </DialogHeader>
          <p className="text-caption text-muted">
            Default accessories auto-attach when this model is added to a project
            (the PM can deselect one per line). Optional accessories are offered as
            a pick at add-time and never auto-attach.
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
            <div className="space-y-2">
              <Label>Inclusion</Label>
              <Select value={inclusion} onValueChange={(v) => setInclusion(v as Inclusion)}>
                <SelectTrigger>
                  <SelectValue>{INCLUSION_LABEL[inclusion]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFAULT">Default (auto-attaches)</SelectItem>
                  <SelectItem value="OPTIONAL">Optional (PM picks at add-time)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button disabled={!bulkId} loading={add.isPending} onClick={() => add.mutate()}>
                Add
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {editing && (
        <EditAccessoryDialog
          key={editing.id}
          accessory={editing}
          onClose={() => setEditing(null)}
          onSave={(values) => update.mutate(values)}
          saving={update.isPending}
        />
      )}
    </div>
  );
}
