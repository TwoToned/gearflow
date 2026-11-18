"use client";

import { useMemo } from "react";
import { isInternalStockLine } from "@/lib/warehouse-subhire-filter";
import { relocateAccessories } from "@/components/warehouse/relocate-accessories";
import {
  buildContainerGroups,
  groupItems,
  isInCheckedOutStage,
  isInDeprepedStage,
  isInPickPrepStage,
  isInPreppedStage,
  isInReturnedStage,
  type LineItem,
} from "@/components/warehouse/warehouse-types";

/** The equipment rows the stages draw from: no kit children or container lines (they show under their parent). */
const isStageEquipment = (item: LineItem): boolean => {
  if (item.type !== "EQUIPMENT" || item.isContainerLineItem) return false;
  if (item.isKitChild && isInternalStockLine(item.subHireId)) return false; // real kit children stay hidden
  // Sub-hire group wrappers are hidden: their children show individually.
  return !(item.subHireId != null && !item.isKitChild && !item.kitId && (item.childLineItems?.length ?? 0) > 0);
};

/**
 * Stage membership for the job (see isInPickPrepStage / isInPreppedStage / isInReturnedStage /
 * isInDeprepedStage / isInCheckedOutStage in warehouse-types.ts for the shared, tested rules), plus the
 * Prepped rows grouped by case for "Deploy this case".
 */
export function useJobItems(placed: ReturnType<typeof relocateAccessories>, containerLabelById: Map<string, string>) {
  const equipmentItems = placed.items.filter(isStageEquipment);
  const pickPrepItems = equipmentItems.filter(isInPickPrepStage);
  const preppedItems = equipmentItems.filter(isInPreppedStage);
  // Returned gear is excluded from Prepped: it lives in Returned, not back at the deploy step.
  const returnedItems = equipmentItems.filter(isInReturnedStage);
  const deprepedItems = equipmentItems.filter(isInDeprepedStage);
  const checkedOutItems = equipmentItems.filter(isInCheckedOutStage);
  const groupedOut = groupItems(preppedItems, "deploy", "prepped");
  const deployContainerGroups = useMemo(
    () => buildContainerGroups(groupedOut, (e) => (e.kind === "serialized-group" ? e.items[0] : e.item), containerLabelById),
    [groupedOut, containerLabelById],
  );
  return { equipmentItems, pickPrepItems, preppedItems, returnedItems, deprepedItems, checkedOutItems, deployContainerGroups };
}
