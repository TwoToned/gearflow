"use client";

import { PackageOpen, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canConvertBackToInventory, canConvertToCustomUnit, type CustomUnitLine } from "@/lib/off-inventory";
import type { OverbookedInfo } from "@/lib/overbooking-core";

export type CustomUnitPanelLine = CustomUnitLine & { model?: { name?: string; assetType?: string | null } | null };

interface CustomUnitPanelProps {
  lines: CustomUnitPanelLine[];
  overbookedMap: Record<string, OverbookedInfo>;
  /** Line ids with a convert call in flight (disables that row's button). */
  pendingLineIds: ReadonlySet<string>;
  onConvert: (lineItemId: string) => void;
  onConvertBack: (lineItemId: string) => void;
}

/**
 * "Prep as custom item" (FEATUREDOCS/12). Short on a unit at the bench? One click
 * turns a leftover unit of an overbooked line into a custom unit — it stays on the
 * line (price and documents unchanged), holds no stock, and is marked prepped.
 * Renders nothing when no line qualifies.
 */
export function CustomUnitPanel({ lines, overbookedMap, pendingLineIds, onConvert, onConvertBack }: CustomUnitPanelProps) {
  const rows = lines
    .map((line) => ({
      line,
      canConvert: canConvertToCustomUnit(line, overbookedMap[line.id]),
      canBack: canConvertBackToInventory(line),
    }))
    .filter((r) => r.canConvert || r.canBack);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-3" data-testid="custom-unit-panel">
      <div className="mb-2 flex items-center gap-1.5 text-table-cell font-medium text-ink">
        <PackageOpen className="h-4 w-4 text-muted" />
        Short on stock?
      </div>
      <ul className="space-y-1.5">
        {rows.map(({ line, canConvert, canBack }) => (
          <PanelRow
            key={line.id}
            line={line}
            info={overbookedMap[line.id]}
            canConvert={canConvert}
            canBack={canBack}
            pending={pendingLineIds.has(line.id)}
            onConvert={onConvert}
            onConvertBack={onConvertBack}
          />
        ))}
      </ul>
    </div>
  );
}

function PanelRow({
  line,
  info,
  canConvert,
  canBack,
  pending,
  onConvert,
  onConvertBack,
}: {
  line: CustomUnitPanelLine;
  info: OverbookedInfo | undefined;
  canConvert: boolean;
  canBack: boolean;
  pending: boolean;
  onConvert: (lineItemId: string) => void;
  onConvertBack: (lineItemId: string) => void;
}) {
  const short = info ? Math.max(info.overBy, info.pencilledOverBy ?? 0) : 0;
  const custom = line.offInventoryQuantity ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-2 text-table-cell">
      <span className="text-ink">{line.model?.name ?? "Item"}</span>
      {canConvert && short > 0 && <Badge status="warn">{short} over capacity</Badge>}
      {custom > 0 && <Badge status="neutral">{custom} custom</Badge>}
      <span className="ml-auto flex gap-1.5">
        {canBack && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onConvertBack(line.id)}>
            <Undo2 className="mr-1 h-3.5 w-3.5" />
            Convert back
          </Button>
        )}
        {canConvert && (
          <Button variant="line" size="sm" disabled={pending} onClick={() => onConvert(line.id)}>
            Prep as custom item
          </Button>
        )}
      </span>
    </li>
  );
}
