"use client";

import { useWarehouseScan } from "@/hooks/use-warehouse-scan";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { buildJobSections, type JobSection } from "@/lib/warehouse-job-rows";
import { keysForRowIds, prepRowIds } from "@/lib/warehouse-job-keys";
import type { ScanLookup } from "@/lib/warehouse-scan-classify";
import { lookupAssetForScan } from "@/server/warehouse";
import { prepKitChildren } from "@/server/check-records";
import { collectAllVerifiableIds, parentAlreadyPrepped, scanAccessoryOptions, type LineItem } from "@/components/warehouse/warehouse-types";
import type { useScanFeedback } from "@/hooks/use-scan-feedback";
import { jobRowIds } from "./job-table";
import type { PrepHandlers } from "./prep-split-button";
import type { CaseSelection } from "./use-case-selection";
import type { JobGates } from "./use-job-gates";
import type { PrepActions } from "./use-prep-actions";
import type { ScanPrep } from "./use-scan-prep";
import type { StageActions } from "./use-stage-actions";
import type { CheckFlow } from "./job-types";

type Feedback = ReturnType<typeof useScanFeedback>;

/** To pick: the job table sections, ticked-row selection, the prep verbs and the one scan pipeline. */
export function usePickStage(deps: {
  projectId: string; dockMode: string; lineItems: LineItem[]; equipmentItems: LineItem[]; overbookedMap: Record<string, { overBy: number }>;
  cases: CaseSelection; gates: JobGates; checkFlow: CheckFlow; prep: PrepActions; scanPrep: ScanPrep; stageActions: StageActions;
  scanFeedback: Feedback; invalidate: () => void;
}) {
  const { projectId, dockMode, lineItems, equipmentItems, overbookedMap, cases, gates, checkFlow, prep, scanPrep, stageActions, scanFeedback, invalidate } = deps;
  const sections: JobSection[] = buildJobSections(equipmentItems, {
    stage: "pick",
    containerLabelById: cases.containerLabelById,
    categoryOf: (li) => (li.model as { category?: { name?: string } | null } | null)?.category?.name ?? "Equipment",
    shortById: new Map(Object.entries(overbookedMap).map(([id, o]) => [id, o.overBy])),
  });
  const selection = useRowSelection(jobRowIds(sections));
  // The live `prepActionAvailability` gate: parent verbs never see a packed parent, accessory verbs only do.
  const prepAndClear = (kind: "parents" | "accessories", run: (keys: string[]) => unknown) => {
    void run(keysForRowIds(lineItems, prepRowIds(lineItems, selection.selected, kind), "pick"));
    selection.clear();
  };
  const prepHandlers: PrepHandlers = {
    withAccessories: () => prepAndClear("parents", (keys) => prep.handlePrepSelected({ keys })),
    parentOnly: () => prepAndClear("parents", (keys) => prep.handlePrepSelected({ keys, withoutAccessories: true })),
    accessoriesWithParent: () => prepAndClear("accessories", (keys) => prep.handlePrepAccessoriesOnly(keys, "parent")),
    accessoriesIntoActive: () => prepAndClear("accessories", (keys) => prep.handlePrepAccessoriesOnly(keys, "active")),
    choose: () => {
      const first = lineItems.find((l) => selection.selected.has(l.id) && scanAccessoryOptions(l).length > 0);
      if (first) void scanPrep.routeScanPrep({ lineItemId: first.id, assetId: first.assetId });
      selection.clear();
    },
    unpackParent: () => {
      const packed = lineItems.filter((l) => selection.selected.has(l.id) && parentAlreadyPrepped(l)).map((l) => l.id);
      stageActions.handleDeprep(new Set(keysForRowIds(lineItems, packed, "prepped")));
      selection.clear();
    },
  };

  const kitLine = (kitId: string) => lineItems.find((l) => l.kitId === kitId && !l.isKitChild);
  const actKit = async (p: { kitId: string; lineItemId: string; name: string }) => {
    const kitLi = kitLine(p.kitId);
    const allIds = collectAllVerifiableIds(kitLi ? ((kitLi.childLineItems || []) as LineItem[]) : [], "deploy");
    const verifiedIds = allIds.filter((id) => gates.verifiedKitItems.has(id));
    if (allIds.length > 0 && verifiedIds.length < allIds.length) {
      gates.setKitConfirm({ action: "deploy", kitName: p.name, kitId: p.kitId, parentLineItemId: kitLi?.id || p.lineItemId, verifiedCount: verifiedIds.length, totalCount: allIds.length, verifiedIds });
      return { text: `${p.name}: confirm unverified items`, tone: "warning" as const };
    }
    if (kitLi && checkFlow.startKitCheckFlow(p.kitId, kitLi, "PREP")) return { text: `${p.name}: prep check to run`, tone: "warning" as const };
    if (kitLi) await prepKitChildren(projectId, kitLi.id);
    invalidate();
    return { text: `Kit prepped: ${p.name}` };
  };
  const verifyKitMember = (p: { kitId: string; assetId: string }) => {
    const kitLi = kitLine(p.kitId);
    if (!kitLi) return;
    const children = (kitLi.childLineItems || []) as LineItem[];
    const child = children.find((c) => c.assetId === p.assetId) || children.flatMap((c) => (c.childLineItems || []) as LineItem[]).find((c) => c.assetId === p.assetId);
    if (child) gates.setVerifiedKitItems((prev) => new Set(prev).add(child.id));
  };

  const scan = useWarehouseScan({
    stage: "pick",
    mode: dockMode === "check" ? "check" : "prep",
    lookup: (raw) => lookupAssetForScan(projectId, raw, "checkout") as Promise<ScanLookup>,
    context: () => ({
      containersByTag: new Map(cases.realContainers.filter((c) => c.tag).map((c) => [c.tag as string, { id: c.id, label: c.label }])),
      batchKeys: new Set(scanPrep.scanBatch.map((b) => `${b.lineItemId}:${b.assetId}`)),
      kitOnJob: (kitId) => !!kitLine(kitId),
    }),
    setCase: cases.handleSelectContainer,
    verifyKitMember,
    actKit,
    act: (p) => scanPrep.routeScanPrep({ lineItemId: p.lineItemId, assetId: p.assetId, assetName: p.name }),
    describe: (p) => ({ text: `${p.name}: on this job (check only, nothing prepped)`, tone: "neutral" }),
    addAndAct: async (offer) => {
      scanPrep.offerAdd({ assetName: offer.name, modelId: offer.modelId, assetId: offer.assetId, bulkAssetId: offer.bulkAssetId, isBulk: offer.isBulk });
      return { text: `Confirm adding ${offer.name} to this job`, tone: "neutral" };
    },
    isOffline: () => typeof navigator !== "undefined" && !navigator.onLine,
    play: (kind) => scanFeedback.play(kind),
  });
  return { sections, selection, prepHandlers, scan };
}
