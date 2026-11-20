"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)
import { use, useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useConvexAuth } from "convex/react";
import { OUT_LABEL } from "@/lib/vocabulary";
import { useNativeWarehouseProject } from "@/hooks/use-native-warehouse";
import { DetailHeader } from "@/components/ui/detail-header";
import { warehouseHeaderProps } from "@/lib/warehouse-job-header";
import { prepSelectionInfo } from "@/lib/warehouse-job-keys";
import { useLabelIndex, openLabel } from "@/components/documents/label-submenu";
import { labelActionItems } from "@/lib/warehouse-label-items";
import { useFormatters } from "@/components/providers/format-provider";
import { projectScheduleRows } from "@/lib/project-context";
import { useCanDo, useCurrentRole } from "@/lib/use-permissions";
import { intakeToStripEntries } from "@/lib/durable-scan-strip";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useWarehouseOverbooked } from "@/hooks/use-warehouse-overbooked";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import type { SaleItemToPrep } from "@/lib/warehouse-detail-reconstruct";
import type { ActionItem } from "@/lib/primitives/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { StageCard, stageFromParams, type JobStageKey } from "@/components/warehouse/job/stage-card";
import { PickStage } from "@/components/warehouse/job/pick-stage";
import { MovingStage } from "@/components/warehouse/job/moving-stage";
import { CheckFlowSheet } from "@/components/warehouse/job/check-flow-sheet";
import { DeployGateDialog } from "@/components/warehouse/job/deploy-gate-dialog";
import { KitConfirmDialog } from "@/components/warehouse/job/kit-confirm-dialog";
import { AccessoryVerifyDialog } from "@/components/warehouse/job/accessory-verify-dialog";
import { AddToJobDialog } from "@/components/warehouse/job/add-to-job-dialog";
import { AssetPickerDialog } from "@/components/warehouse/job/asset-picker-dialog";
import { ReturnCheckDialog, type ReturnCheckResult } from "@/components/warehouse/job/return-check-dialog";
import { BinCountDialog } from "@/components/warehouse/job/bin-count-dialog";
import { useStageMutations } from "@/components/warehouse/job/use-stage-mutations";
import { useCheckQueue } from "@/components/warehouse/job/use-check-queue";
import { useCaseSelection } from "@/components/warehouse/job/use-case-selection";
import { useJobGates } from "@/components/warehouse/job/use-job-gates";
import { useMoveToCase } from "@/components/warehouse/job/use-move-to-case";
import { useStageActions } from "@/components/warehouse/job/use-stage-actions";
import { useAssetPicker } from "@/components/warehouse/job/use-asset-picker";
import { usePrepActions } from "@/components/warehouse/job/use-prep-actions";
import { useDeployGate } from "@/components/warehouse/job/use-deploy-gate";
import { useDurableScans } from "@/components/warehouse/job/use-durable-scans";
import { useScanPrep } from "@/components/warehouse/job/use-scan-prep";
import { useJobItems } from "@/components/warehouse/job/use-job-items";
import { useJobStages } from "@/components/warehouse/job/use-job-stages";
import { usePickStage } from "@/components/warehouse/job/use-pick-stage";
import { usePickExtras } from "@/components/warehouse/job/use-pick-extras";
import { modelDisplayName, type LineItem } from "@/components/warehouse/warehouse-types";
import { relocateAccessories } from "@/components/warehouse/relocate-accessories";
import { ReportIssueDialog } from "@/components/warehouse/report-issue-dialog";
import { PullSheetDialog } from "@/components/warehouse/pull-sheet-dialog";
import { useJobDocs } from "@/components/warehouse/job/use-job-docs";
import { ScanAccessoryDialog, ScanCheckModeDialog } from "@/components/warehouse/scan-prep-dialogs";
import { CloseOutTab } from "@/components/warehouse/close-out-tab";
import { NewContainerSheet } from "@/components/warehouse/new-container-sheet";
import { MoveToContainerDialog } from "@/components/warehouse/move-to-container-dialog";

const statusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry", QUOTING: "Quoting", QUOTED: "Quoted", CONFIRMED: "Confirmed", PREPPING: "Prepping",
  CHECKED_OUT: OUT_LABEL, ON_SITE: "On site", RETURNED: "Returned", COMPLETED: "Completed", INVOICED: "Invoiced", CANCELLED: "Cancelled",
};

/** The legacy tab each stage still renders (strangler; the stage strip replaced the tab list). */
const TAB_FOR_STAGE: Record<JobStageKey, string> = {
  pick: "pick-prep", prepped: "check-out", out: "check-in", returned: "deprep", deprepped: "deprepped", closeout: "close-out",
};
const NEW_CASE = "__new-case";

