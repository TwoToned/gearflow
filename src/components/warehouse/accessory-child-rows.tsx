"use client";

import { Cable } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";

import type { LineItem } from "./warehouse-types";
import { PrepStatusBadge } from "./prep-status-badge";

/**
 * Permanent accessories (childKind === "ACCESSORY") cascade with their parent
 * through deploy/return, but they hang off a normal top-level asset line rather
 * than a kit, so the kit-grouping path never surfaced them. These rows show the
 * operator what travels with the scanned parent.
 *
 * Read-only: accessories move atomically with the parent (no separate
 * scan/verify), so they're informational, not individually selectable.
 *
 * Mode filtering mirrors KitChildRows — deploy shows what's still going out,
 * return shows what's currently deployed.
 */
export function getAccessoryChildren(parent: LineItem, mode: "deploy" | "return"): LineItem[] {
  const children = (parent.childLineItems || []) as LineItem[];
  return children.filter((c) => {
    if (c.childKind !== "ACCESSORY") return false;
    return mode === "deploy"
      ? c.status !== "CHECKED_OUT" && c.status !== "CANCELLED"
      : c.status === "CHECKED_OUT";
  });
}

export function AccessoryChildRows({
  parent,
  mode,
}: {
  parent: LineItem;
  mode: "deploy" | "return";
}) {
  const accessories = getAccessoryChildren(parent, mode);
  if (accessories.length === 0) return null;

  return (
    <>
      {accessories.map((acc) => (
        <TableRow key={acc.id} className="bg-bg-inset/30">
          <TableCell />
          <TableCell className="pl-12 text-sm text-fg-3">
            <div className="flex items-center gap-1.5">
              <Cable className="h-3.5 w-3.5 text-fg-3" />
              <span>{acc.model?.name || acc.description || "Accessory"}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-fg-3">
                Accessory
              </Badge>
            </div>
          </TableCell>
          <TableCell className="font-mono text-sm text-fg-3">
            {acc.asset?.assetTag || acc.bulkAsset?.assetTag || "—"}
          </TableCell>
          <TableCell className="text-center text-sm text-fg-3">{acc.quantity}</TableCell>
          <TableCell>
            <PrepStatusBadge item={acc} />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
