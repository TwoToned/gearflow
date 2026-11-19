"use client";

import { useState } from "react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { useWarehouseScan, type ScanActOutcome } from "@/hooks/use-warehouse-scan";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { buildJobSections, type JobRowsCtx, type JobSection } from "@/lib/warehouse-job-rows";
import { keysForRowIds } from "@/lib/warehouse-job-keys";
import { bulkDeprepKeys, planDeprepScan, type DeprepScanResult } from "@/lib/warehouse-deprep-scan";
import type { ScanLookup } from "@/lib/warehouse-scan-classify";
import type { ActionMenuSpec, RowSelection } from "@/lib/primitives/types";
import { lookupAssetForScan } from "@/server/warehouse";
import { lookupDeprepScan } from "@/server/warehouse-deprep-scan";
import { jobRowIds } from "./job-table";
import type { StageAction } from "./moving-stage";
import type { JobStageKey } from "./stage-card";
import type { useScanFeedback } from "@/hooks/use-scan-feedback";
import type { LineItem } from "@/components/warehouse/warehouse-types";
import type { useJobItems } from "./use-job-items";
import type { useMoveToCase } from "./use-move-to-case";
import type { StageActions } from "./use-stage-actions";
import type { DeployGate } from "./use-deploy-gate";
import type { CaseSelection } from "./use-case-selection";
import type { JobGates } from "./use-job-gates";
import type { StageMutations } from "./job-types";

type Stage = "prepped" | "out" | "returned" | "deprepped";
type Feedback = ReturnType<typeof useScanFeedback>;
type Stash = Map<string, DeprepScanResult>;
const stashKey = (lineItemId: string, assetId: string | null | undefined) => `${lineItemId}|${assetId ?? ""}`;
const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

/** The server result as the classifier's lookup shape; the full result is kept for `act`. */
function toLookup(r: DeprepScanResult, stash: Stash): ScanLookup {
  if (r.kind === "none") return { found: false };
  if (r.kind === "refuse") return { found: true, type: null, lineItemId: null, reason: "not_deprepable", detail: r.text };
  const assetId = r.kind === "unit" || r.kind === "accessory" ? r.assetId : null;
  stash.set(stashKey(r.lineItemId, assetId), r);
  const type = r.kind === "kit" ? "kit" : r.kind === "bulk" ? "bulk" : "serialized";
  return { found: true, type, lineItemId: r.lineItemId, assetId, assetName: r.name, kitId: r.kind === "kit" ? r.kitId : null };
}

/**
 * The Prepped / Out / Returned / De-prepped bodies: sections, ticked-row selections, the stage verbs, and
 * each stage's dock. The Returned dock resolves a tag on the SERVER (`lookupDeprepScan`) and de-preps
 * exactly ONE unit per scan: a bulk bin asks for the count (D8), an accessory tag goes through the
 * unit-level DEPREP, a kit goes whole.
 */