export default function WarehouseProjectPageWrapper({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <Suspense>
      <WarehouseProjectPage params={params} />
    </Suspense>
  );
}

function WarehouseProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { formatDateDayMonth } = useFormatters();
  // The job's stage (spec §9.2): `?stage=` wins, the old `?tab=` deep links alias onto it.
  const [stage, setStageState] = useState<JobStageKey>(() => stageFromParams(searchParams));
  const setStage = useCallback((next: JobStageKey) => {
    setStageState(next);
    const url = new URL(window.location.href);
    url.searchParams.delete("tab");
    url.searchParams.set("stage", next);
    window.history.replaceState(null, "", url);
  }, []);
  const [dockMode, setDockMode] = useState("prep");
  const scanInputRef = useRef<HTMLInputElement>(null);
  const deployScanInputRef = useRef<HTMLInputElement>(null);
  const returnScanInputRef = useRef<HTMLInputElement>(null);
  // What Return / the dock's received scans are saved as (the durable payload's condition + notes).
  const [returnCheck, setReturnCheck] = useState<ReturnCheckResult>({ condition: "GOOD", notes: "" });
  const [returnDialog, setReturnDialog] = useState<{ keys: string[] } | "scan" | null>(null);
  const [reportIssueTarget, setReportIssueTarget] = useState<LineItem | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const { data: scanSession } = useSession();
  const orgId = activeOrg?.id;
  const { isAuthenticated: authed } = useConvexAuth();
  const canUndoPrep = useCanDo("warehouse", "check_out"); // de-prep (the reverse of a prep) needs check_out
  const { role: currentRole } = useCurrentRole();
  const isManagerTier = currentRole === "owner" || currentRole === "admin" || currentRole === "manager";
  const scanFeedback = useScanFeedback();
  const warehouseWrites = useWarehouseWrites();

  // ONE live `warehouseDetail.bundle` subscription reconstructs the whole warehouse shape client-side.
  const native = useNativeWarehouseProject(projectId, orgId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project = native.data as any;
  const lineItems = project ? (project.lineItems || []) as unknown as LineItem[] : [];
  const saleItemsToPrep = project ? (project.saleItemsToPrep || []) as SaleItemToPrep[] : [];
  // Accessory units packed into a different case than their parent are lifted into their own lines so every stage sees them.
  const placed = relocateAccessories(lineItems);

  const move = useMoveToCase(placed);
  const cases = useCaseSelection({ projectId, orgId, authed, lineItems, warehouseWrites });
  const gates = useJobGates(lineItems, `${orgId}|${projectId}|${scanSession?.user.id}|${project?.liveVersionId}`);
  const mutations = useStageMutations({ projectId, lineItems, warehouseWrites, invalidate: move.invalidate });
  const checkFlow = useCheckQueue({
    projectId, lineItems, selectedContainer: cases.selectedContainer, activeContainerId: cases.activeContainerId,
    kitCheckInMutation: mutations.kitCheckInMutation, checkInMutation: mutations.checkInMutation,
    clearAccessoryVerification: gates.clearAccessoryVerification, invalidate: move.invalidate, closeKitConfirm: gates.closeKitConfirm,
    hasKitConfirmBacklog: () => gates.kitConfirmBacklogRef.current.length > 0,
    setReturnNotes: (notes) => setReturnCheck((c) => ({ ...c, notes })),
    scanInputRef, deployScanInputRef, returnScanInputRef,
  });
  const stageActions = useStageActions({
    projectId, lineItems, placed, warehouseWrites, mutations, checkFlow, verifiedKitItems: gates.verifiedKitItems, setKitConfirm: gates.setKitConfirm, clear: move.clear,
  });
  const picker = useAssetPicker({
    projectId, lineItems, cases, checkFlow, clearAccessoryVerification: gates.clearAccessoryVerification, invalidate: move.invalidate, scanFeedback,
  });
  const prep = usePrepActions({ projectId, lineItems, cases, gates, checkFlow, picker, invalidate: move.invalidate });
  const durableRef = useRef<ReturnType<typeof useDurableScans>["durable"] | null>(null);
  const deploy = useDeployGate({
    projectId, lineItems, gates, mutations, warehouseWrites, stageActions, isManagerTier,
    packAccessories: prep.handlePrepAccessoriesOnly, durableRef, setSelectedOut: move.setSelectedOut,
  });
  const { durable, captureDeployScan, captureReturnScan } = useDurableScans({
    orgId, userId: scanSession?.user.id, projectId, versionId: project?.liveVersionId || "", lineItems, gates, scanFeedback,
    openAccessoryGateIfNeeded: deploy.openAccessoryGateIfNeeded, returnCheck,
  });
  useEffect(() => { durableRef.current = durable; });
  const scanPrep = useScanPrep({
    projectId, lineItems, cases, checkFlow, warehouseWrites, scanFeedback, canUndoPrep, invalidate: move.invalidate,
    clearAccessoryVerification: gates.clearAccessoryVerification, scanInputRef,
  });
  const overbookedMap = useWarehouseOverbooked(orgId, projectId, lineItems);
  const extras = usePickExtras(projectId, warehouseWrites);
  const items = useJobItems(placed, cases.containerLabelById);
  const pick = usePickStage({
    projectId, dockMode, lineItems, equipmentItems: items.equipmentItems, overbookedMap, cases, gates, checkFlow, prep, scanPrep, stageActions,
    scanFeedback, invalidate: move.invalidate,
  });
  const stages = useJobStages({
    projectId, stage, dockMode, lineItems, items, cases, gates, move, mutations, stageActions, deploy, scanFeedback,
    captureDeployScan, captureReturnScan, onReportIssue: setReportIssueTarget, onReturn: (keys) => setReturnDialog({ keys }),
    clearContainer: (label) => mutations.clearContainerMutation.mutate(label),
  });
  const durableStrip = intakeToStripEntries(durable.entries, durable.retry, { error: durable.error, unsaved: durable.unsaved ? { raw: durable.unsaved } : null });
  const caseTarget = {
    verb: "Prep",
    current: cases.activeContainerId ? { id: cases.activeContainerId, label: cases.containerLabelById.get(cases.activeContainerId) ?? "Case" } : { id: "", label: "Loose" },
    options: [{ id: "", label: "Loose" }, ...cases.realContainers.map((c) => ({ id: c.id, label: c.label })), { id: NEW_CASE, label: "New case…" }],
    onChange: (id: string) => (id === NEW_CASE ? cases.setNewContainerSheetOpen(true) : cases.handleSelectContainer(id || null)),
  };

  // --- Header (spec §5.9): the page computes the strings, warehouseHeaderProps shapes them ---
  // Only the job's start is fed (when gear leaves): there is no truck or packer source on the project summary.
  const jobStart = project ? projectScheduleRows(project)[0] : undefined;
  const jobDocs = useJobDocs({ orgId, projectId, status: project?.status, lineItems, initialDoc: searchParams.get("doc") });
  const baseHeader = warehouseHeaderProps({
    openPullSheet: jobDocs.openPullSheet,
    overrides: jobDocs.overrides,
    loadsOut: jobStart?.date ? `${formatDateDayMonth(jobStart.date)}${jobStart.time ? ` ${jobStart.time}` : ""}` : undefined,
    name: project?.name ?? "",
    status: project?.status ?? "",
    statusLabel: statusLabels[project?.status] || project?.status || "",
    openDocument: (type) => window.open(`/api/documents/${projectId}?type=${type}`, "_blank"),
    hasContainers: cases.realContainers.length > 0,
    onViewProject: () => router.push(`/projects/${projectId}`),
    feedback: scanFeedback,
  });
  const kitLabelIndex = useLabelIndex(projectId, "kit-label", true);
  const itemLabelIndex = useLabelIndex(projectId, "item-label", true);
  const labelItems: ActionItem[] = labelActionItems({
    containers: cases.realContainers,
    kit: kitLabelIndex.status === "ready" ? kitLabelIndex.labels : null,
    item: itemLabelIndex.status === "ready" ? itemLabelIndex.labels : null,
    open: (type, id) => openLabel(projectId, type, id),
  });
  const headerProps = { ...baseHeader, documents: { items: [...(baseHeader.documents?.items ?? []), ...labelItems] } };

  if (native.isLoading) {
    return (
      <RequirePermission resource="warehouse" action="read">
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-12 w-72 rounded-[var(--r)]" />
          <Skeleton className="h-10 w-full max-w-md rounded-[var(--r)]" />
          <Skeleton className="h-64 rounded-[var(--r-lg)]" />
        </div>
      </RequirePermission>
    );
  }
  if (!project) {
    return (
      <RequirePermission resource="warehouse" action="read">
        <div className="rounded-[var(--r)] border-l-[3px] border-l-t-out bg-card p-4 ring-1 ring-line">
          <p className="text-ui-text font-medium text-ink">Job not found</p>
          <p className="text-caption text-muted mt-0.5">It may have been removed, or you don&apos;t have access to it.</p>
          <Button variant="line" size="sm" className="mt-3" asChild>
            <Link href="/warehouse"><ArrowLeft className="mr-2 h-4 w-4" />Back to warehouse</Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  const { sections, selection } = stages;
  const emptyFor = {
    returned: { title: "Nothing to de-prep", description: "Gear scanned back in waits here; de-prep puts it back into inventory." },
    deprepped: { title: "Nothing de-prepped yet", description: "Gear you de-prep from Returned lands here, back in inventory." },
    prepped: { title: "Nothing prepped", description: "Gear you prep on To pick waits here to be deployed." },
    out: { title: "Nothing out on this job", description: "Gear that is out shows here, ready to scan back in." },
  };
  const gate = gates.accessoryGate;
  return (
    <RequirePermission resource="warehouse" action="read">
    <FadeIn>
    <div className="space-y-6">
      <DetailHeader {...headerProps} />

      <StageCard
        stage={stage}
        counts={{ pick: items.pickPrepItems.length, prepped: items.preppedItems.length, out: items.checkedOutItems.length, returned: items.returnedItems.length, deprepped: items.deprepedItems.length }}
        onStageChange={setStage}
        onScan={(raw) => void (stage === "pick" ? pick.scan.scan(raw) : stage === "returned" ? stages.returnedScan.scan(raw) : stages.movingScan(raw))}
        mode={dockMode}
        onModeChange={setDockMode}
        caseTarget={stage === "pick" ? caseTarget : undefined}
        entries={stage === "pick" ? pick.scan.entries : stage === "returned" ? stages.returnedScan.entries : durableStrip}
        showDock={stage === "pick" || stage === "prepped" || stage === "out" || stage === "returned"}
        disabledScan={(stage === "prepped" || stage === "out") && durable.busy}
      />
      {stage === "returned" && <MovingStage sections={sections.returned} selection={selection.returned} actions={stages.returnedActions} empty={emptyFor.returned} />}
      {stage === "deprepped" && <MovingStage sections={sections.deprepped} selection={selection.deprepped} actions={stages.depreppedActions} empty={emptyFor.deprepped} />}
      {stage === "prepped" && <MovingStage sections={sections.prepped} selection={selection.prepped} actions={stages.preppedActions} sectionMenu={stages.preppedCaseMenu} empty={emptyFor.prepped} />}
      {stage === "out" && (
        <MovingStage sections={sections.out} selection={selection.out} actions={stages.outActions} empty={emptyFor.out}>
          <p className="text-caption text-muted">
            Received scans save as <span className="font-medium text-ink">{returnCheck.condition.toLowerCase()}</span>.{" "}
            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setReturnDialog("scan")}>Change</button>
          </p>
        </MovingStage>
      )}
      {/* Strangler: the stage strip above drives the old tabs (no TabsList); close-out is the one that remains. */}
      <Tabs value={TAB_FOR_STAGE[stage]}>
        {stage === "pick" && (
          <PickStage
            sections={pick.sections}
            selection={pick.selection}
            prepInfo={prepSelectionInfo(lineItems, pick.selection.selected)}
            prepHandlers={pick.prepHandlers}
            saleItems={{ items: saleItemsToPrep, onTogglePicked: extras.handleToggleSalePicked, pendingIds: extras.pendingSalePickIds }}
            customUnits={{
              lines: items.pickPrepItems, overbookedMap, pendingLineIds: extras.pendingCustomUnitLineIds,
              onConvert: extras.handleConvertToCustomUnit, onConvertBack: extras.handleConvertBackToInventory,
            }}
            batch={{ mode: scanPrep.scanCheckMode, onModeChange: scanPrep.setScanCheckMode, names: scanPrep.scanBatch.map((b) => b.assetName), onFinish: scanPrep.finishScanBatch, onClear: () => scanPrep.setScanBatch([]) }}
          />
        )}
        <NewContainerSheet
          open={cases.newContainerSheetOpen}
          onOpenChange={cases.setNewContainerSheetOpen}
          projectId={projectId}
          existingContainers={cases.realContainers.map((c) => ({ id: c.id, label: c.label }))}
          onCreated={cases.handleContainerCreated}
        />
        <MoveToContainerDialog
          open={move.moveDialogFor !== null}
          onOpenChange={(open) => !open && move.setMoveDialogFor(null)}
          unitCount={move.moveDialogUnitIds.length}
          containers={cases.realContainers}
          onConfirm={move.handleConfirmMove}
          pending={move.moveIsPending}
        />
        <TabsContent value="close-out">
          <CloseOutTab projectId={projectId} onChanged={() => {}} />
        </TabsContent>
      </Tabs>

      {gates.kitConfirm && (
        <KitConfirmDialog
          kit={gates.kitConfirm} onClose={gates.closeKitConfirm} durable={durable} projectId={projectId} lineItems={lineItems}
          mutations={mutations} checkFlow={checkFlow} check={returnCheck} invalidate={move.invalidate}
        />
      )}
      {gate && (
        <DeployGateDialog
          rows={[...gate.missingDefaults, ...gate.missingOptionals].map((m) => ({
            id: m.accessoryLineItemId, name: m.accessoryName, parentName: m.parentName, tier: m.tier, officeNote: m.officeNote,
          }))}
          onConfirm={deploy.confirmAccessoryGate}
          onCancel={() => gates.setAccessoryGate(null)}
        />
      )}
      {gates.accessoryVerifyConfirm && (
        <AccessoryVerifyDialog confirm={gates.accessoryVerifyConfirm} onClose={() => gates.setAccessoryVerifyConfirm(null)} durable={durable} runCheckOut={deploy.runCheckOut} />
      )}
      {scanPrep.scanAccessoryPrompt && (
        <ScanAccessoryDialog
          key={scanPrep.scanAccessoryPrompt.target.lineItemId + (scanPrep.scanAccessoryPrompt.target.assetId ?? "")}
          prompt={scanPrep.scanAccessoryPrompt.data}
          onDecide={(d, remember) => scanPrep.decideScanAccessories(scanPrep.scanAccessoryPrompt!, d, remember)}
          onDiscard={() => {
            scanFeedback.play("info", { label: scanPrep.scanAccessoryPrompt!.data.parentName, outcome: "Scan discarded" });
            scanPrep.setScanAccessoryPrompt(null);
            scanPrep.scanFocus();
          }}
        />
      )}
      {scanPrep.scanModePrompt && (
        <ScanCheckModeDialog
          itemName={scanPrep.scanModePrompt.name}
          onChoose={(mode) => {
            const { target, opts } = scanPrep.scanModePrompt!;
            scanPrep.setScanModePrompt(null);
            scanPrep.setScanCheckMode(mode);
            void scanPrep.proceedScanPrep(target, opts, mode);
          }}
          onDiscard={() => { scanPrep.setScanModePrompt(null); scanPrep.scanFocus(); }}
        />
      )}
      <AddToJobDialog
        open={scanPrep.addPromptOpen}
        assetName={scanPrep.addPromptData?.assetName}
        pending={scanPrep.quickAddMutation.isPending}
        onCancel={() => { scanPrep.setAddPromptOpen(false); scanPrep.setAddPromptData(null); scanPrep.scanFocus(); }}
        onAdd={() => {
          const d = scanPrep.addPromptData;
          if (d) scanPrep.quickAddMutation.mutate({ modelId: d.modelId, assetId: d.assetId || undefined, bulkAssetId: d.bulkAssetId || undefined, quantity: 1 });
        }}
      />
      <AssetPickerDialog picker={picker} />
      {returnDialog && (
        <ReturnCheckDialog
          count={returnDialog === "scan" ? 0 : returnDialog.keys.length}
          scanDefault={returnDialog === "scan"}
          initial={returnCheck}
          onCancel={() => setReturnDialog(null)}
          onConfirm={(check) => {
            setReturnCheck(check);
            if (returnDialog !== "scan") { stageActions.handleReturnSelected(returnDialog.keys, check); selection.out.clear(); }
            setReturnDialog(null);
          }}
        />
      )}
      {stages.binCount && (
        <BinCountDialog name={stages.binCount.name} remaining={stages.binCount.remaining} onConfirm={stages.confirmBinCount} onCancel={() => stages.setBinCount(null)} />
      )}
      <CheckFlowSheet
        flow={checkFlow}
        projectId={projectId}
        orgId={orgId}
        selectedContainer={cases.selectedContainer}
        activeContainerId={cases.activeContainerId}
        invalidate={move.invalidate}
      />
      <ReportIssueDialog
        open={reportIssueTarget !== null}
        onOpenChange={(open) => { if (!open) setReportIssueTarget(null); }}
        targetLabel={reportIssueTarget?.asset?.assetTag ?? reportIssueTarget?.bulkAsset?.assetTag ?? (reportIssueTarget ? modelDisplayName(reportIssueTarget) : "item")}
        projectId={projectId}
        lineItemId={reportIssueTarget?.id}
        assetId={reportIssueTarget?.assetId ?? undefined}
      />
      <PullSheetDialog projectIds={jobDocs.pullSheetIds} onClose={jobDocs.closePullSheet} />
    </div>
    </FadeIn>
    </RequirePermission>
  );
}
