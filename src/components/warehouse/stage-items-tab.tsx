"use client";

import { useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import {
  type LineItem,
  modelDisplayName,
  isKitParent,
} from "@/components/warehouse/warehouse-types";
import { stageQuantity, type WarehouseStage } from "@/lib/warehouse-stage";

/**
 * Read-first list view for a warehouse lifecycle stage (Returned, Depreped).
 *
 * Deliberately simple — a table, not the scan/kit-verification machinery of the
 * Pick/Prep, Prepped and Deployed tabs. The Returned stage gets a forward
 * "Deprep" (put-away) bulk action; Depreped is read-only. Quantities are
 * unit/stage-aware via `stageQuantity` so a partially-returned bulk line shows
 * the count actually sitting in this stage. See docs/designs/warehouse-linear-flow.md.
 */
export function StageItemsTab({
  value,
  stage,
  items,
  emptyLabel,
  action,
}: {
  /** Tab value (must match the TabsTrigger). */
  value: string;
  /** Which lifecycle stage this tab renders — drives the per-line quantity. */
  stage: WarehouseStage;
  /** Items already filtered to this stage by the parent (belongsInStage). */
  items: LineItem[];
  emptyLabel: string;
  /** Optional bulk action (Returned → Deprep). Omitted = read-only (Depreped). */
  action?: {
    label: string;
    onRun: (ids: Set<string>) => void;
    isPending: boolean;
  };
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const assetTag = (item: LineItem) =>
    item.asset?.assetTag ||
    item.bulkAsset?.assetTag ||
    item.units?.find((u) => u.asset?.assetTag)?.asset?.assetTag ||
    "—";

  return (
    <TabsContent value={value}>
      {items.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-fg-3 text-sm">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-4">
          {action && selected.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg bg-bg-surface surface-ring px-4 py-3">
              <span className="text-sm text-fg-3">
                {selected.size} selected
              </span>
              <Button
                size="sm"
                onClick={() => {
                  action.onRun(selected);
                  setSelected(new Set());
                }}
                disabled={action.isPending}
              >
                {action.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="mr-2 h-4 w-4" />
                )}
                {action.label}
              </Button>
            </div>
          )}

          <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {action && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                  )}
                  <TableHead>Item</TableHead>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const qty = stageQuantity(item, stage);
                  return (
                    <TableRow key={item.id}>
                      {action && (
                        <TableCell>
                          <Checkbox
                            checked={selected.has(item.id)}
                            onCheckedChange={() => toggle(item.id)}
                            aria-label={`Select ${modelDisplayName(item)}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium text-sm">
                        <span className="flex items-center gap-2">
                          {modelDisplayName(item)}
                          {isKitParent(item) && (
                            <Badge variant="outline" className="text-xs">
                              Kit
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-fg-3">
                        {assetTag(item)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {qty}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </TabsContent>
  );
}
