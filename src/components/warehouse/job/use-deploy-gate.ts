"use client";

import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { prefillOverrideReason } from "@/lib/warehouse-accessory-rules";
import {
  accessoryAssetIds,
  accessoryChildrenOf,
  isAccessoryParent,
  isMoveableAtDeployStage,
  keysForGroupEntries,
  modelDisplayName,
  type GroupEntry,
  type LineItem,
} from "@/components/warehouse/warehouse-types";
import type { GateDecision } from "./deploy-gate-dialog";
import type { StageActions } from "./use-stage-actions";
import type { JobGates } from "./use-job-gates";
import type { useDurableScanIntake } from "@/hooks/use-durable-scan-intake";
import type { CheckOutItem, MissingAccessory, StageMutations, WarehouseWrites } from "./job-types";

type Durable = ReturnType<typeof useDurableScanIntake>;
/** Pack the named accessory child lines of these parents; resolves what the server says is now packed, or null on failure. */
export type PackAccessories = (parentKeys: string[], where: "active" | "parent", onlyAccessoryIds?: ReadonlySet<string>) => Promise<ReadonlySet<string> | null>;

/** The accessory classification the gate shows (null when already deployed/cancelled/packed). */
function missingAccessoryRow(li: LineItem, c: LineItem, isManagerTier: boolean): (MissingAccessory & { isOptional: boolean }) | null {
  if (c.status === "CANCELLED" || c.status === "CHECKED_OUT" || c.prepStatus === "PACKED") return null;
  const isOptional = c.accessoryInclusion === "OPTIONAL";
  return {
    parentLineItemId: li.id, parentName: modelDisplayName(li), accessoryLineItemId: c.id,
    accessoryName: c.model?.name || c.description || "Accessory", isOptional, tier: isOptional ? "OPTIONAL" : "DEFAULT",
    // D9: the office's own note on the plan, else the manager's stock wording; editable in the dialog.
    officeNote: isOptional ? "" : prefillOverrideReason(li, c.bulkAssetId) || (isManagerTier ? "Manager override — deployed without full verification" : ""),
  };
}

/**
 * The ONE accessory gate for every deploy entry point (selection Deploy and scan-deploy). DEFAULT /
 * OPTIONAL accessories left unpacked open the DeployGateDialog; a partly click-verified set opens the
 * "Deploy Verified Only" confirm. Every row needs an explicit decision, and a reason is only ever
 * logged if the operator typed it or kept the D9 prefill they saw (never invented).
 */
