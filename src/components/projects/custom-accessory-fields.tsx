"use client";

/**
 * "Add custom accessory" — free-text accessories for ONE line (not in the
 * catalog). They ride `accessoryPlan.custom` and become ordinary accessory
 * child lines server-side, so they pack, deploy, return and print like any
 * other accessory. Controlled; the caller owns the list.
 */

import { useState } from "react";
import { createId } from "@paralleldrive/cuid2";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomAccessoryInput } from "@/hooks/use-line-item-writes";

export function CustomAccessoryFields({
  custom,
  onChange,
  quantity,
}: {
  custom: CustomAccessoryInput[];
  onChange: (next: CustomAccessoryInput[]) => void;
  /** The parent line's quantity — each custom row's count is per parent. */
  quantity: number;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");

  const parsedQty = Math.floor(Number(qty));
  const canAdd = name.trim().length > 0 && Number.isFinite(parsedQty) && parsedQty >= 1 && parsedQty <= 1000;

  function add() {
    if (!canAdd) return;
    onChange([...custom, { key: createId(), name: name.trim().slice(0, 120), quantityPerParent: parsedQty }]);
    setName("");
    setQty("1");
  }

  return (
    <div className="space-y-1.5" data-testid="custom-accessory-fields">
      <p className="t-micro text-muted">Custom (this line only)</p>
      {custom.map((c) => (
        <div key={c.key} className="flex items-center gap-2.5">
          <span className="flex-1 text-ui-text text-ink-2">
            <span className="t-data tabular-nums">{c.quantityPerParent * quantity}×</span> {c.name}
          </span>
          <Button
            type="button"
            variant="line"
            size="icon"
            aria-label={`Remove ${c.name}`}
            onClick={() => onChange(custom.filter((x) => x.key !== c.key))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          aria-label="Custom accessory name"
          placeholder="e.g. Gaffer tape"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Input
          aria-label="Custom accessory quantity per item"
          className="w-20"
          type="number"
          min={1}
          max={1000}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Button type="button" variant="line" disabled={!canAdd} onClick={add}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}
