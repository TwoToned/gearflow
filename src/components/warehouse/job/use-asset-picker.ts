"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { containerArgs } from "@/lib/warehouse-container-choice";
import { resolvePickerScan } from "@/lib/asset-picker-scan";
import { transitionNeedsCheck, lineHasModelChecks } from "@/lib/warehouse-check-policy";
import { prepItemsBatch } from "@/server/check-records";
import { modelDisplayName, type LineItem } from "@/components/warehouse/warehouse-types";
import type { useScanFeedback } from "@/hooks/use-scan-feedback";
import type { CheckQueueItem } from "./use-check-queue";
import type { CaseSelection } from "./use-case-selection";
import type { CheckFlow, PickerRow } from "./job-types";

type BulkItem = { lineItemId: string; quantity: number };
type Feedback = ReturnType<typeof useScanFeedback>;

function bulkQueueEntry(li: LineItem): CheckQueueItem {
  return {
    context: "PREP", modelId: li.modelId!, assetTag: li.bulkAsset?.assetTag || "", assetName: modelDisplayName(li),
    lineItemId: li.id, assetId: "", bulkAssetId: li.bulkAssetId || undefined,
  };
}

/** Split the picker's bulk lines into per-unit check entries and the no-check remainder. */
function splitBulk(bulkItems: BulkItem[], lineItems: LineItem[]) {
  const queue: CheckQueueItem[] = [];
  const noChecks: BulkItem[] = [];
  for (const bi of bulkItems) {
    const li = lineItems.find((l) => l.id === bi.lineItemId);
    if (li && transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) }) && li.modelId) {
      for (let i = 0; i < bi.quantity; i++) queue.push(bulkQueueEntry(li));
    } else noChecks.push(bi);
  }
  return { queue, noChecks };
}

function pickedWithChecks(rows: PickerRow[], lineItems: LineItem[]): CheckQueueItem[] {
  return rows.filter((i) => i.checkItemCount > 0 && i.modelId).map((i) => {
    const li = lineItems.find((l) => l.id === i.lineItemId);
    const selected = i.availableAssets.find((a) => a.id === i.selectedAssetId);
    return {
      context: "PREP" as const, modelId: li!.modelId!, assetTag: selected?.assetTag || li?.asset?.assetTag || "",
      assetName: modelDisplayName(li!), lineItemId: i.lineItemId, assetId: i.selectedAssetId || "", bulkAssetId: li?.bulkAssetId || undefined,
    };
  });
}

/**
 * "Assign assets" for serialised lines that have no asset yet. The rows live in a ref as well as state:
 * continuous scanning delivers hits from a decode callback holding the last COMMITTED render, so two
 * units scanned before a commit would otherwise both pick the same empty slot and the second would
 * overwrite the first. Writing the ref before setState makes each scan see the previous one.
 */
export function useAssetPicker(deps: {
  projectId: string; lineItems: LineItem[]; cases: CaseSelection; checkFlow: CheckFlow;
  clearAccessoryVerification: (ids: string[]) => void; invalidate: () => void; scanFeedback: Feedback;
}) {
  const { projectId, lineItems, cases, checkFlow, clearAccessoryVerification, invalidate, scanFeedback } = deps;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PickerRow[]>([]);
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [scanValue, setScanValue] = useState("");
  const itemsRef = useRef<PickerRow[]>([]);
  const applyItems = (next: PickerRow[] | ((prev: PickerRow[]) => PickerRow[])) => {
    const resolved = typeof next === "function" ? next(itemsRef.current) : next;
    itemsRef.current = resolved;
    setItems(resolved);
  };
  /** Open the dialog for these rows (and the bulk lines that ride with the same prep). */
  const show = (rows: PickerRow[], bulk: BulkItem[]) => { applyItems(rows); setBulkItems(bulk); setOpen(true); };

  const handleScan = (rawTag: string) => {
    const result = resolvePickerScan(itemsRef.current, rawTag);
    setScanValue("");
    if (result.kind === "assigned") {
      applyItems((prev) => prev.map((item, i) => (i === result.index ? { ...item, selectedAssetId: result.assetId } : item)));
      scanFeedback.play("success", { label: `${result.modelName} · ${result.assetTag}`, outcome: `Assigned #${result.index + 1}` });
    } else if (result.kind === "already-assigned") {
      scanFeedback.play("exception", { label: result.assetTag, outcome: `Already assigned to #${result.index + 1}` });
      toast.info(`${result.assetTag} is already assigned to ${result.modelName} #${result.index + 1}`);
    } else if (result.kind === "no-slot") {
      scanFeedback.play("exception", { label: result.assetTag, outcome: "No slot left" });
      toast.warning(`Every ${result.modelName} slot is already filled`);
    } else {
      scanFeedback.play("error", { label: result.assetTag || "Unknown tag", outcome: "Not available here" });
      toast.error(`${result.assetTag || "That tag"} isn't an available asset for this prep`);
    }
  };

  const confirm = () => {
    if (items.some((i) => !i.selectedAssetId)) { toast.error("Please select an asset for each item"); return; }
    const ids = items.map((i) => i.selectedAssetId);
    if (new Set(ids).size !== ids.length) { toast.error("Each item must have a different asset assigned"); return; }
    setOpen(false);
    const { queue: bulkQueue, noChecks } = splitBulk(bulkItems, lineItems);
    // Accessories pack in full (like a kit's members); checkout gating decides what is missing.
    const withoutChecks = [
      ...items.filter((i) => !i.checkItemCount || !i.modelId).map((i) => ({ lineItemId: i.lineItemId, assetId: i.selectedAssetId, quantity: undefined as number | undefined })),
      ...noChecks.map((bi) => ({ lineItemId: bi.lineItemId, assetId: undefined as string | undefined, quantity: bi.quantity as number | undefined })),
    ];
    const withChecks = [...pickedWithChecks(items, lineItems), ...bulkQueue];
    if (withChecks.length > 0) { checkFlow.startCheckQueue(withChecks, withoutChecks); return; }
    // One batch: the server applies entries in order, so lines appearing several times stay sequenced.
    prepItemsBatch(projectId, withoutChecks.map((i) => ({
      lineItemId: i.lineItemId, assetId: i.assetId, quantity: i.quantity, prepContainer: cases.selectedContainer || null, ...containerArgs(cases.activeContainerId),
    })))
      .then(() => { clearAccessoryVerification(withoutChecks.map((i) => i.lineItemId)); toast.success("Items prepped — ready to deploy"); invalidate(); })
      .catch((e) => showError(e));
  };

  return { open, setOpen, items, scanValue, setScanValue, applyItems, show, handleScan, confirm };
}
export type AssetPicker = ReturnType<typeof useAssetPicker>;
