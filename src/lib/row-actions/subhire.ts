import { ArrowRightLeft, Pencil } from "lucide-react";

import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";

/** A sub-hire group row (the order's lines as one row on the job). */
export interface SubHireActionRow {
  title: string;
}

export interface SubHireActionCtx {
  onEditPrice?: () => void;
  /** Opens the sub-hire order dialog. */
  onEditInOrder?: () => void;
  onMoveToCategory?: () => void;
}

type Entry = ActionItem | false | undefined | null;

export const buildSubHireActions: RowActionBuilder<SubHireActionRow, SubHireActionCtx> = (_row, ctx): ActionMenuSpec => {
  const entries: Entry[] = [
    ctx.onEditInOrder && { key: "edit-order", label: "Edit in sub-hire order", group: "edit", kbd: "E", icon: Pencil, onSelect: ctx.onEditInOrder },
    ctx.onEditPrice && { key: "edit-price", label: "Edit price", group: "edit", icon: Pencil, onSelect: ctx.onEditPrice },
    ctx.onMoveToCategory && { key: "move-category", label: "Move to category", group: "organise", kbd: "M", icon: ArrowRightLeft, onSelect: ctx.onMoveToCategory },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
};
