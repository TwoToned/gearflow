"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { SaleItemToPrep } from "@/lib/warehouse-detail-reconstruct";

export interface SaleItemsToPrepProps {
  items: SaleItemToPrep[];
  onTogglePicked: (id: string, picked: boolean) => void;
  pendingIds: Set<string>;
}

/**
 * NEW_STOCK sale items awaiting a shelf pick, rendered as its own section next to
 * (not merged with) PickPrepTab's asset-tag/scan table — a sale line has no asset
 * to scan, so it's picked by SKU instead. FROM_RENTAL_STOCK sale lines never
 * appear here (2026-08 warehouse sales-prep split; see FEATUREDOCS/67).
 */
export function SaleItemsToPrep({ items, onTogglePicked, pendingIds }: SaleItemsToPrepProps) {
  if (items.length === 0) return null;
  const toPickCount = items.filter((i) => !i.picked).length;

  return (
    <div className="rounded-[var(--r-lg)] border border-line overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-4 py-3">
        <div>
          <p className="font-medium text-ink">Sale items to prepare</p>
          <p className="text-caption text-muted">Picked by SKU, not asset tag — grab this stock off the shelf.</p>
        </div>
        <Badge status={toPickCount === 0 ? "ok" : "warn"}>
          {toPickCount === 0 ? "All picked" : `${toPickCount} to pick`}
        </Badge>
      </div>
      <div className="divide-y divide-line">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-elev"
          >
            <Checkbox
              checked={item.picked}
              disabled={pendingIds.has(item.id)}
              onCheckedChange={(checked) => onTogglePicked(item.id, checked === true)}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-ink truncate">
                {item.modelName ?? item.description ?? "—"}
              </p>
              <p className="text-caption text-muted t-mono">{item.sku ?? "No SKU set"}</p>
            </div>
            <span className="text-table-cell tabular-nums text-muted shrink-0">
              &times;{item.quantity}
            </span>
            {item.picked ? (
              <Badge status="ok" className="shrink-0">Picked</Badge>
            ) : (
              <Badge status="warn" className="shrink-0">To pick</Badge>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
