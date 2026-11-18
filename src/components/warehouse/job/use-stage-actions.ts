"use client";

import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { OUT_LABEL } from "@/lib/vocabulary";
import { transitionNeedsCheck, lineHasModelChecks } from "@/lib/warehouse-check-policy";
import { relocateAccessories, takeAccessorySelection } from "@/components/warehouse/relocate-accessories";
import type { AccessoryStageOp } from "@/hooks/use-warehouse-writes";
import {
  collectAllVerifiableIds,
  isKitParent,
  isMoveableAtDeployStage,
  isMoveableAtDeprepStage,
  isMoveableAtReturnStage,
  isMoveableAtUndeprepStage,
  modelDisplayName,
  type LineItem,
} from "@/components/warehouse/warehouse-types";
import type { CheckQueueItem } from "./use-check-queue";
import type { CheckFlow, JobLineItem, KitConfirmState, ReturnConditionValue, StageMutations, WarehouseWrites } from "./job-types";

const ACCESSORY_STAGE_DONE: Record<AccessoryStageOp, string> = {
  DEPLOY: "Deployed", RETURN: "Returned", DEPREP: "De-prepped",
  UNDEPLOY: "Moved back to Prepped:", UNRETURN: `Moved back to ${OUT_LABEL}:`, UNDEPREP: "Re-packed",
};

type Unit = NonNullable<LineItem["units"]>[number];
export type ReturnCheck = { condition: ReturnConditionValue; notes: string };

/** `id:idx` bulk-unit keys → per-line counts; plain keys → whole-line ids. */
function splitKeys(keys: Iterable<string>) {
  const counts = new Map<string, number>();
  const ids: string[] = [];
  for (const k of keys) {
    if (k.includes(":")) { const id = k.split(":")[0]; counts.set(id, (counts.get(id) || 0) + 1); } else ids.push(k);
  }
  return { counts, ids };
}

const reasonableName = (li: LineItem, count: number, i: number) => `${modelDisplayName(li)}${count > 1 ? ` #${i + 1}` : ""}`;

function deprepEntry(li: LineItem, lineItemId: string, assetName: string): CheckQueueItem {
  return {
    context: "RETURN", modelId: li.modelId!, assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "", assetName,
    lineItemId, assetId: li.assetId || "", bulkAssetId: li.bulkAssetId || undefined, fromDeprep: true,
  };
}

const deprepNeedsCheck = (li: LineItem | undefined) =>
  li?.status === "RETURNED" && li.prepStatus === "PACKED" &&
  transitionNeedsCheck("RETURN", { hasCheckItems: lineHasModelChecks(li), fromDeprep: true }) && !!li.modelId;

/**
 * The reverse / Return / De-prep verbs for Out, Returned and De-prepped (accessory units by unit,
 * every other line by id). Selection keys come from the table (`keysForRowIds`); the move-back and
 * de-prep verbs clear the legacy selection sets the move dialog reads through `clear`.
 */
