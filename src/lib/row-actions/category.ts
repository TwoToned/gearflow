import { Eye, EyeOff, Package, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import type { CategoryPricingDisplay } from "@/lib/category-pricing-display";
import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";

export interface CategoryActionRow {
  name: string;
  pricingDisplay?: CategoryPricingDisplay;
}

export interface CategoryActionCtx {
  onAddEquipment?: () => void;
  onAddKit?: () => void;
  onAddCustom?: () => void;
  onRename?: () => void;
  onSetPricingDisplay?: (next: CategoryPricingDisplay) => void;
  /** Opens `DeleteCategoryDialog`, which says what happens downstream (no inline confirm). */
  onRemove?: () => void;
}

type Entry = ActionItem | false | undefined | null;

function pricingEntry(row: CategoryActionRow, ctx: CategoryActionCtx): Entry {
  if (!ctx.onSetPricingDisplay) return false;
  const rolled = row.pricingDisplay === "ROLLUP";
  const next: CategoryPricingDisplay = rolled ? "ITEMISED" : "ROLLUP";
  return {
    key: "pricing-display", label: rolled ? "Show each price" : "Combine into one price", group: "documents",
    icon: rolled ? Eye : EyeOff, onSelect: () => ctx.onSetPricingDisplay!(next),
  };
}

export const buildCategoryActions: RowActionBuilder<CategoryActionRow, CategoryActionCtx> = (row, ctx): ActionMenuSpec => {
  const entries: Entry[] = [
    ctx.onAddEquipment && { key: "add-equipment", label: "Add equipment", group: "edit", icon: Plus, onSelect: ctx.onAddEquipment },
    ctx.onAddKit && { key: "add-kit", label: "Add kit", group: "edit", icon: Package, onSelect: ctx.onAddKit },
    ctx.onAddCustom && { key: "add-custom", label: "Add custom item", group: "edit", icon: Sparkles, onSelect: ctx.onAddCustom },
    ctx.onRename && { key: "rename", label: "Rename", group: "edit", icon: Pencil, onSelect: ctx.onRename },
    pricingEntry(row, ctx),
    ctx.onRemove && { key: "delete", label: "Delete", group: "danger", kbd: "D", danger: true, icon: Trash2, onSelect: ctx.onRemove },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
};
