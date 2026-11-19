"use client";

import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { transitionNeedsCheck, lineHasModelChecks, kitHasChecks } from "@/lib/warehouse-check-policy";
import { containerArgs, type ContainerChoice } from "@/lib/warehouse-container-choice";
import { modelDisplayName, type LineItem } from "@/components/warehouse/warehouse-types";
import { pullItem, prepItemsBatch, deprepKit, prepKitChildren, unpackItem } from "@/server/check-records";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

/** One entry of the prep/return check queue (extracted verbatim from the page). */
export type CheckQueueItem = {
  context: "PREP" | "RETURN";
  modelId?: string;
  kitId?: string;
  assetTag: string;
  assetName: string;
  lineItemId: string;
  assetId: string;
  bulkAssetId?: string;
  /** Accessory identities to pack with this unit (prep picker selection). */
  includeAccessoryIds?: string[];
  /** When set, this queue item is part of a kit PER_ITEM flow */
  kitQueueKitId?: string;
  kitQueueReturnCondition?: ReturnCondition;
  /** A RETURN check triggered by a de-prep: route focus back and store via completeCheckAndDeprep. */
  fromDeprep?: boolean;
};

export type CheckFormData = CheckQueueItem;

export interface CheckQueueDeps {
  projectId: string;
  lineItems: LineItem[];
  selectedContainer: string;
  activeContainerId: ContainerChoice;
  kitCheckInMutation: { mutateAsync: (v: { kitId: string; returnCondition: ReturnCondition }) => Promise<unknown> };
  checkInMutation: { mutateAsync: (v: { items: Array<{ lineItemId: string; assetId?: string; returnCondition: ReturnCondition; quantity?: number; notes?: string }> }) => Promise<unknown> };
  clearAccessoryVerification: (lineItemIds: string[]) => void;
  invalidate: () => void;
  /** Opens the next held-back unverified-kit prompt, if any. */
  closeKitConfirm: () => void;
  hasKitConfirmBacklog: () => boolean;
  setReturnNotes: (s: string) => void;
  scanInputRef: RefObject<HTMLInputElement | null>;
  deployScanInputRef: RefObject<HTMLInputElement | null>;
  returnScanInputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The prep/return check queue and its form state — moved out of the warehouse
 * page unchanged (behaviour-identical extraction, Phase 3 step 2).
 */
export function useCheckQueue(deps: CheckQueueDeps) {
  const {
    projectId, lineItems, selectedContainer, activeContainerId, kitCheckInMutation, checkInMutation,
    clearAccessoryVerification, invalidate, closeKitConfirm, hasKitConfirmBacklog, setReturnNotes,
    scanInputRef, deployScanInputRef, returnScanInputRef,
  } = deps;
  // Check form state — opens when a scanned item's model has check items
  const [checkFormOpen, setCheckFormOpen] = useState(false);
  const [checkFormData, setCheckFormData] = useState<CheckFormData | null>(null);
  const [checkFormSubmitting, setCheckFormSubmitting] = useState(false);

  // Queue for multi-item check flows
  const [checkQueue, setCheckQueue] = useState<CheckQueueItem[]>([]);
  const [checkQueueIndex, setCheckQueueIndex] = useState(0);
  // Items that don't need checks — processed after queue completes
  const [checkQueueDirectItems, setCheckQueueDirectItems] = useState<
    Array<{ lineItemId: string; assetId?: string; quantity?: number; returnCondition?: string; notes?: string; includeAccessoryIds?: string[] }>
  >([]);

  // Start processing a check queue — opens the form for the first item
  function startCheckQueue(queue: CheckQueueItem[], directItems: Array<{ lineItemId: string; assetId?: string; quantity?: number; returnCondition?: string; notes?: string; includeAccessoryIds?: string[] }> = []) {
    if (queue.length === 0) return false;
    setCheckQueue(queue);
    setCheckQueueIndex(0);
    setCheckQueueDirectItems(directItems);
    const first = queue[0];
    setCheckFormData(first);
    setCheckFormOpen(true);
    // Call pullItem/unpackItem for non-kit items (kit items are deployed atomically at the end).
    // Skip for fromDeprep queues — the item is already returned; we just need to run the check
    // and then reset prepStatus in completeCheckAndDeprep.
    if (!first.kitId && !first.kitQueueKitId && !first.fromDeprep) {
      if (first.context === "PREP") {
        pullItem(projectId, first.lineItemId).catch(() => {});
      } else {
        unpackItem(projectId, first.lineItemId).catch(() => {});
      }
    }
    return true;
  }

  // Advance to the next item in the queue (called after a successful submit)
  function advanceCheckQueue() {
    const nextIndex = checkQueueIndex + 1;
    if (nextIndex < checkQueue.length) {
      setCheckQueueIndex(nextIndex);
      const next = checkQueue[nextIndex];
      setCheckFormData(next);
      // Pull/unpack non-kit items (kit items are deployed atomically at the end).
      // Skip for fromDeprep — item is already returned.
      if (!next.kitId && !next.kitQueueKitId && !next.fromDeprep) {
        if (next.context === "PREP") {
          pullItem(projectId, next.lineItemId).catch(() => {});
        } else {
          unpackItem(projectId, next.lineItemId).catch(() => {});
        }
      }
      // Keep form open — it will reset via the modelId/assetTag change
    } else {
      // Queue complete — process any direct (no-check) items
      finishCheckQueue();
    }
  }

  // Process remaining direct items after queue completes
  function finishCheckQueue() {
    const kitQueueKitId = checkQueue[0]?.kitQueueKitId;
    const kitQueueContext = checkQueue[0]?.context;
    const kitQueueReturnCondition = checkQueue[0]?.kitQueueReturnCondition;
    const finishedContext = checkQueue[0]?.context;
    const finishedFromDeprep = checkQueue[0]?.fromDeprep === true;

    setCheckFormOpen(false);
    setCheckFormData(null);
    setCheckQueue([]);
    setCheckQueueIndex(0);
    // Unverified-kit prompts held back while this queue ran can open now.
    if (hasKitConfirmBacklog()) closeKitConfirm();

    // Return focus to the appropriate scan input so barcode scanners flow uninterrupted.
    // Wait a frame for the Sheet to release its focus trap before we steal it back.
    requestAnimationFrame(() => {
      if (finishedFromDeprep) {
        deployScanInputRef.current?.focus();
      } else if (finishedContext === "PREP") {
        scanInputRef.current?.focus();
      } else if (finishedContext === "RETURN") {
        returnScanInputRef.current?.focus();
      }
    });

    if (kitQueueKitId) {
      if (kitQueueContext === "PREP") {
        // Kit prep: mark all kit children as PACKED after checks completed
        const kitLi = lineItems.find((l) => l.kitId === kitQueueKitId && !l.isKitChild);
        if (kitLi) {
          prepKitChildren(projectId, kitLi.id)
            .then(() => {
              toast.success("Kit prepped — ready to deploy");
              invalidate();
            })
            .catch((e) => showError(e, { fallbackTitle: "Failed to prep kit" }));
        } else {
          toast.success("Kit prepped — ready to deploy");
          invalidate();
        }
      } else if (finishedFromDeprep) {
        // Kit deprep: checks are already saved, now deprep the kit back to inventory
        const kitLi = lineItems.find((l) => l.kitId === kitQueueKitId && !l.isKitChild);
        if (kitLi) {
          deprepKit(projectId, kitLi.id)
            .then(() => {
              toast.success("Kit deprep checked — returned to inventory");
              invalidate();
            })
            .catch((e) => showError(e, { fallbackTitle: "Failed to deprep kit" }));
        }
      } else {
        kitCheckInMutation
          .mutateAsync({ kitId: kitQueueKitId, returnCondition: kitQueueReturnCondition || "GOOD" })
          .then(() => { toast.success("Kit returned after checks"); setReturnNotes(""); })
          .catch(() => {});
      }
    } else if (checkQueueDirectItems.length > 0) {
      // Reuse the snapshot we captured above — avoid re-reading checkQueue[0]
      // after setCheckQueue([]) was called.
      if (finishedContext === "PREP") {
        // Prep remaining items that had no checks (set prepStatus=PACKED) in one
        // batch call — the server applies them in array order, preserving the old
        // "sequential to avoid same-lineItemId races" ordering constraint.
        prepItemsBatch(
          projectId,
          checkQueueDirectItems.map((i) => ({
            lineItemId: i.lineItemId,
            assetId: i.assetId || undefined,
            quantity: i.quantity,
            prepContainer: selectedContainer || null,
            ...containerArgs(activeContainerId),
            includeAccessoryIds: i.includeAccessoryIds,
          })),
        )
          .then(() => {
            clearAccessoryVerification(checkQueueDirectItems.map((i) => i.lineItemId));
            toast.success("Items prepped — ready to deploy");
            invalidate();
          })
          .catch((e) => showError(e));
      } else {
        checkInMutation
          .mutateAsync({ items: checkQueueDirectItems.map((i) => ({ lineItemId: i.lineItemId, assetId: i.assetId, returnCondition: (i.returnCondition || "GOOD") as "GOOD" | "DAMAGED" | "MISSING", quantity: i.quantity, notes: i.notes })) })
          .then(() => { toast.success(`Returned remaining items`); setReturnNotes(""); })
          .catch(() => {});
      }
    }

    setCheckQueueDirectItems([]);
    invalidate();
  }

  /**
   * Check if a kit needs check forms before deploy/return.
   * Returns true if a check flow was started (caller should NOT proceed with direct deploy/return).
   * Returns false if no checks needed (caller should proceed with normal flow).
   */
  function startKitCheckFlow(
    kitId: string,
    kitLi: LineItem,
    context: "PREP" | "RETURN",
    kitReturnCondition?: "GOOD" | "DAMAGED" | "MISSING",
    fromDeprep: boolean = false
  ): boolean {
    const kit = kitLi.kit;
    if (!kit) return false;

    // Central policy gate: a plain return-scan (truck-in) never fires a check — the
    // return check runs only at de-prep (fromDeprep). PREP and de-prep proceed.
    if (!transitionNeedsCheck(context, { hasCheckItems: true, fromDeprep })) return false;

    const checkMode = kit.checkMode || "KIT_LEVEL";
    const children = (kitLi.childLineItems || []) as LineItem[];

    if (checkMode === "KIT_LEVEL") {
      // Kit-level: check the kit once using its own check items
      if (!kitHasChecks(kit)) return false;

      const queue: CheckQueueItem[] = [{
        context,
        kitId: kit.id,
        assetTag: kit.assetTag,
        assetName: kit.name,
        lineItemId: kitLi.id,
        assetId: "",
        kitQueueKitId: kit.id,
        kitQueueReturnCondition: kitReturnCondition,
        fromDeprep,
      }];
      return startCheckQueue(queue);
    } else {
      // PER_ITEM: queue each child with model check items
      const queue: CheckQueueItem[] = [];
      for (const child of children) {
        // Skip children not relevant to current flow.
        // Deprep runs on already-returned kits so the children are not CHECKED_OUT anymore —
        // use the RETURN-with-fromDeprep branch to include them regardless.
        if (context === "PREP" && (child.status === "CHECKED_OUT" || child.status === "CANCELLED")) continue;
        if (context === "RETURN" && !fromDeprep && child.status !== "CHECKED_OUT") continue;
        if (context === "RETURN" && fromDeprep && child.status === "CANCELLED") continue;

        if (!lineHasModelChecks(child) || !child.modelId) continue;

        // For serialized items, one queue entry per child
        // For bulk items, expand per quantity
        const isBulk = !!child.bulkAssetId || (!child.assetId && child.quantity > 1);
        const count = isBulk ? child.quantity : 1;
        for (let i = 0; i < count; i++) {
          queue.push({
            context,
            modelId: child.modelId,
            assetTag: child.asset?.assetTag || child.bulkAsset?.assetTag || "",
            assetName: `${modelDisplayName(child)}${count > 1 ? ` #${i + 1}` : ""}`,
            lineItemId: child.id,
            assetId: child.assetId || "",
            bulkAssetId: child.bulkAssetId || undefined,
            kitQueueKitId: kit.id,
            kitQueueReturnCondition: kitReturnCondition,
            fromDeprep,
          });
        }
      }

      if (queue.length === 0) return false;
      return startCheckQueue(queue);
    }
  }

  return {
    checkFormOpen, setCheckFormOpen, checkFormData, setCheckFormData, checkFormSubmitting, setCheckFormSubmitting,
    checkQueue, setCheckQueue, checkQueueIndex, setCheckQueueIndex,
    startCheckQueue, advanceCheckQueue, finishCheckQueue, startKitCheckFlow,
  };
}

export type CheckQueueFlow = ReturnType<typeof useCheckQueue>;
