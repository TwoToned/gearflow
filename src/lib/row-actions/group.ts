import { ArrowRightLeft, BookmarkPlus, Eye, EyeOff, Package, Pencil, Plus, Trash2 } from "lucide-react";

import { canRevealPriceInRollup } from "@/lib/category-pricing-display";
import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";

/** A Project Group row. Absent handler = the caller cannot do it = no menu item. */
export interface GroupActionRow {
  title: string;
  revealPriceInRollup?: boolean | null;
}

export interface GroupActionCtx {
  inRollupCategory?: boolean;
  onEditPrice?: () => void;
  onEdit?: () => void;
  onAddEquipment?: () => void;
  onAddKit?: () => void;
  onSaveAsTemplate?: () => void;
  onMoveToCategory?: () => void;
  onTogglePriceReveal?: () => void;
  onRemove?: () => void;
}

type Entry = ActionItem | false | undefined | null;

function revealEntry(row: GroupActionRow, ctx: GroupActionCtx): Entry {
  const ok =
    ctx.inRollupCategory && ctx.onTogglePriceReveal && canRevealPriceInRollup({ inProjectGroup: false, isSubHireGroupChild: false });
  return (
    ok && {
      key: "price-reveal", label: row.revealPriceInRollup ? "Hide this price" : "Show this price", group: "documents",
      icon: row.revealPriceInRollup ? EyeOff : Eye, onSelect: ctx.onTogglePriceReveal!,
    }
  );
}

/** Delete removes the group; its members stay as loose lines (delete-group dialog states the price impact). */
export const buildGroupActions: RowActionBuilder<GroupActionRow, GroupActionCtx> = (row, ctx): ActionMenuSpec => {
  const entries: Entry[] = [
    ctx.onEdit && { key: "edit", label: "Edit", group: "edit", kbd: "E", icon: Pencil, onSelect: ctx.onEdit },
    ctx.onEditPrice && { key: "edit-price", label: "Edit price", group: "edit", icon: Pencil, onSelect: ctx.onEditPrice },
    ctx.onAddEquipment && { key: "add-equipment", label: "Add equipment", group: "edit", icon: Plus, onSelect: ctx.onAddEquipment },
    ctx.onAddKit && { key: "add-kit", label: "Add kit", group: "edit", icon: Package, onSelect: ctx.onAddKit },
    ctx.onSaveAsTemplate && { key: "save-template", label: "Save as template", group: "organise", icon: BookmarkPlus, onSelect: ctx.onSaveAsTemplate },
    ctx.onMoveToCategory && { key: "move-category", label: "Move to category", group: "organise", kbd: "M", icon: ArrowRightLeft, onSelect: ctx.onMoveToCategory },
    revealEntry(row, ctx),
    ctx.onRemove && {
      key: "delete", label: "Delete", group: "danger", kbd: "D", danger: true, icon: Trash2, onSelect: ctx.onRemove,
      // The surface's DeleteGroupDialog already states the item count and price impact.
    },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
};
