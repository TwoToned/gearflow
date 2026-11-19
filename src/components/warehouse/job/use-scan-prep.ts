"use client";

import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { containerArgs } from "@/lib/warehouse-container-choice";
import { transitionNeedsCheck, lineHasModelChecks } from "@/lib/warehouse-check-policy";
import { announcePrepWrite } from "@/lib/warehouse-prep-announce";
import { useServerMutation } from "@/hooks/use-server-mutation";
import type { ScanActOutcome } from "@/hooks/use-warehouse-scan";
import type { useScanFeedback } from "@/hooks/use-scan-feedback";
import { pullItem, prepItemDirect, prepItemsBatch, deprepItemsBatch } from "@/server/check-records";
import { rememberScanChoice, takeRememberedScanChoice } from "@/lib/warehouse-scan-memory";
import { bulkUnpackedRemaining, modelDisplayName, prepActionAvailability, scanAccessoryOptions, type LineItem } from "@/components/warehouse/warehouse-types";
import type { ScanAccessoryDecision, ScanAccessoryPromptData, ScanCheckMode } from "@/components/warehouse/scan-prep-dialogs";
import type { CheckQueueItem } from "./use-check-queue";
import type { CaseSelection } from "./use-case-selection";
import type { CheckFlow, WarehouseWrites } from "./job-types";

type Target = { lineItemId: string; assetId?: string | null; assetName?: string | null };
type Opts = { includeAccessoryIds?: string[]; accessoriesOnly?: boolean };
type AddPrompt = { assetName: string; modelId: string; assetId: string | null; bulkAssetId: string | null; isBulk: boolean };
type Feedback = ReturnType<typeof useScanFeedback>;

const identity = (li: LineItem | undefined) => ({
  modelId: li?.modelId ?? undefined,
  assetTag: li?.asset?.assetTag || li?.bulkAsset?.assetTag || "",
  bulkAssetId: li?.bulkAssetId || undefined,
});

/**
 * The To-pick scan writer: a scan resolves to one prep, held for a check form, queued for the "bulk after
 * scanning" batch, or routed through the accessories prompt. Also the "add to this job?" quick-add flow.
 */