export function useDeployGate(deps: {
  projectId: string;
  lineItems: LineItem[];
  gates: JobGates;
  mutations: StageMutations;
  warehouseWrites: WarehouseWrites;
  stageActions: Pick<StageActions, "takeAccessoryStage">;
  isManagerTier: boolean;
  packAccessories: PackAccessories;
  durableRef: MutableRefObject<Durable | null>;
  setSelectedOut: (s: Set<string>) => void;
}) {
  const { projectId, lineItems, gates, mutations, warehouseWrites, stageActions, isManagerTier, packAccessories, durableRef, setSelectedOut } = deps;
  const { verifiedKitItems, accessoryGate, setAccessoryGate, setAccessoryVerifyConfirm } = gates;

  function computeMissingAccessories(parentLineItemIds: string[]) {
    const missingDefaults: MissingAccessory[] = [];
    const missingOptionals: MissingAccessory[] = [];
    for (const id of parentLineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (!li) continue;
      for (const c of accessoryChildrenOf(li)) {
        const row = missingAccessoryRow(li, c, isManagerTier);
        if (!row) continue;
        const { isOptional, ...rest } = row;
        (isOptional ? missingOptionals : missingDefaults).push(rest);
      }
    }
    return { missingDefaults, missingOptionals };
  }

  function runCheckOut(items: CheckOutItem[]) {
    // Accessories always cascade with their parent (permanently attached), except for the per-item
    // `includeAccessoryIds` narrowing an item may carry (Deploy Verified Only / the gate's Leave rows).
    mutations.checkOutMutation
      .mutateAsync({ items, includeAccessories: true })
      .then(() => toast.success(`Deployed ${items.length} item${items.length === 1 ? "" : "s"}`))
      .catch(() => {});
  }

  /** The first accessory parent whose PACKED accessories are only partly click-verified (translated line id -> asset identity). */
  function findPartiallyVerifiedAccessoryParent(parentLineItemIds: string[]) {
    for (const id of parentLineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (!li || !isAccessoryParent(li)) continue;
      const packed = accessoryChildrenOf(li).filter((c) => c.status !== "CANCELLED" && c.status !== "CHECKED_OUT" && c.prepStatus === "PACKED");
      const verified = packed.filter((c) => verifiedKitItems.has(c.id));
      if (verified.length > 0 && verified.length < packed.length) {
        return { li, verifiedCount: verified.length, totalCount: packed.length, verifiedAccessoryIds: accessoryAssetIds(verified) };
      }
    }
    return null;
  }

  /** Returns true when a dialog took over and the caller must NOT deploy `items` itself. */
  function openAccessoryGateIfNeeded(items: CheckOutItem[], durableOperationId?: string): boolean {
    const lineIds = items.map((i) => i.lineItemId);
    const { missingDefaults, missingOptionals } = computeMissingAccessories(lineIds);
    if (missingDefaults.length > 0 || missingOptionals.length > 0) {
      setAccessoryGate({ durableOperationId, pendingCheckOutItems: items, missingDefaults, missingOptionals });
      return true;
    }
    const partial = findPartiallyVerifiedAccessoryParent(lineIds);
    if (!partial) return false;
    const rest = items.filter((i) => i.lineItemId !== partial.li.id);
    if (rest.length > 0) runCheckOut(rest);
    setAccessoryVerifyConfirm({
      durableOperationId, parentLineItemId: partial.li.id, parentAssetId: partial.li.assetId || undefined,
      parentName: modelDisplayName(partial.li), verifiedCount: partial.verifiedCount, totalCount: partial.totalCount,
      verifiedAccessoryIds: partial.verifiedAccessoryIds,
    });
    return true;
  }

  /** Deploy the ticked Prepped rows (kits in one batch; plain lines through the accessory gate). */
  const handleCheckOutSelected = async (keys: Iterable<string>) => {
    const outKeys = stageActions.takeAccessoryStage(new Set(keys), "DEPLOY", isMoveableAtDeployStage);
    const bulkQtyMap = new Map<string, number>();
    const plainIds: string[] = [];
    const kitIds: string[] = [];
    for (const key of outKeys) {
      if (key.includes(":")) { const id = key.split(":")[0]; bulkQtyMap.set(id, (bulkQtyMap.get(id) || 0) + 1); continue; }
      const li = lineItems.find((l) => l.id === key);
      if (li && li.kitId && !li.isKitChild) { if (li.kitId) kitIds.push(li.kitId); } else plainIds.push(key);
    }
    if (kitIds.length > 0) mutations.kitBatchOutMutation.mutate(kitIds);
    const items: CheckOutItem[] = [
      ...plainIds.map((id) => ({ lineItemId: id, assetId: lineItems.find((l) => l.id === id)?.assetId || undefined })),
      ...Array.from(bulkQtyMap.entries()).map(([lineItemId, quantity]) => ({ lineItemId, quantity })),
    ];
    if (items.length === 0 || openAccessoryGateIfNeeded(items)) return;
    runCheckOut(items);
  };

  /** "Deploy this case": tick the case's entries so the existing Deploy path (gate included) is the one trigger. */
  const handleDeployContainer = (entries: GroupEntry[]) => setSelectedOut(new Set(keysForGroupEntries(entries)));

  /** Pack the marked rows now. Returns false (gate stays open, nothing deployed) on a failed OR short pack. */
  const packMarked = async (packIds: Set<string>, byId: Map<string, MissingAccessory>): Promise<boolean> => {
    if (packIds.size === 0) return true;
    const parents = [...new Set([...packIds].map((id) => byId.get(id)!.parentLineItemId))];
    const packed = await packAccessories(parents, "parent", packIds);
    if (!packed) return false; // the handler already toasted
    const short = [...packIds].filter((id) => !packed.has(id));
    if (short.length === 0) return true;
    toast.error(`${short.length} accessor${short.length === 1 ? "y" : "ies"} could not be packed. Pack again, or choose Leave and give a reason.`);
    return false;
  };

  /** Hand the final items to the durable review (scan deploy) or deploy them now. */
  const finishGate = (gate: NonNullable<typeof accessoryGate>, items: CheckOutItem[], decision: { accessoryDecision: "all" } | { accessoryDecision: "override"; skipped: Array<{ accessoryLineItemId: string; tier: "DEFAULT" | "OPTIONAL"; reason: string }> }) => {
    setAccessoryGate(null);
    if (!gate.durableOperationId) { runCheckOut(items); return; }
    const item = items[0];
    const base = { lineItemId: item.lineItemId, assetId: item.assetId };
    if (decision.accessoryDecision === "all") durableRef.current?.review(gate.durableOperationId, { ...base, accessoryDecision: "all" });
    else durableRef.current?.review(gate.durableOperationId, { ...base, accessoryDecision: "override", includeAccessoryIds: item.includeAccessoryIds, skippedAccessories: decision.skipped });
  };

  /** Narrow each pending parent's accessory cascade to exclude the accessories declared missing. */
  const narrowItems = (items: CheckOutItem[], skippedLineIds: Set<string>): CheckOutItem[] =>
    items.map((item) => {
      const li = lineItems.find((l) => l.id === item.lineItemId);
      if (!li) return item;
      const all = accessoryChildrenOf(li);
      const eligible = all.filter((c) => !skippedLineIds.has(c.id));
      return eligible.length === all.length ? item : { ...item, includeAccessoryIds: accessoryAssetIds(eligible) };
    });

  /**
   * `pack` rows are packed now (exactly those) and deploy with their parent; `leave` rows are logged with
   * the operator's own reason. Anything the server did not pack keeps the gate open: it is never turned
   * into "all" and never given an invented reason.
   */
  const confirmAccessoryGate = async (decisions: GateDecision[]) => {
    if (!accessoryGate) return;
    const { pendingCheckOutItems, missingDefaults, missingOptionals } = accessoryGate;
    const byId = new Map([...missingDefaults, ...missingOptionals].map((m) => [m.accessoryLineItemId, m]));
    const decided = new Map(decisions.filter((d) => byId.has(d.id)).map((d) => [d.id, d]));
    if (decided.size !== byId.size) { toast.error("Decide every accessory (Pack now or Leave) before deploying"); return; }
    const packIds = new Set([...decided.values()].filter((d) => d.action === "pack").map((d) => d.id));
    if (!(await packMarked(packIds, byId))) return;

    const skipped = [...decided.values()].filter((d) => d.action === "leave")
      .map((d) => ({ accessoryLineItemId: d.id, tier: byId.get(d.id)!.tier, reason: d.reason.trim() || "No reason recorded" }));
    if (skipped.length === 0) { finishGate(accessoryGate, pendingCheckOutItems, { accessoryDecision: "all" }); return; }
    if (!accessoryGate.durableOperationId) {
      const parentName = missingDefaults[0]?.parentName ?? missingOptionals[0]?.parentName ?? "line item";
      try { await warehouseWrites.logAccessoryCheckoutOverride(projectId, parentName, skipped); } catch { /* the audit write never blocks the deploy */ }
    }
    finishGate(accessoryGate, narrowItems(pendingCheckOutItems, new Set(skipped.map((s) => s.accessoryLineItemId))), { accessoryDecision: "override", skipped });
  };

  return { openAccessoryGateIfNeeded, runCheckOut, handleCheckOutSelected, handleDeployContainer, confirmAccessoryGate };
}
export type DeployGate = ReturnType<typeof useDeployGate>;
