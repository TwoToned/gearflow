"use client";

import { Badge } from "@/components/ui/badge";
import {
  type LineItem,
  modelDisplayName,
  isKitParent,
} from "@/components/warehouse/warehouse-types";
import {
  describeStageSplit,
  stageQuantity,
  type WarehouseStage,
} from "@/lib/warehouse-stage";

export interface BoardColumn {
  stage: WarehouseStage;
  label: string;
  /** Tab value to open when a card/column is clicked (deep work happens in tabs). */
  tabValue: string;
  items: LineItem[];
}

/**
 * Kanban overview of the warehouse lifecycle — all stages as columns at once,
 * gear flowing left to right. Deliberately a REDUCED view (compact read-only
 * cards + counts), not a clone of the tab machinery: clicking a card opens that
 * stage's tab for the actual scan/deploy/return/deprep work. Desktop only; the
 * parent falls back to tabs on mobile. See docs/designs/warehouse-linear-flow.md.
 */
export function WarehouseBoard({
  columns,
  onOpenStage,
}: {
  columns: BoardColumn[];
  onOpenStage: (tabValue: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-3 pt-4">
      {columns.map((col) => (
        <div
          key={col.stage}
          className="flex flex-col rounded-lg bg-bg-surface surface-ring overflow-hidden"
        >
          <button
            type="button"
            onClick={() => onOpenStage(col.tabValue)}
            className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border text-left hover:bg-accent/50 transition-colors"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-2">
              {col.label}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {col.items.length}
            </Badge>
          </button>

          <div className="flex-1 space-y-2 p-2 max-h-[60vh] overflow-y-auto">
            {col.items.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-fg-4">Empty</p>
            ) : (
              col.items.map((item) => {
                const qty = stageQuantity(item, col.stage);
                const split = describeStageSplit(item);
                const tag =
                  item.asset?.assetTag ||
                  item.bulkAsset?.assetTag ||
                  item.units?.find((u) => u.asset?.assetTag)?.asset?.assetTag ||
                  null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenStage(col.tabValue)}
                    className="w-full rounded-md bg-bg-inset/40 hover:bg-bg-inset px-2.5 py-2 text-left transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-tight">
                        {modelDisplayName(item)}
                      </span>
                      <span className="text-xs tabular-nums text-fg-3 shrink-0">
                        ×{qty}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {isKitParent(item) && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          Kit
                        </Badge>
                      )}
                      {tag && (
                        <span className="font-mono text-[11px] text-fg-4 truncate">
                          {tag}
                        </span>
                      )}
                    </div>
                    {split && (
                      <p className="mt-1 text-[11px] text-fg-4">{split}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
