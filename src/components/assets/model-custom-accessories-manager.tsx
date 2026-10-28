"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useModelCustomAccessoryWrites } from "@/hooks/use-model-custom-accessory-writes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Inclusion = "DEFAULT" | "OPTIONAL";

export type CustomAccessory = { id: string; name: string; quantity: number; inclusion?: Inclusion };

const INCLUSION_LABEL: Record<Inclusion, string> = { DEFAULT: "default", OPTIONAL: "optional" };

/**
 * Model-level CUSTOM accessories: a free-text item (not in inventory) every unit
 * of the model ships with. They behave like catalog accessories on projects —
 * DEFAULT auto-attaches, OPTIONAL is offered at add time, both print on every
 * document and travel through the warehouse. Sits under `ModelAccessoriesManager`.
 */
export function ModelCustomAccessoriesManager({
  modelId,
  customAccessories,
  onChanged,
}: {
  modelId: string;
  customAccessories: CustomAccessory[];
  onChanged?: () => void;
}) {
  const writes = useModelCustomAccessoryWrites();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [inclusion, setInclusion] = useState<Inclusion>("DEFAULT");

  const add = useServerMutation({
    mutationFn: () => writes.add(modelId, { name, quantity: Number(qty), inclusion }),
    onSuccess: () => {
      toast.success("Custom accessory added");
      setName("");
      setQty("1");
      setInclusion("DEFAULT");
      onChanged?.();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useServerMutation({
    mutationFn: (id: string) => writes.remove(modelId, id),
    onSuccess: () => {
      toast.success("Custom accessory removed");
      onChanged?.();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3" data-testid="model-custom-accessories">
      <p className="t-overline text-muted">Custom accessories</p>
      <p className="text-caption text-muted">
        Not in inventory? Type it in — it travels and prints like any other accessory.
      </p>
      {customAccessories.length > 0 && (
        <ul className="space-y-1.5">
          {customAccessories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-ui-text">
              <span className="text-muted select-none">└─</span>
              <span className="font-medium text-ink">
                <span className="t-data tabular-nums">{c.quantity}×</span> {c.name}
              </span>
              <span className="ml-auto text-badge text-muted">{INCLUSION_LABEL[c.inclusion ?? "DEFAULT"]}</span>
              <Button
                size="icon"
                variant="ghost"
                className="touch-target size-7"
                aria-label={`Remove ${c.name}`}
                onClick={() => remove.mutate(c.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input aria-label="Custom accessory name" placeholder="e.g. Foam windshield" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="Quantity per asset" className="w-20" type="number" min={1} max={1000} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Select value={inclusion} onValueChange={(v) => setInclusion(v as Inclusion)}>
            <SelectTrigger aria-label="Inclusion">
              <SelectValue>{INCLUSION_LABEL[inclusion]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DEFAULT">Default (auto-attaches)</SelectItem>
              <SelectItem value="OPTIONAL">Optional (PM picks at add-time)</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="line" disabled={!name.trim() || Number(qty) < 1} loading={add.isPending} onClick={() => add.mutate()}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}
