"use client";

import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { containerArgs, type ContainerChoice } from "@/lib/warehouse-container-choice";
import { transitionNeedsCheck, lineHasModelChecks } from "@/lib/warehouse-check-policy";
import { isInternalStockLine } from "@/lib/warehouse-subhire-filter";
import { getAvailableAssetsForModels } from "@/server/warehouse";
import { prepItemsBatch, prepKitsBatch } from "@/server/check-records";
import {
  accessoryAssetIds,
  accessoryChildrenOf,
  collectAllVerifiableIds,
  isAccessoryParent,
  modelDisplayName,
  packedParentAssetIds,
  resolveItemContainerId,
  type AvailableAsset,
  type LineItem,
} from "@/components/warehouse/warehouse-types";
import type { CheckQueueItem } from "./use-check-queue";
import type { AssetPicker } from "./use-asset-picker";
import type { CaseSelection } from "./use-case-selection";
import type { JobGates } from "./use-job-gates";
import type { CheckFlow, KitConfirmState, PickerRow } from "./job-types";

type Sel = { lineItemId: string; assetId?: string; quantity?: number };
type Bulk = { lineItemId: string; quantity: number };
type DirectPrep = Sel & { prepContainer?: string | null; containerId?: string | null; includeAccessoryIds?: string[] };

/** Selection keys -> serialised/plain lines, kit parents and bulk-unit counts (`id:idx` keys). */
function classifyPrepKeys(keys: Iterable<string>, lineItems: LineItem[]) {
  const items: Sel[] = [];
  const kitLineItemIds: string[] = [];
  const bulkItems: Bulk[] = [];
  for (const key of keys) {
    if (key.includes(":")) {
      const lineItemId = key.split(":")[0];
      const existing = bulkItems.find((i) => i.lineItemId === lineItemId);
      if (existing) existing.quantity += 1; else bulkItems.push({ lineItemId, quantity: 1 });
      continue;
    }
    const li = lineItems.find((l) => l.id === key);
    if (li && li.kitId && !li.isKitChild) kitLineItemIds.push(key);
    else items.push({ lineItemId: key, assetId: li?.assetId || undefined });
  }
  return { items, kitLineItemIds, bulkItems };
}

/**
 * A line with no asset yet needs the picker. Discriminate on `!== "BULK"`, not `=== "SERIALIZED"`: the
 * model mirror stores assetType as optional, so an omitted one must still route a serialised line to the
 * picker, not the whole-line prep path ("prep one, all four move").
 */
const needsAssignment = (li: LineItem | undefined, requireNoAsset: boolean): boolean =>
  !!li && (!requireNoAsset || !li.assetId) && !li.bulkAssetId && li.model?.assetType !== "BULK" && !!li.modelId && isInternalStockLine(li.subHireId);

/** Multi-quantity serialised "bulk" keys are really picker work: move them to `items`. */
function routeMultiQtySerialised(items: Sel[], bulkItems: Bulk[], lineItems: LineItem[]) {
  const actualBulk: Bulk[] = [];
  const all = [...items];
  for (const bi of bulkItems) {
    const li = lineItems.find((l) => l.id === bi.lineItemId);
    if (li && !li.bulkAssetId && needsAssignment(li, false)) all.push({ lineItemId: bi.lineItemId, quantity: bi.quantity });
    else actualBulk.push(bi);
  }
  return { items: all, bulkItems: actualBulk };
}

async function buildPickerRows(needs: Sel[], lineItems: LineItem[]): Promise<PickerRow[]> {
  // ONE availability call for every model in the selection, then rows from the map.
  const modelIds = [...new Set(needs.map((i) => lineItems.find((l) => l.id === i.lineItemId)?.modelId).filter((id): id is string => !!id))];
  const availability = await getAvailableAssetsForModels(modelIds);
  const rows: PickerRow[] = [];
  for (const item of needs) {
    const li = lineItems.find((l) => l.id === item.lineItemId);
    if (!li?.modelId) continue;
    const available = (availability[li.modelId] ?? []) as AvailableAsset[];
    for (let i = 0; i < (item.quantity || li.quantity); i++) {
      rows.push({
        lineItemId: li.id, modelId: li.modelId, modelName: li.model?.name || modelDisplayName(li),
        availableAssets: available, selectedAssetId: "", checkItemCount: li.model?._count?.modelCheckItems || 0,
      });
    }
  }
  return rows;
}

