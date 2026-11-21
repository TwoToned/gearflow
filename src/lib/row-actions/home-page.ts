import { Boxes, LayoutGrid, ScanBarcode } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * Home's page ⋯ (UX Phase 11, §6c.2): Warehouse, Add gear and Customise…, the
 * buttons the old header carried. An omitted handler means the viewer can't do
 * it (no `warehouse` read, no `asset:create`, or a phone, where Customise is
 * hidden by D89), so the item is ABSENT, never disabled.
 */
export interface HomePageActionCtx {
  onWarehouse?: () => void;
  onAddGear?: () => void;
  onCustomise?: () => void;
}

type Entry = ActionItem | false | undefined;

export function buildHomePageActions(ctx: HomePageActionCtx): ActionMenuSpec {
  const entries: Entry[] = [
    ctx.onWarehouse && { key: "warehouse", label: "Warehouse", group: "edit", icon: ScanBarcode, onSelect: ctx.onWarehouse },
    ctx.onAddGear && { key: "add-gear", label: "Add gear", group: "edit", icon: Boxes, onSelect: ctx.onAddGear },
    ctx.onCustomise && { key: "customise", label: "Customise…", group: "organise", icon: LayoutGrid, onSelect: ctx.onCustomise },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}
