"use client";

import { useState } from "react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import type { WarehouseWrites } from "./job-types";

/** Add/remove one id from an in-flight set, so a double click cannot fire the write twice. */
const withId = (s: Set<string>, id: string) => new Set(s).add(id);
const withoutId = (s: Set<string>, id: string) => { const n = new Set(s); n.delete(id); return n; };

/**
 * The To-pick extras that are not table rows: the NEW_STOCK sale-item checklist toggle and "Prep as
 * custom item" (FEATUREDOCS/12) one-click convert / convert-back. Subscriptions are reactive, so no invalidate.
 */
export function usePickExtras(projectId: string, warehouseWrites: WarehouseWrites) {
  const [pendingSalePickIds, setPendingSalePickIds] = useState<Set<string>>(new Set());
  const [pendingCustomUnitLineIds, setPendingCustomUnitLineIds] = useState<Set<string>>(new Set());

  const handleToggleSalePicked = async (lineItemId: string, picked: boolean) => {
    setPendingSalePickIds((p) => withId(p, lineItemId));
    try {
      await warehouseWrites.setSalePicked(projectId, lineItemId, picked);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update pick status");
    } finally {
      setPendingSalePickIds((p) => withoutId(p, lineItemId));
    }
  };

  const runCustomUnitWrite = (lineItemId: string, write: () => Promise<unknown>, success: string, failure: string) => {
    setPendingCustomUnitLineIds((p) => withId(p, lineItemId));
    write()
      .then(() => toast.success(success))
      .catch((e) => showError(e, { fallbackTitle: failure }))
      .finally(() => setPendingCustomUnitLineIds((p) => withoutId(p, lineItemId)));
  };
  const handleConvertToCustomUnit = (lineItemId: string) =>
    runCustomUnitWrite(lineItemId, () => warehouseWrites.convertUnitToOffInventory(projectId, lineItemId, true), "Prepped 1 as a custom item", "Couldn't convert to a custom item");
  const handleConvertBackToInventory = (lineItemId: string) =>
    runCustomUnitWrite(lineItemId, () => warehouseWrites.convertUnitBackToInventory(projectId, lineItemId), "Converted back to inventory", "Couldn't convert back to inventory");

  return { pendingSalePickIds, pendingCustomUnitLineIds, handleToggleSalePicked, handleConvertToCustomUnit, handleConvertBackToInventory };
}