/** Bulk lines: one check entry per unit when the model has checks, the rest prep directly in one batch. */
function splitBulkPrep(bulkItems: Bulk[], lineItems: LineItem[]) {
  const queue: CheckQueueItem[] = [];
  const noCheck: Bulk[] = [];
  for (const bi of bulkItems) {
    const li = lineItems.find((l) => l.id === bi.lineItemId);
    if (!(transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) }) && li?.modelId)) { noCheck.push(bi); continue; }
    for (let i = 0; i < bi.quantity; i++) {
      queue.push({
        context: "PREP", modelId: li.modelId, assetTag: li.bulkAsset?.assetTag || "", assetName: `${modelDisplayName(li)} — Unit ${i + 1}`,
        lineItemId: li.id, assetId: "", bulkAssetId: li.bulkAssetId || undefined,
      });
    }
  }
  return { queue, noCheck };
}

function splitReadyPrep(ready: Sel[], lineItems: LineItem[], narrow: { includeAccessoryIds?: string[] }) {
  const queue: CheckQueueItem[] = [];
  const noCheck: Sel[] = [];
  for (const item of ready) {
    const li = lineItems.find((l) => l.id === item.lineItemId);
    if (!(transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) }) && li?.modelId)) { noCheck.push(item); continue; }
    queue.push({
      context: "PREP", modelId: li.modelId, assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "", assetName: li.model?.name || modelDisplayName(li),
      lineItemId: item.lineItemId, assetId: li.assetId || "", bulkAssetId: li.bulkAssetId || undefined, ...narrow,
    });
  }
  return { queue, noCheck };
}