export function useStageActions(deps: {
  projectId: string;
  lineItems: JobLineItem[];
  placed: ReturnType<typeof relocateAccessories>;
  warehouseWrites: WarehouseWrites;
  mutations: StageMutations;
  checkFlow: CheckFlow;
  verifiedKitItems: Set<string>;
  setKitConfirm: (s: KitConfirmState) => void;
  clear: { out: () => void; in: () => void; deprep: () => void };
}) {
  const { projectId, lineItems, placed, warehouseWrites, mutations, checkFlow, verifiedKitItems, setKitConfirm, clear } = deps;
  const { startCheckQueue, startKitCheckFlow } = checkFlow;

  const stageAccessories = (unitIds: string[], to: AccessoryStageOp, returnCondition?: ReturnConditionValue) => {
    if (unitIds.length === 0) return;
    warehouseWrites
      .stageAccessoryUnits(projectId, unitIds, to, returnCondition)
      .then(() => toast.success(`${ACCESSORY_STAGE_DONE[to]} ${unitIds.length} accessor${unitIds.length === 1 ? "y" : "ies"}`))
      .catch((e) => showError(e));
  };
  /** Accessory keys go through the unit-level stage mutation; everything else is returned for the line/kit paths. */
  const takeAccessoryStage = (keys: Iterable<string>, to: AccessoryStageOp, isRelevant: (u: Unit) => boolean, returnCondition?: ReturnConditionValue): string[] => {
    const { rest, unitIds } = takeAccessorySelection(keys, placed, isRelevant);
    stageAccessories(unitIds, to, returnCondition);
    return rest;
  };

  const moveBackSelection = (
    ids: Set<string>, accessoryOp: "UNDEPLOY" | "UNRETURN", isRelevant: (u: Unit) => boolean,
    fireItems: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) => void,
    fireKits: (kitIds: string[]) => void,
  ) => {
    if (ids.size === 0) return;
    const rest = takeAccessoryStage(ids, accessoryOp, isRelevant);
    const qtyMap = new Map<string, number>();
    const kitIds = new Set<string>();
    for (const key of rest) {
      const lineItemId = key.includes(":") ? key.split(":")[0] : key;
      const li = lineItems.find((l) => l.id === lineItemId);
      if (li && li.kitId && !li.isKitChild) kitIds.add(li.kitId);
      else qtyMap.set(lineItemId, (qtyMap.get(lineItemId) || 0) + 1);
    }
    if (kitIds.size > 0) fireKits(Array.from(kitIds)); // ONE array mutation for all selected kits
    const items = Array.from(qtyMap.entries()).map(([lineItemId, quantity]) => ({
      lineItemId, assetId: lineItems.find((l) => l.id === lineItemId)?.assetId || undefined, quantity,
    }));
    if (items.length > 0) fireItems(items);
  };

  const handleUndeploy = (ids: Set<string>) => {
    moveBackSelection(ids, "UNDEPLOY", isMoveableAtReturnStage, (items) => mutations.undeployMutation.mutate(items), (kitIds) => mutations.undeployKitsMutation.mutate(kitIds));
    clear.in();
  };
  const handleUnreturn = (ids: Set<string>) => {
    moveBackSelection(ids, "UNRETURN", isMoveableAtDeprepStage, (items) => mutations.unreturnMutation.mutate(items), (kitIds) => mutations.unreturnKitsMutation.mutate(kitIds));
    clear.deprep();
  };
  /** De-prepped → Returned. Only units that really are de-prepped are re-packable (the server re-checks). */
  const handleUndeprep = (keys: string[]) => {
    const rest = takeAccessoryStage(keys, "UNDEPREP", isMoveableAtUndeprepStage);
    new Set(rest.map((k) => k.split(":")[0])).forEach((id) => mutations.undeprepMutation.mutate(id));
  };

  const queueBulkDeprep = (lineItemId: string, count: number, queue: CheckQueueItem[], direct: DirectDeprep[]) => {
    const li = lineItems.find((l) => l.id === lineItemId);
    if (!li || !deprepNeedsCheck(li)) { direct.push({ lineItemId, quantity: count }); return; }
    for (let i = 0; i < count; i++) queue.push(deprepEntry(li, lineItemId, reasonableName(li, count, i)));
  };
  const queueWholeDeprep = (id: string, queue: CheckQueueItem[], direct: DirectDeprep[]) => {
    const li = lineItems.find((l) => l.id === id);
    if (li && isKitParent(li)) {
      // Kit de-prep with checks respects KIT_LEVEL / PER_ITEM through startKitCheckFlow.
      if (li.status === "RETURNED" && startKitCheckFlow(li.kitId!, li, "RETURN", "GOOD", true)) return;
      direct.push({ lineItemId: id, isKit: true });
    } else if (li && deprepNeedsCheck(li)) queue.push(deprepEntry(li, id, modelDisplayName(li)));
    else direct.push({ lineItemId: id });
  };
  /** De-prep: return checks where the model has them, else straight back into inventory. */
  const handleDeprep = (ids: Set<string>) => {
    if (ids.size === 0) return;
    // "Move to Pick" (packed and waiting) and "De-prep" (returned) share this handler; the server's DEPREP does the right one per unit.
    const rest = takeAccessoryStage(ids, "DEPREP", (u) => isMoveableAtDeployStage(u) || isMoveableAtDeprepStage(u));
    const { counts, ids: wholeIds } = splitKeys(rest);
    const queue: CheckQueueItem[] = [];
    const direct: DirectDeprep[] = [];
    for (const [lineItemId, count] of counts) queueBulkDeprep(lineItemId, count, queue, direct);
    for (const id of wholeIds) queueWholeDeprep(id, queue, direct);
    // One batch call for every direct de-prep; ops keep their array order so shared-line sequencing holds server-side.
    if (direct.length > 0) mutations.deprepMutation.mutate(direct.map((d) => ({ lineItemId: d.lineItemId, quantity: d.quantity, isKit: d.isKit })));
    if (queue.length > 0) startCheckQueue(queue);
    clear.deprep();
    clear.out();
  };

  const kitNeedsConfirm = (kitId: string, kitLi: LineItem): boolean => {
    const ids = collectAllVerifiableIds((kitLi.childLineItems || []) as LineItem[], "return");
    const verifiedIds = ids.filter((id) => verifiedKitItems.has(id));
    if (ids.length === 0 || verifiedIds.length >= ids.length) return false;
    setKitConfirm({
      action: "return", kitName: kitLi.description || kitLi.kit?.name || "Kit", kitId, parentLineItemId: kitLi.id,
      verifiedCount: verifiedIds.length, totalCount: ids.length, verifiedIds,
    });
    return true;
  };
  const returnKits = (kitIds: string[], check: ReturnCheck) => {
    const ready: Array<{ kitId: string; returnCondition: ReturnConditionValue }> = [];
    for (const kitId of kitIds) {
      const kitLi = lineItems.find((l) => l.kitId === kitId && !l.isKitChild);
      if (kitLi && kitNeedsConfirm(kitId, kitLi)) continue;
      if (!(kitLi && startKitCheckFlow(kitId, kitLi, "RETURN", check.condition))) ready.push({ kitId, returnCondition: check.condition });
    }
    if (ready.length > 0) mutations.kitBatchInMutation.mutate(ready);
  };
  const returnQueueEntries = (items: ReturnItem[]) => {
    const queue: CheckQueueItem[] = [];
    const without: ReturnItem[] = [];
    for (const item of items) {
      const li = lineItems.find((l) => l.id === item.lineItemId);
      // Batch Return is a return-scan (truck-in) -> no check (de-prep only) unless the model has one.
      if (!(transitionNeedsCheck("RETURN", { hasCheckItems: lineHasModelChecks(li), fromDeprep: false }) && li?.modelId)) { without.push(item); continue; }
      const isBulk = !!li.bulkAssetId || (!li.assetId && li.quantity > 1);
      for (let i = 0; i < (isBulk ? item.quantity : 1); i++) {
        queue.push({
          context: "RETURN", modelId: li.modelId, assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "",
          assetName: modelDisplayName(li), lineItemId: item.lineItemId, assetId: li.assetId || "", bulkAssetId: li.bulkAssetId || undefined,
        });
      }
    }
    return { queue, without };
  };
  const returnItems = (items: ReturnItem[]) => {
    const { queue, without } = returnQueueEntries(items);
    if (queue.length > 0) {
      startCheckQueue(queue, without.map((i) => ({ lineItemId: i.lineItemId, assetId: i.assetId, returnCondition: i.returnCondition, quantity: i.quantity, notes: i.notes })));
      return;
    }
    mutations.checkInMutation.mutateAsync({ items }).then(() => toast.success("Returned items")).catch(() => {});
  };
  /** Return the ticked rows with the condition/notes the return check collected. */
  const handleReturnSelected = (keys: Iterable<string>, check: ReturnCheck) => {
    const inKeys = takeAccessoryStage(new Set(keys), "RETURN", isMoveableAtReturnStage, check.condition);
    const qtyMap = new Map<string, number>();
    const kitIds: string[] = [];
    for (const key of inKeys) {
      const lineItemId = key.includes(":") ? key.split(":")[0] : key;
      const li = lineItems.find((l) => l.id === lineItemId);
      if (li && li.kitId && !li.isKitChild) kitIds.push(li.kitId);
      else qtyMap.set(lineItemId, (qtyMap.get(lineItemId) || 0) + 1);
    }
    returnKits(kitIds, check);
    const items: ReturnItem[] = Array.from(qtyMap.entries()).map(([lineItemId, quantity]) => ({
      lineItemId, assetId: lineItems.find((l) => l.id === lineItemId)?.assetId || undefined,
      returnCondition: check.condition, quantity, notes: check.notes || undefined,
    }));
    if (items.length > 0) returnItems(items);
  };

  return { stageAccessories, takeAccessoryStage, handleUndeploy, handleUnreturn, handleUndeprep, handleDeprep, handleReturnSelected };
}

type DirectDeprep = { lineItemId: string; quantity?: number; isKit?: boolean };
type ReturnItem = { lineItemId: string; assetId?: string; returnCondition: ReturnConditionValue; quantity: number; notes?: string };
export type StageActions = ReturnType<typeof useStageActions>;
