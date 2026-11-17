"use client";

import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import type { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { showError } from "@/lib/show-error";
import { OUT_LABEL } from "@/lib/vocabulary";
import { deprepItemsBatch } from "@/server/check-records";
import type { LineItem } from "@/components/warehouse/warehouse-types";

/**
 * The stage-move mutations of the warehouse job page (deploy / return / kit
 * batches / de-prep / move back), moved out unchanged (Phase 3 step 3). The
 * scan pipeline and the row actions both call these, so there is one set.
 */
export function useStageMutations({
  projectId, lineItems, warehouseWrites, invalidate,
}: {
  projectId: string;
  lineItems: LineItem[];
  warehouseWrites: ReturnType<typeof useWarehouseWrites>;
  invalidate: () => void;
}) {
  const checkOutMutation = useServerMutation({
    mutationFn: async (params: { items: Array<{ lineItemId: string; assetId?: string; quantity?: number; includeAccessoryIds?: string[] }>; includeAccessories?: boolean }) => {
      const result = await warehouseWrites.checkOutItems(projectId, params.items, params.includeAccessories);
      // Sync container status for affected containers — ONE batch call (was one
      // round-trip per container).
      const containers = new Set(
        params.items.map((i) => lineItems.find((l) => l.id === i.lineItemId)?.prepContainer).filter(Boolean) as string[]
      );
      if (containers.size > 0) await warehouseWrites.syncContainersBatch(projectId, [...containers]);
      return result;
    },
    onSuccess: invalidate,
    onError: (e) => showError(e),
  });

  const checkInMutation = useServerMutation({
    mutationFn: async (data: {
      items: Array<{ lineItemId: string; assetId?: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING"; quantity?: number; notes?: string }>;
    }) => {
      const result = await warehouseWrites.checkInItems(projectId, data.items);
      // Sync container status for affected containers — ONE batch call (was one
      // round-trip per container).
      const containers = new Set(
        data.items.map((i) => lineItems.find((l) => l.id === i.lineItemId)?.prepContainer).filter(Boolean) as string[]
      );
      if (containers.size > 0) await warehouseWrites.syncContainersBatch(projectId, [...containers]);
      return result;
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (e) => showError(e),
  });

  const kitCheckInMutation = useServerMutation({
    mutationFn: (data: { kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }) =>
      warehouseWrites.checkInKit(projectId, data.kitId, data.returnCondition),
    onSuccess: () => invalidate(),
    onError: (e) => showError(e),
  });

  // Bulk kit deploy/return — one round-trip for all selected kits (was one
  // checkOutKit/checkInKit per kit). Per-kit errors come back from the server.
  type KitBatchResult = { succeeded: string[]; errors: { kitId: string; message: string }[] };
  const kitBatchOutMutation = useServerMutation<KitBatchResult, string[]>({
    mutationFn: (kitIds: string[]) => warehouseWrites.checkOutKitsBatch(projectId, kitIds),
    onSuccess: (res) => {
      // The success toast (with Undo) now fires from inside useWarehouseWrites
      // (#1222) — a second one here would duplicate it.
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} failed: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });
  const kitBatchInMutation = useServerMutation<KitBatchResult, Array<{ kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }>>({
    mutationFn: (kits) => warehouseWrites.checkInKitsBatch(projectId, kits),
    onSuccess: (res) => {
      // The success toast (with Undo) now fires from inside useWarehouseWrites
      // (#1222) — a second one here would duplicate it.
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} failed: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });

  // Batched deprep — reverse prep for every selected item + kit in one call.
  // (Drives the deprep buttons' pending state via `.isPending`.)
  const deprepMutation = useServerMutation({
    mutationFn: (ops: Array<{ lineItemId: string; quantity?: number; isKit?: boolean }>) =>
      deprepItemsBatch(projectId, ops),
    onSuccess: (_res, ops) => {
      toast.success(`Removed ${ops.length} from prep`);
      invalidate();
    },
    onError: (e) => showError(e),
  });

  // ── Move-back (reverse a stage) mutations ──────────────────────────────────
  const undeployMutation = useServerMutation({
    mutationFn: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) =>
      warehouseWrites.undeployItems(projectId, items),
    onSuccess: () => { toast.success("Moved back to Prepped"); invalidate(); },
    onError: (e) => showError(e),
  });
  const undeployKitsMutation = useServerMutation<KitBatchResult, string[]>({
    mutationFn: (kitIds: string[]) => warehouseWrites.undeployKitsBatch(projectId, kitIds),
    onSuccess: (res) => {
      if (res.succeeded.length > 0) toast.success(`Moved ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"} back to Prepped`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} skipped: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });
  const unreturnMutation = useServerMutation({
    mutationFn: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) =>
      warehouseWrites.unreturnItems(projectId, items),
    onSuccess: () => { toast.success(`Moved back to ${OUT_LABEL}`); invalidate(); },
    onError: (e) => showError(e),
  });
  const unreturnKitsMutation = useServerMutation<KitBatchResult, string[]>({
    mutationFn: (kitIds: string[]) => warehouseWrites.unreturnKitsBatch(projectId, kitIds),
    onSuccess: (res) => {
      if (res.succeeded.length > 0) toast.success(`Moved ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"} back to Deployed`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} skipped: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });
  const undeprepMutation = useServerMutation({
    mutationFn: (lineItemId: string) => warehouseWrites.undeprepLine(projectId, lineItemId),
    onSuccess: () => { toast.success("Re-packed — back to Returned"); invalidate(); },
    onError: (e) => showError(e),
  });

  const clearContainerMutation = useServerMutation({
    mutationFn: (containerName: string) => warehouseWrites.clearPrepContainer(projectId, containerName),
    onSuccess: () => {
      toast.success("Container removed");
      invalidate();
    },
    onError: (e) => showError(e),
  });

  return {
    checkOutMutation, checkInMutation, kitCheckInMutation,
    kitBatchOutMutation, kitBatchInMutation, deprepMutation,
    undeployMutation, undeployKitsMutation, unreturnMutation, unreturnKitsMutation,
    undeprepMutation, clearContainerMutation,
  };
}
