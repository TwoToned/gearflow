import { Trash2 } from "lucide-react";

import { deleteEffectText, type CategoryCounts } from "@/lib/category-record-facts";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The gear Category record's menu (UX Phase 14, 14b-5, D77). `Delete…` is the one verb: it is ABSENT for a caller who may
 * not delete, red, and its confirm names what happens to what is inside (models and kits become Uncategorised,
 * subcategories move up). It has an exact Undo (the toast), so the confirm is a heads-up, not a last chance.
 */
export interface CategoryRecordCtx {
  name: string;
  counts: CategoryCounts;
  /** The deleted category's own parent, where its subcategories move up to (`null` = the top level). */
  parentName: string | null;
  onDelete?: () => void;
}

export function buildCategoryRecordActions(ctx: CategoryRecordCtx): ActionMenuSpec {
  const items: (ActionItem | false | undefined)[] = [
    ctx.onDelete && {
      key: "delete",
      label: "Delete…",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: ctx.onDelete,
      confirm: { title: `Delete ${ctx.name}?`, body: deleteEffectText(ctx.counts, ctx.parentName), confirmLabel: "Delete category" },
    },
  ];
  return { items: items.filter((i): i is ActionItem => !!i) };
}
