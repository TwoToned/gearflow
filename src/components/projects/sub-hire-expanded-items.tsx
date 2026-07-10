"use client";

/**
 * Expanded view of a sub-hire order's items in the Sub-Hire Orders
 * panel at the bottom of the equipment tab. Renders each item's
 * description, qty, supplier cost, client charge, and computed margin.
 * Extracted from equipment-tab.tsx in Phase 7.
 *
 * Owns its own getSubHire query keyed by subHireId; the parent only
 * needs to render this component when a row is expanded.
 */

import { Fragment } from "react";
import { useSubHire } from "@/hooks/use-project-equipment";

import { formatCurrency } from "@/lib/formatters";

interface SubHireExpandedItemsProps {
  subHireId: string;
  /** Active organization id — included in the query key so cache
   *  entries don't leak across orgs. */
  orgId?: string;
}

export function SubHireExpandedItems({ subHireId, orgId }: SubHireExpandedItemsProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subHire } = useSubHire(orgId ? subHireId : undefined) as { data: any };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (subHire?.items || []) as Array<Record<string, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = (subHire?.groups || []) as Array<Record<string, any>>;
  const ungroupedItems = items.filter((item) => !item.groupId);

  if (items.length === 0 && groups.length === 0) {
    return (
      <div className="pb-3 ml-4 border-l-2 border-primary/20 pl-8 text-xs text-fg-4 py-2">
        No items in this order yet.
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderItemRow(item: Record<string, any>, indent: string) {
    const itemMargin = Number(item.unitCharge) - Number(item.unitCost);
    return (
      <tr key={item.id as string} className="text-sm">
        <td className={`${indent} py-1.5 text-fg-2`}>
          {item.description as string}
          {(item.model as Record<string, string>)?.name && (
            <span className="ml-1.5 text-xs text-fg-4">({(item.model as Record<string, string>).name})</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-fg-3 w-12">&times;{item.quantity as number}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-fg-3 w-24">{formatCurrency(Number(item.unitCost))} cost</td>
        <td className="px-3 py-1.5 text-right tabular-nums w-24">{formatCurrency(Number(item.unitCharge))}</td>
        <td className={`px-3 py-1.5 text-right tabular-nums w-20 ${itemMargin > 0 ? "text-success" : itemMargin < 0 ? "text-error" : "text-fg-4"}`}>
          {formatCurrency(itemMargin)}
        </td>
      </tr>
    );
  }

  return (
    <div className="pb-2 ml-4 overflow-x-auto border-l-2 border-primary/20">
      <table className="w-full">
        <tbody>
          {groups.map((group) => {
            const groupItems = (group.items || []) as Array<Record<string, unknown>>;
            return (
              <Fragment key={group.id}>
                <tr className="text-xs">
                  <td colSpan={5} className="pl-8 py-1.5 font-medium text-fg-3">
                    <span className="text-primary/70">▸</span> {group.title}
                    <span className="ml-1.5 text-fg-4 font-normal">({groupItems.length} item{groupItems.length !== 1 ? "s" : ""})</span>
                  </td>
                </tr>
                {groupItems.map((item) => renderItemRow(item, "pl-12"))}
              </Fragment>
            );
          })}
          {ungroupedItems.map((item) => renderItemRow(item, "pl-8"))}
        </tbody>
      </table>
    </div>
  );
}
