"use client";

import { PackageOpen, Undo2 } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { canConvertBackToInventory, canConvertToCustomUnit } from "@/lib/off-inventory";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import { useCustomUnitActions } from "./custom-unit-context";
import { toCustomUnitLine } from "./equipment-row-descriptors";
import type { LineItemData } from "./equipment-row-types";

/**
 * The two kebab entries for "Convert to custom item" (FEATUREDOCS/12), shared by the
 * desktop row menu and the mobile card menu so both offer the same thing under the
 * same rule (`src/lib/off-inventory.ts`). Renders nothing without a provider.
 * Must sit inside a `DropdownMenuContent`.
 */
export function CustomUnitMenuItems({ item, overbookedInfo }: { item: LineItemData; overbookedInfo?: OverbookedInfo | null }) {
  const actions = useCustomUnitActions();
  if (!actions) return null;
  const line = toCustomUnitLine(item);
  const pending = actions.pendingLineIds.has(item.id);
  return (
    <>
      {canConvertToCustomUnit(line, overbookedInfo) && (
        <DropdownMenuItem disabled={pending} onClick={() => actions.convert(item.id)}>
          <PackageOpen className="mr-2 h-3.5 w-3.5" />
          Convert 1 to custom item
        </DropdownMenuItem>
      )}
      {canConvertBackToInventory(line) && (
        <DropdownMenuItem disabled={pending} onClick={() => actions.convertBack(item.id)}>
          <Undo2 className="mr-2 h-3.5 w-3.5" />
          Convert 1 back to inventory
        </DropdownMenuItem>
      )}
    </>
  );
}
