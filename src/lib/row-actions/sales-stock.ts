import { Download, ExternalLink, PackagePlus } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Sales stock verbs (UX Phase 14, 14a-1). `Adjust stock` is the ONE write; the row ⋯ and the bulk bar
 * open the same dialog. Absent handler = absent item.
 */
export interface SaleStockActionCtx {
  onOpenModel: () => void;
  onAdjust?: () => void;
}

type Entry = ActionItem | false | undefined | null;

export function buildSaleStockActions(ctx: SaleStockActionCtx): ActionMenuSpec {
  const entries: Entry[] = [
    ctx.onAdjust && { key: "adjust", label: "Adjust stock…", group: "edit", icon: PackagePlus, onSelect: ctx.onAdjust },
    { key: "open", label: "Open model", group: "edit", icon: ExternalLink, onSelect: ctx.onOpenModel },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}

export interface SaleStockBulkCtx {
  onAdjust?: () => void;
  onExport: () => void;
}

export function buildSaleStockBulkActions(ctx: SaleStockBulkCtx): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    ctx.onAdjust && { key: "adjust", label: (n) => `Adjust stock ${n}`, group: "edit", icon: PackagePlus, onSelect: ctx.onAdjust },
    { key: "export", label: (n) => `Export ${n}`, group: "reporting", icon: Download, onSelect: ctx.onExport },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}