export function useScanPrep(deps: {
  projectId: string; lineItems: LineItem[]; cases: CaseSelection; checkFlow: CheckFlow; warehouseWrites: WarehouseWrites;
  scanFeedback: Feedback; canUndoPrep: boolean; invalidate: () => void; clearAccessoryVerification: (ids: string[]) => void;
  scanInputRef: RefObject<HTMLInputElement | null>;
}) {
  const { projectId, lineItems, cases, checkFlow, warehouseWrites, scanFeedback, canUndoPrep, invalidate, clearAccessoryVerification, scanInputRef } = deps;
  const { selectedContainer, activeContainerId, ensureContainerIfNeeded } = cases;
  const { setCheckFormData, setCheckFormOpen, startCheckQueue } = checkFlow;
  const [scanCheckMode, setScanCheckMode] = useState<ScanCheckMode>("ask");
  const [scanAccessoryPrompt, setScanAccessoryPrompt] = useState<{ target: Target; data: ScanAccessoryPromptData } | null>(null);
  const [scanModePrompt, setScanModePrompt] = useState<{ target: Target; opts: Opts; name: string } | null>(null);
  const [scanBatch, setScanBatch] = useState<Array<CheckQueueItem & { needsCheck: boolean }>>([]);
  const [addPromptData, setAddPromptData] = useState<AddPrompt | null>(null);
  const [addPromptOpen, setAddPromptOpen] = useState(false);

  const scanFocus = () => scanInputRef.current?.focus();
  const nameOf = (target: Target, li: LineItem | undefined) => target.assetName || (li ? modelDisplayName(li) : "Asset");

  const queueItem = (target: Target, name: string, opts: Opts): CheckQueueItem => {
    const li = lineItems.find((l) => l.id === target.lineItemId);
    return {
      ...identity(li), context: "PREP", assetName: name, lineItemId: target.lineItemId, assetId: target.assetId || li?.assetId || "",
      ...(opts.includeAccessoryIds ? { includeAccessoryIds: opts.includeAccessoryIds } : {}),
    };
  };

  const prepAccessoriesOnly = async (target: Target, name: string, opts: Opts) => {
    await prepItemsBatch(projectId, [{
      lineItemId: target.lineItemId, assetId: target.assetId || undefined, prepContainer: selectedContainer || null,
      ...containerArgs(activeContainerId), includeAccessoryIds: opts.includeAccessoryIds, accessoriesOnly: true,
    }]);
    clearAccessoryVerification([target.lineItemId]);
    scanFeedback.play("success", { label: name, outcome: "Accessories prepped" });
    // No clean reverse for an accessories-only pack: toast only, no Undo.
    return announcePrepWrite({ doneTitle: `Accessories prepped: ${name}`, undoneTitle: "", reverse: [], canUndo: false, deprep: deprepItemsBatch.bind(null, projectId) });
  };

  const prepDirect = async (target: Target, name: string, opts: Opts) => {
    await prepItemDirect(projectId, target.lineItemId, target.assetId || undefined, undefined, selectedContainer || null, opts.includeAccessoryIds, containerArgs(activeContainerId).containerId);
    scanFeedback.play("success", { label: name, outcome: "Prepped" });
    const li = lineItems.find((l) => l.id === target.lineItemId);
    // A line with its own asset de-preps whole; a multi-quantity line gives back the one unit this scan packed.
    const reverse = [{ lineItemId: target.lineItemId, ...(li?.assetId ? {} : { quantity: 1 }) }];
    return announcePrepWrite({ doneTitle: `Prepped: ${name}`, undoneTitle: `Undone — ${name} back in To pick`, reverse, canUndo: canUndoPrep, deprep: deprepItemsBatch.bind(null, projectId) });
  };

  /** True when the scan was fully handled by a dialog/queue/batch; false when it should be prepped directly. */
  const deferPrep = (target: Target, name: string, opts: Opts, needsCheck: boolean, mode: ScanCheckMode) => {
    if (needsCheck && mode === "ask") { setScanModePrompt({ target, opts, name }); return true; }
    const q = queueItem(target, name, opts);
    if (mode === "batch") {
      setScanBatch((prev) => [...prev, { ...q, needsCheck }]);
      scanFeedback.play("info", { label: name, outcome: needsCheck ? "Queued for checks" : "Queued" });
      return true;
    }
    if (!needsCheck) return false;
    pullItem(projectId, target.lineItemId).catch(() => {}); // pull first, then the check form
    setCheckFormData(q);
    setCheckFormOpen(true);
    return true;
  };

  /** Preps (or defers to a check) and reports the one-line outcome the scan strip shows. */
  const proceedScanPrep = async (target: Target, opts: Opts, modeOverride?: ScanCheckMode): Promise<ScanActOutcome> => {
    const li = lineItems.find((l) => l.id === target.lineItemId);
    const name = nameOf(target, li);
    try {
      await ensureContainerIfNeeded();
      let outcome: ScanActOutcome;
      if (opts.accessoriesOnly) {
        const w = await prepAccessoriesOnly(target, name, opts);
        outcome = { text: `Accessories prepped: ${name}`, undo: w.scanUndo };
      } else {
        const needsCheck = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) }) && !!li?.modelId;
        const deferred = deferPrep(target, name, opts, needsCheck, modeOverride ?? scanCheckMode);
        const w = deferred ? undefined : await prepDirect(target, name, opts);
        outcome = deferred ? { text: `${name}: prep check to run`, tone: "warning" } : { text: `Prepped: ${name}`, undo: w?.scanUndo };
      }
      scanFocus();
      invalidate();
      return outcome;
    } catch (e) {
      scanFeedback.play("error", { label: name, outcome: e instanceof Error ? e.message : "Failed to prep" });
      showError(e);
      return { text: e instanceof Error && e.message ? e.message : "Failed to prep", tone: "error" };
    }
  };

  const routeScanPrep = async (target: Target): Promise<ScanActOutcome> => {
    const li = lineItems.find((l) => l.id === target.lineItemId);
    const name = nameOf(target, li);
    if (target.assetId && scanBatch.some((b) => b.lineItemId === target.lineItemId && b.assetId === target.assetId)) {
      scanFeedback.play("exception", { label: name, outcome: "Already scanned" });
      toast.info(`${name} is already in this scan batch`);
      scanFocus();
      return { text: `${name} is already in this scan batch`, tone: "warning" };
    }
    const options = li ? scanAccessoryOptions(li) : [];
    if (li && options.length > 0) {
      const parentPrepped = prepActionAvailability([li.id], [li]).canPrepAccessoriesOnly;
      // D10: "Remember for the next n" answers this line's following scans on this job without the sheet.
      const remembered = parentPrepped ? null : takeRememberedScanChoice(projectId, li.id);
      if (remembered) return proceedScanPrep(target, { includeAccessoryIds: remembered.kind === "without" ? [] : remembered.accessoryIds });
      setScanAccessoryPrompt({ target, data: { parentName: modelDisplayName(li), parentPrepped, options, rememberCount: Math.max(0, bulkUnpackedRemaining(li) - 1) } });
      return { text: `${name}: choose which accessories`, tone: "neutral" };
    }
    return proceedScanPrep(target, {});
  };

  const decideScanAccessories = (prompt: { target: Target; data: ScanAccessoryPromptData }, d: ScanAccessoryDecision, remember = false) => {
    setScanAccessoryPrompt(null);
    if (remember && (d.kind === "with" || d.kind === "without")) {
      rememberScanChoice(projectId, prompt.target.lineItemId, d.kind === "with" ? { kind: "with", accessoryIds: d.accessoryIds } : { kind: "without" }, prompt.data.rememberCount ?? 0);
    }
    if (d.kind === "without") void proceedScanPrep(prompt.target, { includeAccessoryIds: [] });
    else if (d.kind === "with") void proceedScanPrep(prompt.target, { includeAccessoryIds: d.accessoryIds });
    else void proceedScanPrep(prompt.target, { includeAccessoryIds: d.accessoryIds, accessoriesOnly: true });
  };

  /** "Bulk after scanning": run every held check, then prep the no-check scans. */
  const finishScanBatch = () => {
    if (scanBatch.length === 0) return;
    const queue = scanBatch.filter((b) => b.needsCheck).map(({ needsCheck: _n, ...q }) => q);
    const direct = scanBatch.filter((b) => !b.needsCheck);
    setScanBatch([]);
    if (queue.length > 0) {
      startCheckQueue(queue, direct.map((b) => ({ lineItemId: b.lineItemId, assetId: b.assetId || undefined, includeAccessoryIds: b.includeAccessoryIds })));
      return;
    }
    prepItemsBatch(projectId, direct.map((b) => ({
      lineItemId: b.lineItemId, assetId: b.assetId || undefined, prepContainer: selectedContainer || null, ...containerArgs(activeContainerId), includeAccessoryIds: b.includeAccessoryIds,
    })))
      .then(() => {
        clearAccessoryVerification(direct.map((b) => b.lineItemId));
        toast.success(`Prepped ${direct.length} item${direct.length === 1 ? "" : "s"}`);
        invalidate();
      })
      .catch((e) => showError(e, { fallbackTitle: "Prep failed" }));
  };

  // Quick-add: an asset scanned that is not on the job. Adds it, then preps it (through a check form when its model has one).
  const afterQuickAdd = (li: LineItem & { id: string }, assetName: string) => {
    const hasChecks = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) });
    if (hasChecks && li.modelId) {
      pullItem(projectId, li.id).catch(() => {});
      setCheckFormData({ context: "PREP", modelId: li.modelId, assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "", assetName, lineItemId: li.id, assetId: li.assetId || "", bulkAssetId: li.bulkAssetId || undefined });
      setCheckFormOpen(true);
    } else {
      prepItemDirect(projectId, li.id, li.assetId || undefined, undefined, selectedContainer || null, undefined, containerArgs(activeContainerId).containerId)
        .then(() => { toast.success(`Added and prepped: ${assetName}`); invalidate(); })
        .catch((e) => showError(e, { fallbackTitle: "Failed to prep" }));
    }
    scanFocus();
  };
  const quickAddMutation = useServerMutation({
    mutationFn: async (data: { modelId: string; assetId?: string; bulkAssetId?: string; quantity?: number }) => {
      await ensureContainerIfNeeded();
      // quickAddCore inserts a bare line with no unit row, so it stays on the label-only path; the next prep step gets the real containerId.
      return warehouseWrites.quickAddAndCheckOut(projectId, { ...data, prepContainer: selectedContainer || null });
    },
    onSuccess: (result) => {
      const assetName = addPromptData?.assetName || "Asset";
      setAddPromptOpen(false);
      setAddPromptData(null);
      invalidate();
      afterQuickAdd(result as unknown as LineItem & { id: string }, assetName);
    },
    onError: (e) => showError(e),
  });
  const offerAdd = (offer: AddPrompt) => { setAddPromptData(offer); setAddPromptOpen(true); };

  return {
    scanCheckMode, setScanCheckMode, scanAccessoryPrompt, setScanAccessoryPrompt, scanModePrompt, setScanModePrompt, scanBatch, setScanBatch,
    addPromptData, setAddPromptData, addPromptOpen, setAddPromptOpen, quickAddMutation, offerAdd,
    scanFocus, routeScanPrep, proceedScanPrep, decideScanAccessories, finishScanBatch,
  };
}
export type ScanPrep = ReturnType<typeof useScanPrep>;