/** Pick/prep writers: the manual Prep verbs and the accessories-only pack (which reports what the server packed). */
export function usePrepActions(deps: {
  projectId: string; lineItems: LineItem[]; cases: CaseSelection; gates: JobGates; checkFlow: CheckFlow;
  picker: AssetPicker; invalidate: () => void;
}) {
  const { projectId, lineItems, cases, gates, checkFlow, picker, invalidate } = deps;
  const { selectedContainer, activeContainerId, ensureContainerIfNeeded } = cases;
  const { verifiedKitItems, kitConfirmBacklogRef, closeKitConfirm, clearAccessoryVerification } = gates;
  const { startCheckQueue, startKitCheckFlow } = checkFlow;
  const container = { prepContainer: selectedContainer || null, ...containerArgs(activeContainerId) };

  /** Kits: unverified ones wait for the confirm; verified ones check or prep directly (one batch). */
  const prepKits = (kitLineItemIds: string[]): KitConfirmState[] => {
    const direct: Array<{ id: string; name: string }> = [];
    const unverified: KitConfirmState[] = [];
    for (const id of kitLineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (!li?.kitId) continue;
      const allIds = collectAllVerifiableIds((li.childLineItems || []) as LineItem[], "deploy");
      const verifiedIds = allIds.filter((v) => verifiedKitItems.has(v));
      if (allIds.length > 0 && verifiedIds.length < allIds.length) {
        unverified.push({ action: "deploy", kitName: li.kit?.name || li.description || "Kit", kitId: li.kitId, parentLineItemId: li.id, verifiedCount: verifiedIds.length, totalCount: allIds.length, verifiedIds });
      } else if (!startKitCheckFlow(li.kitId, li, "PREP")) direct.push({ id: li.id, name: li.description || li.kit?.name || "Kit" });
    }
    if (direct.length > 0) {
      prepKitsBatch(projectId, direct.map((k) => k.id))
        .then((res) => {
          if (res.succeeded.length > 0) toast.success(res.succeeded.length === 1 ? `Kit prepped: ${direct[0].name}` : `Prepped ${res.succeeded.length} kits`);
          if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} skipped`);
          invalidate();
        })
        .catch((e) => showError(e, { fallbackTitle: "Failed to prep kit" }));
    }
    return unverified;
  };

  /**
   * Prep the ticked To-pick rows. `withoutAccessories` packs the parents only (`includeAccessoryIds: []`);
   * their accessories stay in To pick (an accessory parent stays while any child is unpacked).
   */
  const handlePrepSelected = async (opts: { withoutAccessories?: boolean; keys: Iterable<string> }) => {
    const narrow = opts.withoutAccessories ? { includeAccessoryIds: [] as string[] } : {};
    try {
      await ensureContainerIfNeeded();
      const classified = classifyPrepKeys(opts.keys, lineItems);
      const { items, bulkItems } = routeMultiQtySerialised(classified.items, classified.bulkItems, lineItems);
      const needsPicker = items.filter((i) => needsAssignment(lineItems.find((l) => l.id === i.lineItemId), true));
      const ready = items.filter((i) => !needsPicker.includes(i));
      if (needsPicker.length > 0) {
        const rows = await buildPickerRows(needsPicker, lineItems);
        if (rows.length > 0) { picker.show(rows, bulkItems); return; }
      }
      const unverified = prepKits(classified.kitLineItemIds);
      const bulk = splitBulkPrep(bulkItems, lineItems);
      const readySplit = splitReadyPrep(ready, lineItems, narrow);
      // ONE batch for every no-check prep. A bulk line carries its full selected quantity (the unit accumulates).
      const direct: DirectPrep[] = [
        ...bulk.noCheck.map((bi) => ({ lineItemId: bi.lineItemId, quantity: bi.quantity, ...container })),
        ...readySplit.noCheck.map((i) => ({ lineItemId: i.lineItemId, assetId: i.assetId, quantity: i.quantity, ...container, ...narrow })),
      ];
      if (direct.length > 0) {
        await prepItemsBatch(projectId, direct);
        clearAccessoryVerification(direct.map((i) => i.lineItemId));
      }
      const checks = [...readySplit.queue, ...bulk.queue];
      if (unverified.length > 0) {
        kitConfirmBacklogRef.current.push(...unverified);
        if (checks.length === 0) closeKitConfirm(); // no check form pending: open now, else finishCheckQueue opens it
      }
      if (checks.length > 0) startCheckQueue(checks);
      else if (classified.kitLineItemIds.length === 0 && direct.length > 0) toast.success(`Prepped ${readySplit.noCheck.length + bulk.noCheck.length} items`);
      invalidate();
    } catch (e) {
      showError(e, { fallbackTitle: "Prep failed" });
      invalidate();
    }
  };

  /**
   * Pack ONLY the accessories of already-prepped parents (the parent is not re-prepped; the container
   * applies to the accessories alone). `where`: "active" = the active case; "parent" = each parent's own.
   * `onlyAccessoryIds` packs EXACTLY those accessory child lines (the deploy gate's `Pack now` rows).
   * Resolves the accessory line ids the SERVER reports as packed afterwards (a short pack is visible to
   * the caller), or null when the write failed.
   */
  const handlePrepAccessoriesOnly = async (keys: Iterable<string>, where: "active" | "parent" = "active", onlyAccessoryIds?: ReadonlySet<string>): Promise<ReadonlySet<string> | null> => {
    try {
      await ensureContainerIfNeeded();
      const items: Array<{ lineItemId: string; assetId: string; prepContainer: string | null; containerId?: ContainerChoice; includeAccessoryIds?: string[]; accessoriesOnly: true }> = [];
      const seen = new Set<string>();
      for (const key of keys) {
        const li = lineItems.find((l) => l.id === key.split(":")[0]);
        if (!li || !isAccessoryParent(li) || seen.has(li.id)) continue;
        seen.add(li.id);
        const narrowed = onlyAccessoryIds ? accessoryAssetIds(accessoryChildrenOf(li).filter((c) => onlyAccessoryIds.has(c.id))) : undefined;
        if (narrowed && narrowed.length === 0) continue;
        // One entry per packed parent asset: a multi-quantity line has no line-level asset, so it packs per unit.
        for (const assetId of packedParentAssetIds(li)) {
          const choice: ContainerChoice = where === "parent" ? resolveItemContainerId(li) : activeContainerId;
          items.push({ lineItemId: li.id, assetId, prepContainer: where === "parent" ? null : selectedContainer || null, ...containerArgs(choice), ...(narrowed ? { includeAccessoryIds: narrowed } : {}), accessoriesOnly: true });
        }
      }
      if (items.length === 0) { toast.error("Select prepped items that have accessories"); return null; }
      const res = await prepItemsBatch(projectId, items);
      clearAccessoryVerification(items.map((i) => i.lineItemId));
      toast.success("Accessories prepped");
      invalidate();
      return new Set(res?.packedAccessoryLineIds ?? []);
    } catch (e) {
      showError(e, { fallbackTitle: "Accessory prep failed" });
      invalidate();
      return null;
    }
  };

  return { handlePrepSelected, handlePrepAccessoriesOnly };
}
export type PrepActions = ReturnType<typeof usePrepActions>;
