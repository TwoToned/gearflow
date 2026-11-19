import { ArrowLeftRight, FolderTree, Pencil, Trash2, TrendingDown } from "lucide-react";

import type { BulkAction, BulkActionBuilder } from "@/lib/primitives/types";
import { canExcludeFromRoi } from "@/lib/roi";

export interface BulkEquipmentRow {
  type?: string | null;
  modelId?: string | null;
  isKitChild?: boolean | null;
  excludeFromRoi?: boolean | null;
  isCustomItem?: boolean | null;
  subHireId?: string | null;
}

export interface BulkEquipmentCtx {
  onEdit?: () => void;
  onMoveToGroup?: () => void;
  onMoveToCategory?: () => void;
  onExcludeFromRoi?: () => void;
  /** The surface's own BulkDeleteDialog owns the confirm (it names what stays). */
  onDelete?: () => void;
}

/** The Equipment tab's bulk verbs; each absent when the caller has no handler or no row qualifies. */
export const buildBulkEquipmentActions: BulkActionBuilder<BulkEquipmentRow, BulkEquipmentCtx> = (rows, ctx) => {
  const out: Array<BulkAction | false | undefined> = [
    ctx.onEdit && { key: "edit", group: "edit", icon: Pencil, label: () => "Edit", onSelect: ctx.onEdit },
    ctx.onMoveToGroup && { key: "move-group", group: "organise", icon: ArrowLeftRight, label: () => "Move to group", onSelect: ctx.onMoveToGroup },
    ctx.onMoveToCategory && { key: "move-category", group: "organise", icon: FolderTree, label: () => "Move to category", onSelect: ctx.onMoveToCategory },
    ctx.onExcludeFromRoi && rows.some((r) => canExcludeFromRoi(r) && !r.excludeFromRoi) && {
      key: "exclude-roi", group: "reporting", icon: TrendingDown, label: (n) => `Exclude ${n} from ROI`, onSelect: ctx.onExcludeFromRoi,
    },
    ctx.onDelete && { key: "delete", group: "danger", danger: true, icon: Trash2, label: () => "Delete", onSelect: ctx.onDelete },
  ];
  return out.filter((a): a is BulkAction => !!a);
};