export function useJobStages(deps: {
  projectId: string; stage: JobStageKey; dockMode: string; lineItems: LineItem[];
  items: ReturnType<typeof useJobItems>; cases: CaseSelection; gates: JobGates; move: ReturnType<typeof useMoveToCase>;
  mutations: StageMutations; stageActions: StageActions; deploy: DeployGate; scanFeedback: Feedback;
  captureDeployScan: (raw: string) => void; captureReturnScan: (raw: string) => void;
  onReportIssue: (li: LineItem) => void; onReturn: (keys: string[]) => void;
  clearContainer: (label: string) => void;
}) {
  const { projectId, stage, dockMode, lineItems, items, cases, gates, move, mutations, stageActions, deploy, scanFeedback } = deps;
  const { containerLabelById } = cases;
  const verifyCtx = {
    verified: gates.verifiedKitItems,
    toggle: (id: string) => gates.setVerifiedKitItems((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; }),
  };
  // Verify circles (kit members / accessories) belong to the stages that still gate a move forward.
  const ctxFor = (s: Stage): JobRowsCtx => ({ stage: s, containerLabelById, categoryOf: () => "", ...(s === "prepped" || s === "out" ? { verify: verifyCtx } : {}) });
  const sections: Record<Stage, JobSection[]> = {
    prepped: buildJobSections(items.equipmentItems, ctxFor("prepped")),
    out: buildJobSections(items.equipmentItems, ctxFor("out")),
    returned: buildJobSections(items.equipmentItems, ctxFor("returned")),
    deprepped: buildJobSections(items.equipmentItems, ctxFor("deprepped")),
  };
  const selection: Record<Stage, RowSelection> = {
    prepped: useRowSelection(jobRowIds(sections.prepped)),
    out: useRowSelection(jobRowIds(sections.out)),
    returned: useRowSelection(jobRowIds(sections.returned)),
    deprepped: useRowSelection(jobRowIds(sections.deprepped)),
  };
  const keysOf = (s: Stage) => keysForRowIds(lineItems, selection[s].selected, s);
  const done = (s: Stage, fn: () => void) => () => { fn(); selection[s].clear(); };
  const [binCount, setBinCount] = useState<{ lineItemId: string; name: string; remaining: number } | null>(null);

  const returnedActions: StageAction[] = [
    { key: "deprep", label: "De-prep", primary: true, loading: mutations.deprepMutation.isPending, run: done("returned", () => stageActions.handleDeprep(new Set(keysOf("returned")))) },
    { key: "to-out", label: "Move to Out", loading: mutations.unreturnMutation.isPending || mutations.unreturnKitsMutation.isPending, run: done("returned", () => stageActions.handleUnreturn(new Set(keysOf("returned")))) },
    { key: "move", label: "Move to case…", run: () => { move.setSelectedDeprep(new Set(keysOf("returned"))); move.setMoveDialogFor("deprep"); } },
  ];
  const depreppedActions: StageAction[] = [
    { key: "to-returned", label: "Move to Returned", primary: true, loading: mutations.undeprepMutation.isPending, run: done("deprepped", () => stageActions.handleUndeprep(keysOf("deprepped"))) },
  ];
  const preppedActions: StageAction[] = [
    { key: "deploy", label: "Deploy", primary: true, loading: mutations.checkOutMutation.isPending, run: done("prepped", () => void deploy.handleCheckOutSelected(keysOf("prepped"))) },
    { key: "to-pick", label: "Move to To pick", loading: mutations.deprepMutation.isPending, run: done("prepped", () => stageActions.handleDeprep(new Set(keysOf("prepped")))) },
    { key: "move", label: "Move to case…", run: () => { move.setSelectedOut(new Set(keysOf("prepped"))); move.setMoveDialogFor("deploy"); } },
  ];
  const outActions: StageAction[] = [
    { key: "return", label: "Return", primary: true, loading: mutations.checkInMutation.isPending, run: () => deps.onReturn(keysOf("out")) },
    { key: "to-prepped", label: "Move to Prepped", loading: mutations.undeployMutation.isPending || mutations.undeployKitsMutation.isPending, run: done("out", () => stageActions.handleUndeploy(new Set(keysOf("out")))) },
    { key: "move", label: "Move to case…", run: () => { move.setSelectedIn(new Set(keysOf("out"))); move.setMoveDialogFor("return"); } },
    ...(selection.out.count === 1 ? [{ key: "report", label: "Report issue", run: () => { const li = lineItems.find((l) => selection.out.selected.has(l.id)); if (li) deps.onReportIssue(li); } } satisfies StageAction] : []),
  ];
  const preppedCaseMenu = (s: JobSection): ActionMenuSpec | undefined => {
    if (s.key === "loose") return undefined;
    return {
      items: [
        { key: "deploy-case", label: "Deploy this case", group: "organise", onSelect: () => deploy.handleDeployContainer(items.deployContainerGroups.find((g) => g.container === s.section.title)?.entries ?? []) },
        { key: "unpack-case", label: "Unpack case", group: "danger", danger: true, onSelect: () => deps.clearContainer(s.section.title), confirm: { title: `Unpack ${s.section.title}?`, body: "Everything in it goes back to loose; nothing is de-prepped.", confirmLabel: "Unpack" } },
      ],
    };
  };

  // De-prep by scan: validated on the server, never against a client list.
  const stash = useState<Stash>(() => new Map())[0];
  const runPlan = (r: DeprepScanResult | undefined): ScanActOutcome => {
    if (!r) return { text: "Asset not found", tone: "warning" };
    const plan = planDeprepScan(r);
    if (plan.kind === "keys") stageActions.handleDeprep(new Set(plan.keys), plan.assetId);
    else if (plan.kind === "accessoryUnit") stageActions.stageAccessories([plan.unitId], "DEPREP");
    else if (plan.kind === "askCount") setBinCount({ lineItemId: plan.lineItemId, name: plan.name, remaining: plan.remaining });
    return plan.kind === "refuse" ? { text: plan.text, tone: plan.tone } : { text: plan.text, ...(plan.kind === "askCount" ? { tone: "neutral" as const } : {}) };
  };
  const confirmBinCount = (count: number) => {
    if (!binCount) return;
    stageActions.handleDeprep(new Set(bulkDeprepKeys(binCount.lineItemId, count)));
    setBinCount(null);
  };
  const returnedScan = useWarehouseScan({
    stage: "returned",
    mode: dockMode === "check" ? "check" : "prep",
    lookup: async (raw) => toLookup(await lookupDeprepScan(projectId, raw), stash),
    context: () => ({ containersByTag: new Map() }),
    setCase: () => {},
    verifyKitMember: () => {},
    actKit: async (p) => runPlan(stash.get(stashKey(p.lineItemId, null))),
    act: async (p) => runPlan(stash.get(stashKey(p.lineItemId, p.assetId))),
    describe: (p) => ({ text: `${p.name}: back from the job (check only, nothing de-prepped)`, tone: "neutral" }),
    addAndAct: async (o) => ({ text: `${o.name} is not on this job`, tone: "warning" }),
    isOffline,
    play: (kind) => scanFeedback.play(kind),
  });

  /** Prepped / Out dock: a write goes through the durable intake; check mode only looks the tag up. */
  const movingScan = async (raw: string) => {
    if (dockMode !== "check") { if (stage === "prepped") deps.captureDeployScan(raw); else deps.captureReturnScan(raw); return; }
    try {
      const r = (await lookupAssetForScan(projectId, raw.trim(), stage === "out" ? "checkin" : "checkout")) as ScanLookup;
      toast.info("found" in r && r.found ? `${raw.trim()}: on this job (check only, nothing changed)` : `${raw.trim()} is not on this job`);
    } catch (e) { showError(e); }
  };

  return { sections, selection, preppedActions, outActions, returnedActions, depreppedActions, preppedCaseMenu, returnedScan, movingScan, binCount, setBinCount, confirmBinCount };
}
