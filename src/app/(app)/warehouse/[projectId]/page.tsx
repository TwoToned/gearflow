"use client";
import { ReviewScanError } from "@/lib/scan-intake";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)
import { OUT_LABEL } from "@/lib/vocabulary";

import { use, useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useNativeWarehouseProject } from "@/hooks/use-native-warehouse";
import {
  ChevronRight,
  ArrowLeft,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { containerArgs, type ContainerChoice } from "@/lib/warehouse-container-choice";
import { DetailHeader } from "@/components/ui/detail-header";
import { warehouseHeaderProps } from "@/lib/warehouse-job-header";
import { StageCard, stageFromParams, type JobStageKey } from "@/components/warehouse/job/stage-card";
import { PickStage } from "@/components/warehouse/job/pick-stage";
import type { PrepHandlers } from "@/components/warehouse/job/prep-split-button";
import { useWarehouseScan, type ScanActOutcome } from "@/hooks/use-warehouse-scan";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { buildJobSections, type JobSection } from "@/lib/warehouse-job-rows";
import type { ScanLookup } from "@/lib/warehouse-scan-classify";
import type { ActionItem } from "@/lib/primitives/types";
import { parentAlreadyPrepped } from "@/components/warehouse/warehouse-types";
import { jobRowIds } from "@/components/warehouse/job/job-table";
import { keysForRowIds, prepRowIds, prepSelectionInfo } from "@/lib/warehouse-job-keys";
import { useLabelIndex, openLabel } from "@/components/documents/label-submenu";
import { labelActionItems } from "@/lib/warehouse-label-items";
import { useFormatters } from "@/components/providers/format-provider";
import { projectScheduleRows } from "@/lib/project-context";
import { announcePrepWrite } from "@/lib/warehouse-prep-announce";
import { useCanDo } from "@/lib/use-permissions";
import { focusRing } from "@/lib/utils";
import { transitionNeedsCheck, lineHasModelChecks } from "@/lib/warehouse-check-policy";
import type { SaleItemToPrep } from "@/lib/warehouse-detail-reconstruct";

import {
  lookupAssetForScan,
  getAvailableAssetsForModels,
} from "@/server/warehouse";
import { useWarehouseWrites, type AccessoryStageOp } from "@/hooks/use-warehouse-writes";
import { useWarehouseOverbooked } from "@/hooks/use-warehouse-overbooked";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { CheckFlowSheet } from "@/components/warehouse/job/check-flow-sheet";
import { useStageMutations } from "@/components/warehouse/job/use-stage-mutations";
import { useCheckQueue, type CheckQueueItem } from "@/components/warehouse/job/use-check-queue";
import { ReportIssueDialog } from "@/components/warehouse/report-issue-dialog";
import {
  ScanAccessoryDialog,
  ScanCheckModeDialog,
  type ScanAccessoryDecision,
  type ScanAccessoryPromptData,
  type ScanCheckMode,
} from "@/components/warehouse/scan-prep-dialogs";
import { CloseOutTab } from "@/components/warehouse/close-out-tab";
import { NewContainerSheet } from "@/components/warehouse/new-container-sheet";
import { MoveToContainerDialog } from "@/components/warehouse/move-to-container-dialog";
import { AccessorySelectionContext } from "@/components/warehouse/kit-child-rows";
import { isRelocatedLineId, relocateAccessories, takeAccessorySelection } from "@/components/warehouse/relocate-accessories";
import { DeployTab } from "@/components/warehouse/deploy-tab";
import { ReturnTab } from "@/components/warehouse/return-tab";
import { EmptyState } from "@/components/ui/empty-state";
import type { LineItem, AvailableAsset, GroupEntry } from "@/components/warehouse/warehouse-types";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { resolvePickerScan, countAssigned } from "@/lib/asset-picker-scan";
import {
  modelDisplayName,
  isKitParent,
  isAccessoryParent,
  packedParentAssetIds,
  prepActionAvailability,
  scanAccessoryOptions,
  accessoryChildrenOf,
  collectAllVerifiableIds,
  isInPickPrepStage,
  isInPreppedStage,
  isInReturnedStage,
  isInDeprepedStage,
  deprepedQuantity,
  isInCheckedOutStage,
  buildContainerGroups,
  resolveItemContainerId,
  resolveSelectionToUnitIds,
  isMoveableAtDeployStage,
  isMoveableAtReturnStage,
  isMoveableAtDeprepStage,
  keysForGroupEntries,
  selectionKeysForEntries,
  accessoryAssetIds,
  groupItems,
  groupCheckinItems,
} from "@/components/warehouse/warehouse-types";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import {
  pullItem,
  prepItemDirect,
  prepItemsBatch,
  deprepItemsBatch,
  prepKitChildren,
  prepKitsBatch,
} from "@/server/check-records";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api as convexApi } from "../../../../../convex/_generated/api";
import { useDurableScanIntake } from "@/hooks/use-durable-scan-intake";
import { ScanIntakeStatus } from "@/components/warehouse/scan-intake-status";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useCurrentRole } from "@/lib/use-permissions";
import { isInternalStockLine } from "@/lib/warehouse-subhire-filter";

const statusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: OUT_LABEL,
  ON_SITE: "On site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};


// LineItem, AvailableAsset, GroupEntry types are imported from warehouse-types

// isBulkItem, modelDisplayName are imported from warehouse-types

// KitChildRows is imported from @/components/warehouse/kit-child-rows

// ---------------------------------------------------------------------------
// Grouping: serialized items with same model get grouped, bulk items become
// expandable with per-unit rows, single serialized items stay flat.
// ---------------------------------------------------------------------------

// GroupEntry, isKitParent, PrepStatusBadge, collectAllVerifiableIds are imported from warehouse-types / components


// bulkUnitKey is imported from warehouse-types

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function WarehouseProjectPageWrapper({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense>
      <WarehouseProjectPage params={params} />
    </Suspense>
  );
}

/** The model/asset-tag half of a scan-prep queue entry. */
const ACCESSORY_STAGE_DONE: Record<AccessoryStageOp, string> = {
  DEPLOY: "Deployed", RETURN: "Returned", DEPREP: "De-prepped",
  UNDEPLOY: "Moved back to Prepped:", UNRETURN: `Moved back to ${OUT_LABEL}:`, UNDEPREP: "Re-packed",
};

/** The legacy tab each stage still renders (strangler; the stage strip replaced the tab list). */
const TAB_FOR_STAGE: Record<JobStageKey, string> = {
  pick: "pick-prep", prepped: "check-out", out: "check-in", returned: "deprep", deprepped: "deprepped", closeout: "close-out",
};

function scanQueueIdentity(li: LineItem | undefined) {
  return {
    modelId: li?.modelId ?? undefined,
    assetTag: scanQueueTag(li),
    bulkAssetId: li?.bulkAssetId || undefined,
  };
}

function scanQueueTag(li: LineItem | undefined) {
  return li?.asset?.assetTag || li?.bulkAsset?.assetTag || "";
}

function WarehouseProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
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

  const [scanValue, setScanValue] = useState("");
  const [deployScanValue, setDeployScanValue] = useState("");
  const [returnScanValue, setReturnScanValue] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [returnCondition, setReturnCondition] = useState("GOOD");
  const [returnNotes, setReturnNotes] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const { data: scanSession } = useSession();
  const orgId = activeOrg?.id;
  const wConvex = useConvex();
  const { isAuthenticated: wAuthed } = useConvexAuth();

  // Container state for prep grouping. `selectedContainer` (a label string) is
  // the legacy widen-step field, kept in sync so unmigrated readers (grouping,
  // display) keep working; `activeContainerId` (#1296) is the real container
  // now written through alongside it — see `handleSelectContainer`.
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  // Tri-state (see warehouse-container-choice.ts): `undefined` = packer has not
  // chosen, so writes omit `containerId` and the PM's plan applies; `null` =
  // Loose deliberately picked; string = a case.
  const [activeContainerId, setActiveContainerId] = useState<ContainerChoice>(undefined);
  const canUndoPrep = useCanDo("warehouse", "check_out"); // de-prep (the reverse of a prep) needs check_out
  const [newContainerSheetOpen, setNewContainerSheetOpen] = useState(false);
  const realContainers = useQuery(
    convexApi.projectContainers.listForProject,
    orgId ? { orgId, projectId } : "skip",
  ) ?? [];
  // Deploy/Return/De-prep sectioning (buildContainerGroups) resolves a real
  // containerId to its current label through this map.
  const containerLabelById = useMemo(() => new Map(realContainers.map((c) => [c.id, c.label])), [realContainers]);
  const handleSelectContainer = useCallback((id: ContainerChoice) => {
    setActiveContainerId(id);
    setSelectedContainer(id ? realContainers.find((c) => c.id === id)?.label ?? "" : "");
  }, [realContainers]);
  const handleContainerCreated = useCallback((container: { id: string; label: string }) => {
    setActiveContainerId(container.id);
    setSelectedContainer(container.label);
    setNewContainerSheetOpen(false);
  }, []);
  // #1296 phase 2 — scan-to-activate: scanning a container's OWN asset tag
  // (the case/tub itself, not its contents) on the pick/prep scan bar
  // switches the active rail chip instead of running the normal
  // lookupAssetForScan prep flow, which would otherwise either try to
  // (re-)prep the container's own line item or report it as unassigned.
  const matchContainerByTag = useCallback(
    (scannedTag: string) => realContainers.find((c) => c.tag && c.tag === scannedTag) ?? null,
    [realContainers],
  );

  // Selection state
  const [selectedPrep, setSelectedPrep] = useState<Set<string>>(new Set());
  const [selectedOut, setSelectedOut] = useState<Set<string>>(new Set());
  const [selectedDeprep, setSelectedDeprep] = useState<Set<string>>(new Set());
  const [selectedIn, setSelectedIn] = useState<Set<string>>(new Set());

  // NEW_STOCK sale-item pick checklist — tracks in-flight toggles so a double-click
  // can't fire the mutation twice while the first call is still pending.
  const [pendingSalePickIds, setPendingSalePickIds] = useState<Set<string>>(new Set());

  // Kit verification — track which child assets have been scanned to confirm presence
  const [verifiedKitItems, setVerifiedKitItems] = useState<Set<string>>(new Set());

  // "Add to project" prompt state (when scanned asset is not on the project)
  const [addPromptOpen, setAddPromptOpen] = useState(false);
  const [addPromptData, setAddPromptData] = useState<{
    assetName: string;
    modelId: string;
    assetId: string | null;
    bulkAssetId: string | null;
    isBulk: boolean;
  } | null>(null);

  // Asset picker dialog state
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerItems, setAssetPickerItems] = useState<Array<{
    lineItemId: string;
    modelId: string;
    modelName: string;
    availableAssets: AvailableAsset[];
    selectedAssetId: string;
    checkItemCount: number;
  }>>([]);
  const [assetPickerBulkItems, setAssetPickerBulkItems] = useState<Array<{
    lineItemId: string;
    quantity: number;
  }>>([]);
  /** Typed / wedge-scanned text in the Assign-assets dialog's scan field. */
  const [assetPickerScanValue, setAssetPickerScanValue] = useState("");
  /**
   * Synchronous mirror of `assetPickerItems`, for scan resolution only.
   *
   * Continuous scanning delivers hits from a decode callback, so the handler
   * React invokes is the one captured at the last COMMITTED render. Two units
   * scanned before that commit lands would both resolve against the same rows,
   * pick the same empty slot, and the second would silently overwrite the
   * first — losing a unit in exactly the eleven-in-a-row flow this feature
   * exists for. Writing the ref before the setState makes each scan see the
   * previous one regardless of render timing.
   */
  const assetPickerItemsRef = useRef<typeof assetPickerItems>([]);
  /** Write picker rows through here so the ref can never drift from state. */
  const applyAssetPickerItems = (
    next: typeof assetPickerItems | ((prev: typeof assetPickerItems) => typeof assetPickerItems)
  ) => {
    const resolved = typeof next === "function" ? next(assetPickerItemsRef.current) : next;
    assetPickerItemsRef.current = resolved;
    setAssetPickerItems(resolved);
  };

  // Kit verification confirmation dialog
  type KitConfirmState = {
    action: "deploy" | "return";
    kitName: string;
    kitId: string;
    parentLineItemId: string;
    verifiedCount: number;
    totalCount: number;
    verifiedIds: string[];
    durableOperationId?: string;
  };
  const [kitConfirm, setKitConfirm] = useState<KitConfirmState | null>(null);
  // Further unverified kits from the same selection, and kits held back while
  // another check queue is running. The dialog is single-slot and "Prep All"
  // restarts the shared check queue, so these wait their turn rather than
  // clobbering the rest of the selection.
  const kitConfirmBacklogRef = useRef<KitConfirmState[]>([]);
  const closeKitConfirm = () => setKitConfirm(kitConfirmBacklogRef.current.shift() ?? null);

  // Accessory checkout gate (issue #794 follow-up) — soft-blocks Deploy when a
  // parent's DEFAULT accessories aren't packed, and asks "why" for missing
  // OPTIONALs. `pendingCheckOutItems` is the batch waiting on this dialog.
  const [accessoryGate, setAccessoryGate] = useState<{
    durableOperationId?: string;
    pendingCheckOutItems: Array<{ lineItemId: string; assetId?: string; quantity?: number; includeAccessoryIds?: string[] }>;
    missingDefaults: Array<{ parentLineItemId: string; parentName: string; accessoryLineItemId: string; accessoryName: string }>;
    missingOptionals: Array<{ parentLineItemId: string; parentName: string; accessoryLineItemId: string; accessoryName: string }>;
  } | null>(null);
  const [defaultOverrideReason, setDefaultOverrideReason] = useState("");
  const [optionalSkipReasons, setOptionalSkipReasons] = useState<Record<string, { preset: string; note: string }>>({});

  // Accessory partial-verification confirm (issue #794's remaining acceptance
  // criterion) — mirrors the kit prep dialog's "Deploy Verified Only"/"Deploy
  // All" UX, but for the actual Deploy action: an accessory parent whose
  // PACKED accessories are only partially click-to-verified offers a choice
  // instead of silently cascading everything.
  const [accessoryVerifyConfirm, setAccessoryVerifyConfirm] = useState<{
    durableOperationId?: string;
    parentLineItemId: string;
    parentAssetId?: string;
    parentName: string;
    verifiedCount: number;
    totalCount: number;
    /** Verified accessories' own asset/bulkAsset identities — what
     *  `checkOutItems`'s `includeAccessoryIds` actually narrows by. */
    verifiedAccessoryIds: string[];
  } | null>(null);

  // "Report issue" dialog (GitHub #898) — opened from a CHECKED_OUT line item
  // row on the Return tab (Deployed gear). Non-null target = dialog open.
  const [reportIssueTarget, setReportIssueTarget] = useState<LineItem | null>(null);
  const handleReportIssue = (item: LineItem) => setReportIssueTarget(item);

  // --- Scan-prep options ---
  // Whether a scan that needs a check form opens it now ("inline") or is held
  // until the operator finishes scanning ("batch"). "ask" = not chosen yet.
  const [scanCheckMode, setScanCheckMode] = useState<ScanCheckMode>("ask");
  type ScanPrepTarget = { lineItemId: string; assetId?: string | null; assetName?: string | null };
  type ScanPrepOpts = { includeAccessoryIds?: string[]; accessoriesOnly?: boolean };
  const [scanAccessoryPrompt, setScanAccessoryPrompt] = useState<{ target: ScanPrepTarget; data: ScanAccessoryPromptData } | null>(null);
  const [scanModePrompt, setScanModePrompt] = useState<{ target: ScanPrepTarget; opts: ScanPrepOpts; name: string } | null>(null);
  // Scans held for "bulk after scanning": needsCheck entries become the check
  // queue, the rest are prepped in one batch call when the operator finishes.
  const [scanBatch, setScanBatch] = useState<Array<CheckQueueItem & { needsCheck: boolean }>>([]);


  // Native warehouse-detail read (Phase 4 — the version-vector server-action path is
  // retired). ONE live `warehouseDetail.bundle` subscription reconstructs the full
  // getProjectForWarehouse shape client-side, reactive over the WebSocket (the
  // warehouseOps mutations write line items + units in Convex, so edits push to this
  // subscription). No server action, no manual refetch needed.
  const native = useNativeWarehouseProject(projectId, orgId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project = native.data as any;
  const isLoading = native.isLoading;

  // Browser-direct warehouse writes (PR-A: return / undeploy / container family).
  const warehouseWrites = useWarehouseWrites();
  // Manager-tier roles can bypass the accessory-gate reason prompt (issue #794
  // follow-up design decision) — the dialog still records SOME reason either way.
  const { role: currentRole } = useCurrentRole();
  const isManagerTier = currentRole === "owner" || currentRole === "admin" || currentRole === "manager";
  // Scan-verdict audio feedback (success/error/exception tones) — see FEATUREDOCS/12.
  const scanFeedback = useScanFeedback();

  // Post-write refresh is now a no-op: the native subscription pushes every
  // warehouseOps change live over the WebSocket, so an explicit refetch is
  // redundant (kept to avoid touching every call site).
  const refetchProject = useCallback(() => {}, []);
  const invalidate = () => {
    setSelectedOut(new Set());
    setSelectedIn(new Set());
  };

  // Helper: ensure container asset is on the project when prepping into it
  // Uses refs so it can be called from mutations defined before containerOptions
  const ensureContainerIfNeeded = useCallback(async () => {
    const asset = selectedContainerAssetRef.current;
    const container = selectedContainerRef.current;
    if (asset?.assetId && asset.modelId) {
      await warehouseWrites.ensureContainerOnProject(projectId, asset.assetId, asset.modelId, container);
    }
  }, [projectId, warehouseWrites]);

  const quickAddMutation = useServerMutation({
    mutationFn: async (data: { modelId: string; assetId?: string; bulkAssetId?: string; quantity?: number }) => {
      await ensureContainerIfNeeded();
      // #1296 — quickAddCore inserts a bare line item with no unit row (unlike
      // prepUnit), so there's nothing to stamp a real containerId onto yet;
      // it stays on the legacy label-only path. The very next prep step for
      // this line (below, in onSuccess) DOES create a unit and gets the real
      // containerId — this line just can't itself.
      return warehouseWrites.quickAddAndCheckOut(projectId, { ...data, prepContainer: selectedContainer || null });
    },
    onSuccess: (result) => {
      const assetName = addPromptData?.assetName || "Asset";
      setAddPromptOpen(false);
      setAddPromptData(null);
      setScanValue("");
      invalidate();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const li = result as any;
      const hasChecks = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) });

      if (hasChecks && li.modelId) {
        // Route through check queue — pull first, then open check form
        pullItem(projectId, li.id).catch(() => {});
        setCheckFormData({
          context: "PREP",
          modelId: li.modelId,
          assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "",
          assetName,
          lineItemId: li.id,
          assetId: li.assetId || li.asset?.id || "",
          bulkAssetId: li.bulkAssetId || undefined,
        });
        setCheckFormOpen(true);
        scanInputRef.current?.focus();
      } else {
        // No checks — prep directly
        prepItemDirect(projectId, li.id, li.assetId || undefined, undefined, selectedContainer || null, undefined, containerArgs(activeContainerId).containerId)
          .then(() => {
            toast.success(`Added and prepped: ${assetName}`);
            invalidate();
          })
          .catch((e) => showError(e, { fallbackTitle: "Failed to prep" }));
        scanInputRef.current?.focus();
      }
    },
    onError: (e) => showError(e),
  });

  // An accessory is a normal asset on the job that may nest under a parent, so
  // it is actioned on its own — before or after the parent, in a different
  // container, or with it. Selected accessories (relocated rows and nested
  // accessory rows) go through the unit-level stage mutation; everything else in
  // the selection is returned for the line / kit paths.
  const stageAccessories = (
    unitIds: string[],
    to: AccessoryStageOp,
    returnCondition?: "GOOD" | "DAMAGED" | "MISSING",
  ) => {
    if (unitIds.length === 0) return;
    warehouseWrites
      .stageAccessoryUnits(projectId, unitIds, to, returnCondition)
      .then(() => toast.success(`${ACCESSORY_STAGE_DONE[to]} ${unitIds.length} accessor${unitIds.length === 1 ? "y" : "ies"}`))
      .catch((e) => showError(e));
  };
  const takeAccessoryStage = (
    keys: Iterable<string>,
    to: AccessoryStageOp,
    isRelevant: (u: NonNullable<LineItem["units"]>[number]) => boolean,
    returnCondition?: "GOOD" | "DAMAGED" | "MISSING",
  ): string[] => {
    const { rest, unitIds } = takeAccessorySelection(keys, placed, isRelevant);
    stageAccessories(unitIds, to, returnCondition);
    return rest;
  };

  // Parse a selection set (bulk `id:idx` keys, plain line ids, kit parents) into
  // per-line quantities + kit ids, then fire the given item/kit reverse mutations.
  const moveBackSelection = (
    ids: Set<string>,
    accessoryOp: "UNDEPLOY" | "UNRETURN",
    isRelevant: (u: NonNullable<LineItem["units"]>[number]) => boolean,
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
      if (li && li.kitId && !li.isKitChild) {
        kitIds.add(li.kitId);
      } else {
        qtyMap.set(lineItemId, (qtyMap.get(lineItemId) || 0) + 1);
      }
    }
    // Bulk single-call: ONE array mutation for all selected kits (was one per kit).
    if (kitIds.size > 0) fireKits(Array.from(kitIds));
    const items = Array.from(qtyMap.entries()).map(([lineItemId, quantity]) => ({
      lineItemId,
      assetId: lineItems.find((l) => l.id === lineItemId)?.assetId || undefined,
      quantity,
    }));
    if (items.length > 0) fireItems(items);
  };

  // Deployed → Prepped
  const handleUndeploy = (ids: Set<string>) => {
    moveBackSelection(ids, "UNDEPLOY", isMoveableAtReturnStage, (items) => undeployMutation.mutate(items), (kitIds) => undeployKitsMutation.mutate(kitIds));
    setSelectedIn(new Set());
  };
  // Returned → Deployed
  const handleUnreturn = (ids: Set<string>) => {
    moveBackSelection(ids, "UNRETURN", isMoveableAtDeprepStage, (items) => unreturnMutation.mutate(items), (kitIds) => unreturnKitsMutation.mutate(kitIds));
    setSelectedDeprep(new Set());
  };

  // --- Scan prep routing ---
  // 1) a parent with accessories on the job asks which ones are with it,
  // 2) then the scan is prepped now, run through the check form, or held for the
  //    "bulk after scanning" batch, per `scanCheckMode`.
  function scanFocus() {
    setScanValue("");
    scanInputRef.current?.focus();
  }

  async function routeScanPrep(target: ScanPrepTarget): Promise<ScanActOutcome> {
    const li = lineItems.find((l) => l.id === target.lineItemId);
    const name = target.assetName || (li ? modelDisplayName(li) : "Asset");
    if (target.assetId && scanBatch.some((b) => b.lineItemId === target.lineItemId && b.assetId === target.assetId)) {
      scanFeedback.play("exception", { label: name, outcome: "Already scanned" });
      toast.info(`${name} is already in this scan batch`);
      scanFocus();
      return { text: `${name} is already in this scan batch`, tone: "warning" };
    }
    if (li) {
      const options = scanAccessoryOptions(li);
      if (options.length > 0) {
        setScanAccessoryPrompt({
          target,
          data: { parentName: modelDisplayName(li), parentPrepped: prepActionAvailability([li.id], [li]).canPrepAccessoriesOnly, options },
        });
        return { text: `${name}: choose which accessories`, tone: "neutral" };
      }
    }
    return proceedScanPrep(target, {});
  }

  function decideScanAccessories(prompt: { target: ScanPrepTarget }, d: ScanAccessoryDecision) {
    setScanAccessoryPrompt(null);
    if (d.kind === "without") void proceedScanPrep(prompt.target, { includeAccessoryIds: [] });
    else if (d.kind === "with") void proceedScanPrep(prompt.target, { includeAccessoryIds: d.accessoryIds });
    else void proceedScanPrep(prompt.target, { includeAccessoryIds: d.accessoryIds, accessoriesOnly: true });
  }

  function scanQueueItem(target: ScanPrepTarget, name: string, opts: ScanPrepOpts): CheckQueueItem {
    const li = lineItems.find((l) => l.id === target.lineItemId);
    return {
      ...scanQueueIdentity(li),
      context: "PREP",
      assetName: name,
      lineItemId: target.lineItemId,
      assetId: target.assetId || li?.assetId || "",
      ...(opts.includeAccessoryIds ? { includeAccessoryIds: opts.includeAccessoryIds } : {}),
    };
  }

  async function prepScanAccessoriesOnly(target: ScanPrepTarget, name: string, opts: ScanPrepOpts) {
    await prepItemsBatch(projectId, [{
      lineItemId: target.lineItemId,
      assetId: target.assetId || undefined,
      prepContainer: selectedContainer || null,
      ...containerArgs(activeContainerId),
      includeAccessoryIds: opts.includeAccessoryIds,
      accessoriesOnly: true,
    }]);
    clearAccessoryVerification([target.lineItemId]);
    scanFeedback.play("success", { label: name, outcome: "Accessories prepped" });
    // No clean reverse for an accessories-only pack: toast only, no Undo.
    return announcePrepWrite({ doneTitle: `Accessories prepped: ${name}`, undoneTitle: "", reverse: [], canUndo: false, deprep: deprepItemsBatch.bind(null, projectId) });
  }

  async function prepScanDirect(target: ScanPrepTarget, name: string, opts: ScanPrepOpts) {
    // No check items — prep directly (set prepStatus=PACKED, no deploy)
    await prepItemDirect(projectId, target.lineItemId, target.assetId || undefined, undefined, selectedContainer || null, opts.includeAccessoryIds, containerArgs(activeContainerId).containerId);
    scanFeedback.play("success", { label: name, outcome: "Prepped" });
    const li = lineItems.find((l) => l.id === target.lineItemId);
    // A line with its own asset de-preps whole; a multi-quantity line gives back the one unit this scan packed.
    const reverse = [{ lineItemId: target.lineItemId, ...(li?.assetId ? {} : { quantity: 1 }) }];
    return announcePrepWrite({ doneTitle: `Prepped: ${name}`, undoneTitle: `Undone — ${name} back in To pick`, reverse, canUndo: canUndoPrep, deprep: deprepItemsBatch.bind(null, projectId) });
  }

  // Returns true when the scan was fully handled by a dialog/queue and the
  // caller should stop; false when it should be prepped directly.
  function deferScanPrep(target: ScanPrepTarget, name: string, opts: ScanPrepOpts, needsCheck: boolean, mode: ScanCheckMode) {
    if (needsCheck && mode === "ask") {
      setScanModePrompt({ target, opts, name });
      return true;
    }
    const queueItem = scanQueueItem(target, name, opts);
    if (mode === "batch") {
      setScanBatch((prev) => [...prev, { ...queueItem, needsCheck }]);
      scanFeedback.play("info", { label: name, outcome: needsCheck ? "Queued for checks" : "Queued" });
      return true;
    }
    if (needsCheck) {
      // Pull item first, then open the check form (prep flow)
      pullItem(projectId, target.lineItemId).catch(() => {});
      setCheckFormData(queueItem);
      setCheckFormOpen(true);
      return true;
    }
    return false;
  }

  /** Preps (or defers to a check) and reports the one-line outcome the scan strip shows. */
  async function proceedScanPrep(target: ScanPrepTarget, opts: ScanPrepOpts, modeOverride?: ScanCheckMode): Promise<ScanActOutcome> {
    const li = lineItems.find((l) => l.id === target.lineItemId);
    const name = target.assetName || (li ? modelDisplayName(li) : "Asset");
    try {
      await ensureContainerIfNeeded();
      let outcome: ScanActOutcome;
      if (opts.accessoriesOnly) {
        const w = await prepScanAccessoriesOnly(target, name, opts);
        outcome = { text: `Accessories prepped: ${name}`, undo: w.scanUndo };
      } else {
        const needsCheck = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) }) && !!li?.modelId;
        const deferred = deferScanPrep(target, name, opts, needsCheck, modeOverride ?? scanCheckMode);
        const w = deferred ? undefined : await prepScanDirect(target, name, opts);
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
  }

  // "Bulk after scanning" — run every held check, then prep the no-check scans.
  function finishScanBatch() {
    if (scanBatch.length === 0) return;
    const queue = scanBatch.filter((b) => b.needsCheck).map(({ needsCheck: _n, ...q }) => q);
    const direct = scanBatch.filter((b) => !b.needsCheck);
    setScanBatch([]);
    if (queue.length > 0) {
      startCheckQueue(queue, direct.map((b) => ({ lineItemId: b.lineItemId, assetId: b.assetId || undefined, includeAccessoryIds: b.includeAccessoryIds })));
      return;
    }
    prepItemsBatch(projectId, direct.map((b) => ({
      lineItemId: b.lineItemId,
      assetId: b.assetId || undefined,
      prepContainer: selectedContainer || null,
      ...containerArgs(activeContainerId),
      includeAccessoryIds: b.includeAccessoryIds,
    })))
      .then(() => {
        clearAccessoryVerification(direct.map((b) => b.lineItemId));
        toast.success(`Prepped ${direct.length} item${direct.length === 1 ? "" : "s"}`);
        invalidate();
      })
      .catch((e) => showError(e, { fallbackTitle: "Prep failed" }));
  }

  // --- Scan mutations ---
  const scanMutation = useServerMutation({
    mutationFn: (assetTag: string) => lookupAssetForScan(projectId, assetTag, "checkout"),
    onSuccess: async (result, scannedTag) => {
      // Handle kit scans — prep the kit (not deploy)
      if (result.found && result.type === "kit") {
        const kitResult = result as { kitId: string; kitAssetTag: string; assetName: string; lineItemId: string | null; reason: string | null };
        if (kitResult.lineItemId && !kitResult.reason) {
          const kitLi = lineItems.find((l) => l.kitId === kitResult.kitId && !l.isKitChild);
          // Check verification status before prepping
          const children = kitLi ? ((kitLi.childLineItems || []) as LineItem[]) : [];
          const allIds = collectAllVerifiableIds(children, "deploy");
          const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));
          if (allIds.length > 0 && verifiedIds.length < allIds.length) {
            setKitConfirm({
              action: "deploy",
              kitName: kitResult.assetName,
              kitId: kitResult.kitId,
              parentLineItemId: kitLi?.id || kitResult.lineItemId || "",
              verifiedCount: verifiedIds.length,
              totalCount: allIds.length,
              verifiedIds,
            });
            setScanValue("");
            scanInputRef.current?.focus();
          } else {
            // Try to start kit check flow; if no checks needed, prep directly
            const started = kitLi ? startKitCheckFlow(kitResult.kitId, kitLi, "PREP") : false;
            if (!started && kitLi) {
              // No checks — mark kit children as prepped
              prepKitChildren(projectId, kitLi.id)
                .then(() => {
                  scanFeedback.play("success", { label: kitResult.assetName, outcome: "Kit prepped" });
                  toast.success(`Kit prepped: ${kitResult.assetName}`);
                  invalidate();
                })
                .catch((e) => {
                  scanFeedback.play("error", {
                    label: kitResult.assetName,
                    outcome: e instanceof Error ? e.message : "Failed to prep kit",
                  });
                  showError(e, { fallbackTitle: "Failed to prep kit" });
                });
              setScanValue("");
              scanInputRef.current?.focus();
            }
          }
        } else {
          const messages: Record<string, string> = {
            not_on_project: "Kit not assigned to this job",
            already_checked_out: "Kit already deployed",
          };
          const outcome = messages[kitResult.reason as string] || "Cannot prep this kit";
          scanFeedback.play("error", { label: kitResult.assetName, outcome });
          toast.error(outcome);
          setScanValue("");
          scanInputRef.current?.focus();
        }
        return;
      }

      // Handle kit member scans — verify the item is present in the kit
      if (result.found && result.type === "kit_member") {
        const memberResult = result as { kitId: string | null; kitAssetTag: string | null; assetId: string | null; assetName: string };
        const kitOnProject = memberResult.kitId && lineItems.find((li) => li.kitId === memberResult.kitId && !li.isKitChild);
        if (kitOnProject && memberResult.assetId) {
          const children = (kitOnProject.childLineItems || []) as LineItem[];
          const childLi = children.find((c) => c.assetId === memberResult.assetId)
            || children.flatMap((c) => (c.childLineItems || []) as LineItem[]).find((c) => c.assetId === memberResult.assetId);
          if (childLi) {
            setVerifiedKitItems((prev) => {
              const next = new Set(prev);
              next.add(childLi.id);
              return next;
            });
          }
          const kitGroupKey = `kit-${kitOnProject.id}`;
          setExpandedGroups((prev) => {
            const next = new Set(prev);
            next.add(kitGroupKey);
            return next;
          });
          scanFeedback.play("success", { label: memberResult.assetName, outcome: "Verified" });
          toast.success(`Verified: ${memberResult.assetName}`);
        } else {
          scanFeedback.play("error", { label: memberResult.assetName, outcome: "Not on this job" });
          toast.error(`This asset is in a kit${memberResult.kitAssetTag ? ` (${memberResult.kitAssetTag})` : ""} not on this job.`);
        }
        setScanValue("");
        scanInputRef.current?.focus();
        return;
      }

      if (result.found && result.type === "asset_child") {
        const r = result as { assetName: string; parentAssetTag: string | null };
        // Disambiguation needed — scanned an accessory, not its parent. Resolved
        // but needs attention, not a hard failure.
        scanFeedback.play("exception", { label: r.assetName, outcome: "Accessory — scan the parent instead" });
        toast.info(`${r.assetName} is an accessory${r.parentAssetTag ? ` of ${r.parentAssetTag}` : ""} — scan the parent; accessories move with it.`);
        setScanValue("");
        scanInputRef.current?.focus();
        return;
      }

      if (result.found && result.lineItemId) {
        routeScanPrep({ lineItemId: result.lineItemId, assetId: result.assetId, assetName: result.assetName });
      } else if (result.found && !result.lineItemId) {
        if (result.reason === "not_on_project" && "modelId" in result && result.modelId) {
          // Asset found but not on this project — resolved but needs a decision
          // (add it?), not a hard failure.
          scanFeedback.play("exception", { label: result.assetName || "Unknown asset", outcome: "Not on this job" });
          // Prompt user to add asset to the project
          setAddPromptData({
            assetName: result.assetName || "Unknown asset",
            modelId: result.modelId as string,
            assetId: result.assetId || null,
            bulkAssetId: (result as Record<string, unknown>).bulkAssetId as string | null,
            isBulk: !!(result as Record<string, unknown>).isBulk,
          });
          setAddPromptOpen(true);
          setScanValue("");
          return;
        }
        const detail = "detail" in result ? (result.detail as string) : "";
        const assetStatus = "assetStatus" in result ? (result.assetStatus as string) : "";
        const ttStatus = "ttStatus" in result ? (result.ttStatus as string) : "";
        const ttNextDue =
          "ttNextDueDate" in result && result.ttNextDueDate
            ? new Date(result.ttNextDueDate as unknown as string).toLocaleDateString()
            : "";
        const messages: Record<string, string> = {
          already_checked_out: "Already deployed on this job",
          asset_checked_out_elsewhere: `Already deployed${detail}`,
          not_on_project: "Asset not assigned to this job",
          not_checked_out: "Asset is not deployed on this job",
          already_returned: "All units already returned",
          asset_unavailable: `Asset is ${assetStatus.replace("_", " ").toLowerCase()} and cannot be deployed`,
          tt_blocked: `Test & Tag ${ttStatus.toLowerCase()}${ttNextDue ? ` — next test due ${ttNextDue}` : ""}. Cannot deploy until tested.`,
        };
        // "already_returned" is resolved but needs attention (all units are back
        // already) rather than a hard failure — every other reason here blocks
        // the scan outright.
        const outcome = messages[result.reason as string] || "Cannot deploy this asset";
        scanFeedback.play(result.reason === "already_returned" ? "exception" : "error", { label: scannedTag, outcome });
        toast.error(outcome);
        setScanValue("");
        scanInputRef.current?.focus();
      } else {
        // Unknown tag — resolved (we know it's not in the system) but needs the
        // operator's attention, not a hard error.
        scanFeedback.play("exception", { label: scannedTag, outcome: "Asset not found" });
        toast.error("Asset not found");
        setScanValue("");
        scanInputRef.current?.focus();
      }
    },
    onError: (e, scannedTag) => {
      scanFeedback.play("error", { label: scannedTag, outcome: e instanceof Error ? e.message : "Scan failed" });
      showError(e);
      setScanValue("");
      scanInputRef.current?.focus();
    },
  });

  const durableScans = useDurableScanIntake(
    wAuthed && orgId && scanSession?.user.id ? { orgId, userId: scanSession.user.id, projectId, expectedVersionId: project?.liveVersionId || "" } : null,
    async operation => {
      if (!orgId || !scanSession?.user.id) throw new Error("Sign in again before replaying scans");
      return wConvex.query(convexApi.scanIntake.verifyContext, { orgId, projectId, expectedUserId: scanSession.user.id, operation });
    },
    async (entry, assertCurrent, save) => {
      if (!entry.expectedVersionId) throw new Error("Saved scan has no job version. Review before recapturing.");
      if (!entry.effect) {
        // Raw scan, condition and notes are already durable BEFORE this lookup.
        const result = await lookupAssetForScan(entry.projectId, entry.raw.trim(), entry.operation === "deploy" ? "checkout" : "checkin");
        assertCurrent();
        if (!result.found) throw new Error("Asset not found. Saved for review.");
        if (result.type === "kit_member") {
          const member = result as {kitId:string|null;assetId:string|null;assetName:string};
          const kitLine = lineItems.find(l => l.kitId === member.kitId && !l.isKitChild);
          if (entry.operation === "return" && kitLine && member.assetId) {
            const children = (kitLine.childLineItems || []) as LineItem[];
            const child = children.find(c => c.assetId === member.assetId) || children.flatMap(c => (c.childLineItems || []) as LineItem[]).find(c => c.assetId === member.assetId);
            if (child) setVerifiedKitItems(prev => new Set(prev).add(child.id));
            setExpandedGroups(prev => new Set(prev).add(`kit-in-${kitLine.id}`));
            throw new Error("Verified locally — not returned. Scan the kit barcode to return it.");
          }
          throw new Error("Kit member: scan the kit barcode. Saved for review.");
        }
        if (result.type === "asset_child") throw new Error("Accessory: scan its parent barcode. Saved for review.");
        if (!result.lineItemId || result.reason) throw new Error(result.reason || "Item is not actionable on this job");
        const matched = lineItems.find(l => l.id === result.lineItemId);
        if (!matched) throw new Error("Job data unavailable. Reconnect and review this saved scan.");
        if (entry.operation === "deploy") {
          if (matched.prepStatus !== "PACKED" || matched.status === "CHECKED_OUT") throw new Error("Item is not prepped or is already deployed");

        }
        if (result.type === "kit") {
          const kit = result as { kitId:string };
          const ids = collectAllVerifiableIds((matched.childLineItems || []) as LineItem[], "return");
          entry.effect = {kitId:kit.kitId, lineItemId:matched.id, ...(entry.operation === "return" && ids.every(id => verifiedKitItems.has(id)) ? {kitDecision:"all" as const} : {})};
        } else entry.effect = {lineItemId:result.lineItemId,assetId:result.assetId || undefined};
        // Persist resolved intent before sending, so acknowledgement-loss replay
        // uses the SAME operation and payload even if a later lookup would differ.
        save(entry);
      }
      if (entry.operation === "deploy" && !entry.effect.kitId && !entry.effect.accessoryDecision &&
          openAccessoryGateIfNeeded([{lineItemId:entry.effect.lineItemId!,assetId:entry.effect.assetId}],entry.id))
        throw new ReviewScanError("Review accessories before deploying. Captured scan is saved.");
      if (entry.operation === "return" && entry.effect.kitId && !entry.effect.kitDecision) {
        const matched = lineItems.find(l => l.id === entry.effect!.lineItemId);
        if (!matched) throw new Error("Kit version data unavailable. Return to its captured job version.");
        const ids = collectAllVerifiableIds((matched.childLineItems || []) as LineItem[], "return");
        const verifiedIds = ids.filter(id => verifiedKitItems.has(id));
        setKitConfirm({action:"return",kitName:matched.kit?.name || "Kit",kitId:entry.effect.kitId,parentLineItemId:matched.id,verifiedCount:verifiedIds.length,totalCount:ids.length,verifiedIds,durableOperationId:entry.id});
        throw new ReviewScanError("Verify kit contents or select Return All. Captured condition and notes are saved.");
      }
      assertCurrent();
      const ack = await wConvex.mutation(convexApi.scanIntake.commit, {
        orgId:entry.orgId,projectId:entry.projectId,expectedUserId:entry.userId,
        expectedVersionId:entry.expectedVersionId,operationId:entry.id,operation:entry.operation,raw:entry.raw,
        condition:entry.condition,notes:entry.notes,effect:entry.effect,
      });
      if (!ack.confirmed) throw new Error("Server acknowledgement missing");
      try {
        assertCurrent();
        scanFeedback.play("success",{label:entry.raw,outcome:entry.operation === "deploy" ? "Deployed — confirmed" : "Returned — confirmed"});
      } catch { /* Server acknowledgement remains true even if the displayed scope or feedback changes. */ }
    },
  );
  useEffect(() => {
    setKitConfirm(null);
    setAccessoryGate(null);
    setAccessoryVerifyConfirm(null);
    kitConfirmBacklogRef.current = [];
  }, [orgId, projectId, scanSession?.user.id, project?.liveVersionId]);
  const captureDeployScan = (raw:string) => {
    if (durableScans.capture("deploy",raw,"GOOD","")) setDeployScanValue("");
  };
  const captureReturnScan = (raw:string) => {
    if (durableScans.capture("return",raw,returnCondition as "GOOD"|"DAMAGED"|"MISSING",returnNotes)) setReturnScanValue("");
  };

  const handleDeployScanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && deployScanValue.trim()) {
        e.preventDefault();
        captureDeployScan(deployScanValue);
      }
    },
    [deployScanValue, captureDeployScan]
  );

  const handleReturnScanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && returnScanValue.trim()) {
        e.preventDefault();
        captureReturnScan(returnScanValue);
      }
    },
    [returnScanValue, captureReturnScan]
  );

  // --- Selection helpers ---
  function toggleSelection(set: Set<string>, setFn: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  }

  function toggleGroupSelection(
    set: Set<string>,
    setFn: (s: Set<string>) => void,
    keys: string[]
  ) {
    const allSelected = keys.every((k) => set.has(k));
    const next = new Set(set);
    if (allSelected) {
      keys.forEach((k) => next.delete(k));
    } else {
      keys.forEach((k) => next.add(k));
    }
    setFn(next);
  }

  function toggleAll(
    set: Set<string>,
    setFn: (s: Set<string>) => void,
    allKeys: string[]
  ) {
    const allSelected = allKeys.length > 0 && allKeys.every((k) => set.has(k));
    setFn(allSelected ? new Set() : new Set(allKeys));
  }

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- Derived data (must be before any early returns to keep hooks stable) ---
  const lineItems = project ? (project.lineItems || []) as unknown as LineItem[] : [];
  const {
    checkOutMutation, checkInMutation, kitCheckInMutation,
    kitBatchOutMutation, kitBatchInMutation, deprepMutation,
    undeployMutation, undeployKitsMutation, unreturnMutation, unreturnKitsMutation,
    undeprepMutation, clearContainerMutation,
  } = useStageMutations({ projectId, lineItems, warehouseWrites, invalidate });
  const checkFlow = useCheckQueue({
    projectId, lineItems, selectedContainer, activeContainerId, kitCheckInMutation, checkInMutation,
    clearAccessoryVerification, invalidate, closeKitConfirm,
    hasKitConfirmBacklog: () => kitConfirmBacklogRef.current.length > 0,
    setReturnNotes, scanInputRef, deployScanInputRef, returnScanInputRef,
  });
  const {
    setCheckFormData, setCheckFormOpen, startCheckQueue, startKitCheckFlow,
  } = checkFlow;
  // "Prep as custom item" (FEATUREDOCS/12): which lines are short on stock, and the
  // one-click convert / convert-back. The subscription is reactive, so no invalidate.
  const overbookedMap = useWarehouseOverbooked(orgId, projectId, lineItems);
  const [pendingCustomUnitLineIds, setPendingCustomUnitLineIds] = useState<Set<string>>(new Set());
  const runCustomUnitWrite = (lineItemId: string, write: () => Promise<unknown>, success: string, failure: string) => {
    setPendingCustomUnitLineIds((prev) => new Set(prev).add(lineItemId));
    write()
      .then(() => toast.success(success))
      .catch((e) => showError(e, { fallbackTitle: failure }))
      .finally(() =>
        setPendingCustomUnitLineIds((prev) => {
          const next = new Set(prev);
          next.delete(lineItemId);
          return next;
        }),
      );
  };
  const handleConvertToCustomUnit = (lineItemId: string) =>
    runCustomUnitWrite(
      lineItemId,
      () => warehouseWrites.convertUnitToOffInventory(projectId, lineItemId, true),
      "Prepped 1 as a custom item",
      "Couldn't convert to a custom item",
    );
  const handleConvertBackToInventory = (lineItemId: string) =>
    runCustomUnitWrite(
      lineItemId,
      () => warehouseWrites.convertUnitBackToInventory(projectId, lineItemId),
      "Converted back to inventory",
      "Couldn't convert back to inventory",
    );
  // Accessory units packed into a different container than their parent are
  // lifted out into their own lines (relocate-accessories.ts) so every stage
  // list, container section and Move-to… sees them where they physically are.
  const placed = relocateAccessories(lineItems);
  // NEW_STOCK sale items — a separate, SKU-picked checklist alongside the
  // asset-tag/scan equipment tree above (2026-08 warehouse sales-prep split).
  const saleItemsToPrep = project ? (project.saleItemsToPrep || []) as SaleItemToPrep[] : [];

  const handleToggleSalePicked = async (lineItemId: string, picked: boolean) => {
    setPendingSalePickIds((prev) => new Set(prev).add(lineItemId));
    try {
      await warehouseWrites.setSalePicked(projectId, lineItemId, picked);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update pick status");
    } finally {
      setPendingSalePickIds((prev) => {
        const next = new Set(prev);
        next.delete(lineItemId);
        return next;
      });
    }
  };

  // #1296 — `caseAssets`/`containerOptions`/`selectedContainerAsset`/
  // `ensureContainerIfNeeded` are the PRE-rail mechanism: the free-text
  // ComboboxPicker matched a typed label back to an asset here, then
  // lazily added that asset to the job the first time it was used as a
  // container. The rail's "+ New" sheet now creates a container (and its
  // line item) atomically via `projectContainersWrites.createNative`, so
  // `selectedContainer` is only ever set to a REAL container's label —
  // this lookup effectively never matches for anything created through
  // the rail. Left in place (not dead per knip — still called) rather than
  // removed here; phase 5 (narrow + retire) is where this goes.
  const { data: caseAssets } = useServerQuery({
    queryKey: ["containerAssets", orgId],
    queryFn: () => wConvex.query(convexApi.categories.containerAssetSearch, { orgId: orgId as string, query: "" }),
    enabled: !!orgId && wAuthed,
  });

  type ContainerAsset = { value: string; label: string; assetId?: string; assetTag?: string; modelId?: string };

  // Build container options from existing prepContainer values + case category assets
  const containerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: ContainerAsset[] = [];

    // Add case category assets first
    if (caseAssets) {
      for (const asset of caseAssets as ContainerAsset[]) {
        if (!seen.has(asset.value)) {
          seen.add(asset.value);
          options.push(asset);
        }
      }
    }

    // Add existing prepContainer values from line items
    for (const li of lineItems) {
      if (li.prepContainer && !seen.has(li.prepContainer)) {
        seen.add(li.prepContainer);
        options.push({ value: li.prepContainer, label: li.prepContainer });
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [lineItems, caseAssets]);

  // Look up the selected container's asset info (if it's a real asset, not custom name)
  const selectedContainerAsset = useMemo(() => {
    if (!selectedContainer) return null;
    return containerOptions.find((o) => o.value === selectedContainer && o.assetId) || null;
  }, [selectedContainer, containerOptions]);

  // Keep ref updated so mutations defined earlier can call it
  const selectedContainerAssetRef = useRef(selectedContainerAsset);
  selectedContainerAssetRef.current = selectedContainerAsset;
  const selectedContainerRef = useRef(selectedContainer);
  selectedContainerRef.current = selectedContainer;

  // Filter out kit children and container line items — they show under their parent row / auto-managed.
  // Sub-hire children (isKitChild + isSubhire) pass through as regular individual items.
  const equipmentItems = placed.items.filter((item) => {
    if (item.type !== "EQUIPMENT") return false;
    if (item.isContainerLineItem) return false;
    if (item.isKitChild && isInternalStockLine(item.subHireId)) return false; // real kit children stay hidden
    // Hide sub-hire group parent wrappers — children show individually
    if (item.subHireId != null && !item.isKitChild && !item.kitId && (item.childLineItems?.length ?? 0) > 0) return false;
    return true;
  });

  // Per-stage counts for the lifecycle stepper (Pick/prep → … → De-prepped).

  // Pick/Prep: items that need to be picked and prepped (not yet PACKED)
  // Pick/Prep, Deploy, De-prep-staging, De-prepped, and Return tab membership —
  // see isInPickPrepStage/isInPreppedStage/isInReturnedStage/isInDeprepedStage/
  // isInCheckedOutStage in warehouse-types.ts for the shared, tested logic.
  const pickPrepItems = equipmentItems.filter(isInPickPrepStage);
  // Deploy: items that are prepped (PACKED) but not yet deployed (CHECKED_OUT).
  // Returned gear is excluded — it lives in the De-prep stage, NOT back here
  // (the "to return it goes back to deploy" confusion).
  const preppedItems = equipmentItems.filter(isInPreppedStage);
  // De-prep: gear that's physically back (RETURNED) but still packed — it needs
  // return checks and putting back into inventory. Once de-prepped, prepStatus
  // resets off PACKED and it leaves this list. Mirrors the checkedOutItems shape
  // so it can flow through the same Deploy-tab rendering in "deprep" mode.
  const returnedItems = equipmentItems.filter(isInReturnedStage);
  // De-prepped: returned gear checked back into inventory (prepStatus reset off
  // PACKED). Terminal stage — a read-only confirmation list.
  const deprepedItems = equipmentItems.filter(isInDeprepedStage);

  // Keep old name for compatibility with deploy tab selection logic
  const checkOutItemsList = preppedItems;

  const checkedOutItems = equipmentItems.filter(isInCheckedOutStage);

  const groupedOut = groupItems(checkOutItemsList, "deploy", "prepped");
  // De-prep reuses the deploy grouping (same GroupEntry shape + selection keys).
  const groupedDeprep = groupItems(returnedItems, "deploy", "returned");

  // Group deploy items by container for visual sectioning — real containerId
  // preferred over the legacy prepContainer label (buildContainerGroups,
  // #1296 phase 2).
  const representativeItem = (entry: typeof groupedOut[number]) => (entry.kind === "serialized-group" ? entry.items[0] : entry.item);
  const deployContainerGroups = useMemo(
    () => buildContainerGroups(groupedOut, representativeItem, containerLabelById),
    [groupedOut, containerLabelById],
  );

  // Group de-prep items by the container they came back in (visual sectioning).
  const deprepContainerGroups = useMemo(
    () => buildContainerGroups(groupedDeprep, representativeItem, containerLabelById),
    [groupedDeprep, containerLabelById],
  );

  const groupedIn = groupCheckinItems(checkedOutItems);

  // Group return items by container for visual sectioning
  const returnContainerGroups = useMemo(
    () => buildContainerGroups(groupedIn, representativeItem, containerLabelById),
    [groupedIn, containerLabelById],
  );

  // #1296 phase 2 — Move to…: reassign a Deploy/Return/De-prep selection to a
  // different container. `moveDialogFor` names which tab's own selection Set
  // + stage predicate the dialog resolves against (they differ — a bulk
  // unit's `isRelevant` depends on which stage of its lifecycle this tab
  // shows); resolving happens once, right before opening, not on every
  // keystroke/selection change.
  const [moveDialogFor, setMoveDialogFor] = useState<"deploy" | "deprep" | "return" | null>(null);
  const containerWrites = useProjectContainerWrites();
  const [moveIsPending, setMoveIsPending] = useState(false);

  const moveDialogUnitIds = useMemo(() => {
    // Accessory keys (relocated rows, nested accessory rows) name their own
    // units; everything else resolves against `placed.items`, so a parent moves
    // only the accessories still under it.
    const resolve = (keys: Set<string>, isRelevant: Parameters<typeof resolveSelectionToUnitIds>[2]) => {
      const { rest, unitIds } = takeAccessorySelection(keys, placed, isRelevant);
      return [...new Set([...unitIds, ...resolveSelectionToUnitIds(new Set(rest), placed.items, isRelevant)])];
    };
    if (moveDialogFor === "deploy") return resolve(selectedOut, isMoveableAtDeployStage);
    if (moveDialogFor === "deprep") return resolve(selectedDeprep, isMoveableAtDeprepStage);
    if (moveDialogFor === "return") return resolve(selectedIn, isMoveableAtReturnStage);
    return [];
  }, [moveDialogFor, selectedOut, selectedDeprep, selectedIn, placed.items]);

  const handleConfirmMove = async (toContainerId: string | null) => {
    const unitIds = moveDialogUnitIds;
    const forTab = moveDialogFor;
    if (unitIds.length === 0 || !forTab) return;
    setMoveIsPending(true);
    try {
      const { moved } = await containerWrites.moveUnits(unitIds, toContainerId);
      toast.success(`Moved ${moved} item${moved === 1 ? "" : "s"}`);
      if (forTab === "deploy") setSelectedOut(new Set());
      else if (forTab === "deprep") setSelectedDeprep(new Set());
      else setSelectedIn(new Set());
      setMoveDialogFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move");
    } finally {
      setMoveIsPending(false);
    }
  };

  // Build all selectable keys for pick/prep

  // Build all selectable keys for check-out
  const allOutKeys = useMemo(() => selectionKeysForEntries(groupedOut), [groupedOut]);

  const allDeprepKeys = useMemo(() => selectionKeysForEntries(groupedDeprep), [groupedDeprep]);

  const allInKeys = useMemo(() => selectionKeysForEntries(groupedIn), [groupedIn]);

  const selectedOutCount = selectedOut.size;
  const selectedDeprepCount = selectedDeprep.size;
  const selectedInCount = selectedIn.size;

  // --- Prep selected items (for manual selection without scanner) ---
  // `withoutAccessories` packs the parents only (`includeAccessoryIds: []`);
  // their accessories stay in Pick/Prep (an accessory parent remains in the
  // stage while any child is unpacked) and a later plain Prep packs them.
  const handlePrepSelected = async (opts?: { withoutAccessories?: boolean; keys?: Iterable<string> }) => {
    const accessoryNarrow = opts?.withoutAccessories ? { includeAccessoryIds: [] as string[] } : {};
    try {
      // If prepping into a container asset, ensure it's on the project
      await ensureContainerIfNeeded();

      const items: { lineItemId: string; assetId?: string; quantity?: number }[] = [];
      const kitLineItemIds: string[] = [];
      const bulkItems: { lineItemId: string; quantity: number }[] = [];

      for (const key of opts?.keys ?? selectedPrep) {
        if (key.includes(":")) {
          // Bulk unit key from deploy tab (id:unitIndex)
          const lineItemId = key.split(":")[0];
          const existing = bulkItems.find((i) => i.lineItemId === lineItemId);
          if (existing) {
            existing.quantity += 1;
          } else {
            bulkItems.push({ lineItemId, quantity: 1 });
          }
        } else {
          const li = lineItems.find((l) => l.id === key);
          if (li && li.kitId && !li.isKitChild) {
            kitLineItemIds.push(key);
          } else {
            items.push({ lineItemId: key, assetId: li?.assetId || undefined });
          }
        }
      }

      // Check if any "bulk" items are actually multi-qty serialized (no bulkAssetId, SERIALIZED model)
      // These need asset assignment via the picker, not the bulk prep flow.
      // Discriminate on `!== "BULK"` rather than `=== "SERIALIZED"`: the Convex
      // model mirror stores assetType as OPTIONAL, so a model dual-written
      // without it reads back `undefined` here. Treating undefined as bulk sent
      // serialised lines down the generic prep path, where prepUnit flips the
      // WHOLE line to PACKED (ignoring the ticked quantity) — "prep one, all
      // four move". Prisma defaults assetType to SERIALIZED, so "not BULK" is
      // the correct, mirror-gap-proof reading for a non-bulk-asset line.
      const actualBulkItems: typeof bulkItems = [];
      for (const bi of bulkItems) {
        const li = lineItems.find((l) => l.id === bi.lineItemId);
        if (li && !li.bulkAssetId && li.model?.assetType !== "BULK" && li.modelId && isInternalStockLine(li.subHireId)) {
          // Multi-qty serialized item — needs asset picker
          items.push({ lineItemId: bi.lineItemId, quantity: bi.quantity });
        } else {
          actualBulkItems.push(bi);
        }
      }
      // Replace bulkItems with only actual bulk items
      bulkItems.length = 0;
      bulkItems.push(...actualBulkItems);

      // Check if any serialized items need asset assignment (no assetId)
      const needsAssetPicker: typeof items = [];
      const readyItems: typeof items = [];
      for (const item of items) {
        const li = lineItems.find((l) => l.id === item.lineItemId);
        // `!== "BULK"` (not `=== "SERIALIZED"`) so a mirror-omitted assetType
        // still routes to the picker rather than the whole-line prep path.
        if (li && !li.assetId && !li.bulkAssetId && li.model?.assetType !== "BULK" && li.modelId && isInternalStockLine(li.subHireId)) {
          needsAssetPicker.push(item);
        } else {
          readyItems.push(item);
        }
      }

      // If any items need asset assignment, open the picker
      if (needsAssetPicker.length > 0) {
        const pickerItems: Array<{
          lineItemId: string;
          modelId: string;
          modelName: string;
          availableAssets: AvailableAsset[];
          selectedAssetId: string;
          checkItemCount: number;
        }> = [];

        // Fetch availability for every model in the selection in ONE call, then
        // build the picker rows from the map — was one getAvailableAssetsForModel
        // round-trip per item (each itself a per-asset query loop), the felt
        // "checks take a minute to load".
        const pickerModelIds = [
          ...new Set(
            needsAssetPicker
              .map((item) => lineItems.find((l) => l.id === item.lineItemId)?.modelId)
              .filter((id): id is string => !!id),
          ),
        ];
        const availabilityByModel = await getAvailableAssetsForModels(pickerModelIds);

        for (const item of needsAssetPicker) {
          const li = lineItems.find((l) => l.id === item.lineItemId);
          if (!li?.modelId) continue;
          // Use selected quantity if specified (from bulk unit selection), else full line item quantity
          const count = item.quantity || li.quantity;
          const available = (availabilityByModel[li.modelId] ?? []) as AvailableAsset[];
          const checkItemCount = li.model?._count?.modelCheckItems || 0;
          for (let i = 0; i < count; i++) {
            pickerItems.push({
              lineItemId: li.id,
              modelId: li.modelId,
              modelName: li.model?.name || modelDisplayName(li),
              availableAssets: available,
              selectedAssetId: "",
              checkItemCount,
            });
          }
        }

        if (pickerItems.length > 0) {
          applyAssetPickerItems(pickerItems);
          setAssetPickerBulkItems(bulkItems);
          setAssetPickerOpen(true);
          setSelectedPrep(new Set());
          return;
        }
      }

      // Prep kits — check verification first, then check flow or direct prep.
      // Kits that go straight to direct prep (fully verified + no interactive check
      // flow) are collected and prepped in ONE batch call after the loop, instead
      // of firing one prepKitChildren round-trip per kit.
      const directPrepKits: Array<{ id: string; name: string }> = [];
      const unverifiedKitConfirms: KitConfirmState[] = [];
      for (const kitItemId of kitLineItemIds) {
        const li = lineItems.find((l) => l.id === kitItemId);
        if (li?.kitId) {
          const children = (li.childLineItems || []) as LineItem[];
          const allIds = collectAllVerifiableIds(children, "deploy");
          const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));

          if (allIds.length > 0 && verifiedIds.length < allIds.length) {
            // Not fully verified — prompt the user (after the rest of the selection)
            unverifiedKitConfirms.push({
              action: "deploy",
              kitName: li.kit?.name || li.description || "Kit",
              kitId: li.kitId,
              parentLineItemId: li.id,
              verifiedCount: verifiedIds.length,
              totalCount: allIds.length,
              verifiedIds,
            });
            continue;
          }

          // Fully verified (or no verifiable items) — proceed
          const started = startKitCheckFlow(li.kitId, li, "PREP");
          if (!started) {
            directPrepKits.push({ id: li.id, name: li.description || li.kit?.name || "Kit" });
          }
        }
      }
      if (directPrepKits.length > 0) {
        prepKitsBatch(projectId, directPrepKits.map((k) => k.id))
          .then((res) => {
            const ok = res.succeeded.length;
            const failed = res.errors.length;
            if (ok > 0) {
              toast.success(ok === 1 ? `Kit prepped: ${directPrepKits[0].name}` : `Prepped ${ok} kits`);
            }
            if (failed > 0) {
              toast.error(`${failed} kit${failed === 1 ? "" : "s"} skipped`);
            }
            invalidate();
          })
          .catch((e) => showError(e, { fallbackTitle: "Failed to prep kit" }));
      }

      // Build check queue for bulk items with checks, and prep directly for those without
      // For bulk items, only ONE check is needed per item (not per unit) — the check
      // Bulk items: 1 check queue entry per unit (same as serialized).
      // Each unit gets its own check dialog and is split into its own line item.
      const bulkCheckQueue: CheckQueueItem[] = [];
      const bulkNoCheckItems: typeof bulkItems = [];
      for (const bi of bulkItems) {
        const li = lineItems.find((l) => l.id === bi.lineItemId);
        const hasChecks = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) });
        if (hasChecks && li?.modelId) {
          for (let i = 0; i < bi.quantity; i++) {
            bulkCheckQueue.push({
              context: "PREP" as const,
              modelId: li.modelId!,
              assetTag: li.bulkAsset?.assetTag || "",
              assetName: `${modelDisplayName(li)} — Unit ${i + 1}`,
              lineItemId: li.id,
              assetId: "",
              bulkAssetId: li.bulkAssetId || undefined,
            });
          }
        } else {
          bulkNoCheckItems.push(bi);
        }
      }

      // Accumulate every no-check prep (bulk units + ready serialised) into one
      // batch call fired below. Send ONE entry per bulk line carrying the full
      // selected quantity — the bulk unit tracks total packed quantity (prepUnit
      // accumulates, capped at the ordered quantity). The old per-unit qty-1 expansion
      // is what collapsed the bulk unit to quantity 1 ("16 on the job, shows 1").
      const directPrepItems: Array<{
        lineItemId: string;
        assetId?: string;
        quantity?: number;
        prepContainer?: string | null;
        containerId?: string | null;
        includeAccessoryIds?: string[];
      }> = [];
      for (const bi of bulkNoCheckItems) {
        directPrepItems.push({
          lineItemId: bi.lineItemId,
          quantity: bi.quantity,
          prepContainer: selectedContainer || null,
          ...containerArgs(activeContainerId),
        });
      }

      // Build check queue for ready items with checks
      const readyCheckQueue: CheckQueueItem[] = [];
      const readyNoCheckItems: typeof readyItems = [];
      for (const item of readyItems) {
        const li = lineItems.find((l) => l.id === item.lineItemId);
        const hasChecks = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) });
        if (hasChecks && li?.modelId) {
          readyCheckQueue.push({
            context: "PREP" as const,
            modelId: li.modelId,
            assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "",
            assetName: li.model?.name || modelDisplayName(li),
            lineItemId: item.lineItemId,
            assetId: li.assetId || "",
            bulkAssetId: li.bulkAssetId || undefined,
            ...accessoryNarrow,
          });
        } else {
          readyNoCheckItems.push(item);
        }
      }

      // Ready items without checks join the same batch (after the bulk units, so
      // per-line ordering is unchanged from the old two-loop sequence).
      for (const item of readyNoCheckItems) {
        directPrepItems.push({
          lineItemId: item.lineItemId,
          assetId: item.assetId,
          quantity: item.quantity,
          prepContainer: selectedContainer || null,
          ...containerArgs(activeContainerId),
          ...accessoryNarrow,
        });
      }
      if (directPrepItems.length > 0) {
        await prepItemsBatch(projectId, directPrepItems);
        clearAccessoryVerification(directPrepItems.map((i) => i.lineItemId));
      }

      // Start check queue if any items need checks
      const allChecks = [...readyCheckQueue, ...bulkCheckQueue];
      if (unverifiedKitConfirms.length > 0) {
        kitConfirmBacklogRef.current.push(...unverifiedKitConfirms);
        // No check form pending → open now; otherwise finishCheckQueue opens it.
        if (allChecks.length === 0) closeKitConfirm();
      }
      if (allChecks.length > 0) {
        // Don't include already-prepped items in directItems — they were prepped above
        startCheckQueue(allChecks);
      } else if (kitLineItemIds.length === 0 && (readyNoCheckItems.length > 0 || bulkNoCheckItems.length > 0)) {
        toast.success(`Prepped ${readyNoCheckItems.length + bulkNoCheckItems.length} items`);
      }

      setSelectedPrep(new Set());
      invalidate();
    } catch (e) {
      showError(e, { fallbackTitle: "Prep failed" });
      invalidate();
    }
  };

  // --- Checkout / Checkin selected ---
  // A single accessory child's classification for the Deploy gate below — null
  // when it's not "missing" (already deployed/cancelled, or already packed).
  function missingAccessoryRow(li: LineItem, c: LineItem): { parentLineItemId: string; parentName: string; accessoryLineItemId: string; accessoryName: string; isOptional: boolean } | null {
    if (c.status === "CANCELLED" || c.status === "CHECKED_OUT" || c.prepStatus === "PACKED") return null;
    return {
      parentLineItemId: li.id,
      parentName: modelDisplayName(li),
      accessoryLineItemId: c.id,
      accessoryName: c.model?.name || c.description || "Accessory",
      isOptional: c.accessoryInclusion === "OPTIONAL",
    };
  }

  // For each about-to-deploy parent line, find its ACCESSORY children that
  // aren't packed yet — "missing" in the sense that deploying now leaves them
  // behind. DEFAULT-tier misses soft-block Deploy; OPTIONAL-tier misses just
  // need a reason (issue #794 follow-up).
  function computeMissingAccessories(parentLineItemIds: string[]) {
    const missingDefaults: Array<{ parentLineItemId: string; parentName: string; accessoryLineItemId: string; accessoryName: string }> = [];
    const missingOptionals: Array<{ parentLineItemId: string; parentName: string; accessoryLineItemId: string; accessoryName: string }> = [];
    for (const id of parentLineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (!li) continue;
      for (const c of accessoryChildrenOf(li)) {
        const row = missingAccessoryRow(li, c);
        if (!row) continue;
        const { isOptional, ...rest } = row;
        (isOptional ? missingOptionals : missingDefaults).push(rest);
      }
    }
    return { missingDefaults, missingOptionals };
  }

  // Deploy selected prepped items (no checks needed — items are already prepped)
  function runCheckOut(items: Array<{ lineItemId: string; assetId?: string; quantity?: number; includeAccessoryIds?: string[] }>) {
    checkOutMutation
      // Accessories always cascade with their parent (they're permanently
      // attached) — there's no longer a warehouse toggle for it, except for
      // the per-item includeAccessoryIds narrowing an item may carry (the
      // "Deploy Verified Only" partial-action escape hatch below).
      .mutateAsync({ items, includeAccessories: true })
      .then(() => toast.success(`Deployed ${items.length} item${items.length === 1 ? "" : "s"}`))
      .catch(() => {});
  }

  // Kit-style partial-verification check for the actual Deploy action (issue
  // #794's remaining acceptance criterion): find the first accessory parent
  // in the batch whose PACKED accessories are only partly click-to-verified.
  // Fully-verified, fully-unverified, and accessory-free parents all pass
  // through untouched — only a genuine partial split needs a choice.
  // `verifiedKitItems` tracks accessory CHILD LINE ids (the same convention
  // KitChildRows uses), but the checkout mutation's `includeAccessoryIds`
  // narrows by accessory ASSET/BULK-ASSET identity — the two are translated
  // here so the caller never has to know about the mismatch.
  function findPartiallyVerifiedAccessoryParent(parentLineItemIds: string[]) {
    for (const id of parentLineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (!li || !isAccessoryParent(li)) continue;
      const packed = accessoryChildrenOf(li).filter(
        (c) => c.status !== "CANCELLED" && c.status !== "CHECKED_OUT" && c.prepStatus === "PACKED",
      );
      if (packed.length === 0) continue;
      const verified = packed.filter((c) => verifiedKitItems.has(c.id));
      if (verified.length > 0 && verified.length < packed.length) {
        const verifiedAccessoryIds = accessoryAssetIds(verified);
        return { li, verifiedCount: verified.length, totalCount: packed.length, verifiedAccessoryIds };
      }
    }
    return null;
  }

  // #1296 D4 — "Deploy container": select every one of the container's
  // entries so the EXISTING Deploy button (already wired, already tested)
  // becomes the trigger — never a second deploy code path alongside
  // handleCheckOutSelected's own accessory-gate/kit-batch/partial-verify
  // branching below.
  const handleDeployContainer = (entries: GroupEntry[]) => {
    setSelectedOut(new Set(keysForGroupEntries(entries)));
  };

  // Click-to-verify state lives in `verifiedKitItems` and is shared with Deploy.
  // Verification done while picking must not pre-tick the Deploy checks, so a
  // successful prep clears the prepped lines' accessory ids; Deploy then starts
  // from a clean slate.
  function clearAccessoryVerification(lineItemIds: string[]) {
    const toClear = new Set<string>();
    for (const id of lineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (li) accessoryChildrenOf(li).forEach((c) => toClear.add(c.id));
    }
    if (toClear.size === 0) return;
    setVerifiedKitItems((prev) => {
      if (![...toClear].some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      toClear.forEach((id) => next.delete(id));
      return next;
    });
  }

  // The ONE accessory gate for every deploy entry point (selection Deploy and
  // scan-deploy): DEFAULT/OPTIONAL accessories left unpacked open the
  // missing-accessory dialog; a partly click-verified accessory set opens the
  // "Deploy Verified Only" confirm (after deploying the rest of the batch).
  // Returns true when a dialog took over and the caller must NOT deploy `items`
  // itself. Bulk keys (quantity>1 parents) are gated too — every line id in
  // `items`, not just the serialized ones.
  function openAccessoryGateIfNeeded(
    items: Array<{ lineItemId: string; assetId?: string; quantity?: number; includeAccessoryIds?: string[] }>,
    durableOperationId?: string,
  ): boolean {
    const lineIds = items.map((i) => i.lineItemId);
    const { missingDefaults, missingOptionals } = computeMissingAccessories(lineIds);
    if (missingDefaults.length > 0 || missingOptionals.length > 0) {
      setDefaultOverrideReason(isManagerTier ? "Manager override — deployed without full verification" : "");
      setOptionalSkipReasons({});
      setAccessoryGate({ durableOperationId, pendingCheckOutItems: items, missingDefaults, missingOptionals });
      return true;
    }

    const partial = findPartiallyVerifiedAccessoryParent(lineIds);
    if (partial) {
      const rest = items.filter((i) => i.lineItemId !== partial.li.id);
      if (rest.length > 0) runCheckOut(rest);
      setAccessoryVerifyConfirm({
        durableOperationId,
        parentLineItemId: partial.li.id,
        parentAssetId: partial.li.assetId || undefined,
        parentName: modelDisplayName(partial.li),
        verifiedCount: partial.verifiedCount,
        totalCount: partial.totalCount,
        verifiedAccessoryIds: partial.verifiedAccessoryIds,
      });
      return true;
    }
    return false;
  }

  const handleCheckOutSelected = async () => {
    const outKeys = takeAccessoryStage(selectedOut, "DEPLOY", isMoveableAtDeployStage);
    if (outKeys.length !== selectedOut.size) setSelectedOut(new Set(outKeys));
    const bulkQtyMap = new Map<string, number>();
    const serializedLineItemIds: string[] = [];
    const kitLineItemIds: string[] = [];

    for (const key of outKeys) {
      if (key.includes(":")) {
        const lineItemId = key.split(":")[0];
        bulkQtyMap.set(lineItemId, (bulkQtyMap.get(lineItemId) || 0) + 1);
      } else {
        const li = lineItems.find((l) => l.id === key);
        if (li && li.kitId && !li.isKitChild) {
          kitLineItemIds.push(key);
        } else {
          serializedLineItemIds.push(key);
        }
      }
    }

    // Deploy kits directly — one batch call for all selected kits.
    const kitIdsToDeploy = kitLineItemIds
      .map((kitItemId) => lineItems.find((l) => l.id === kitItemId)?.kitId)
      .filter((id): id is string => !!id);
    if (kitIdsToDeploy.length > 0) {
      kitBatchOutMutation.mutate(kitIdsToDeploy);
    }

    if (serializedLineItemIds.length === 0 && bulkQtyMap.size === 0) return;

    const items = [
      ...serializedLineItemIds.map((id) => {
        const li = lineItems.find((l) => l.id === id);
        return { lineItemId: id, assetId: li?.assetId || undefined };
      }),
      ...Array.from(bulkQtyMap.entries()).map(([lineItemId, qty]) => ({
        lineItemId,
        quantity: qty,
      })),
    ];

    if (items.length === 0) return;

    if (openAccessoryGateIfNeeded(items)) return;

    runCheckOut(items);
  };

  const confirmAccessoryGate = async () => {
    if (!accessoryGate) return;
    const { pendingCheckOutItems, missingDefaults, missingOptionals } = accessoryGate;

    const skipped: Array<{ accessoryLineItemId: string; tier: "DEFAULT" | "OPTIONAL"; reason: string }> = [
      ...missingDefaults.map((d) => ({
        accessoryLineItemId: d.accessoryLineItemId,
        tier: "DEFAULT" as const,
        reason: defaultOverrideReason.trim(),
      })),
      ...missingOptionals.map((o) => {
        const entry = optionalSkipReasons[o.accessoryLineItemId];
        const preset = entry?.preset || "Not needed for this job";
        const note = entry?.note?.trim();
        return {
          accessoryLineItemId: o.accessoryLineItemId,
          tier: "OPTIONAL" as const,
          reason: note ? `${preset} — ${note}` : preset,
        };
      }),
    ];

    const parentName = missingDefaults[0]?.parentName ?? missingOptionals[0]?.parentName ?? "line item";
    if (!accessoryGate.durableOperationId) try {
      await warehouseWrites.logAccessoryCheckoutOverride(projectId, parentName, skipped);
    } catch {
      // Never let the audit trail write block the actual deploy.
    }

    // Narrow each pending parent's accessory cascade to exclude the accessories
    // just declared missing — the override records WHY they're being left
    // behind, it must not also silently deploy them anyway (issue #794: this
    // gate previously logged the reason but still checked out the "missing"
    // accessory since `includeAccessoryIds` was never set on the resend).
    const skippedLineIds = new Set(skipped.map((s) => s.accessoryLineItemId));
    const narrowedItems = pendingCheckOutItems.map((item) => {
      const li = lineItems.find((l) => l.id === item.lineItemId);
      if (!li) return item;
      const allAccessories = accessoryChildrenOf(li);
      const eligible = allAccessories.filter((c) => !skippedLineIds.has(c.id));
      if (eligible.length === allAccessories.length) return item; // nothing skipped for this parent
      const includeAccessoryIds = accessoryAssetIds(eligible);
      return { ...item, includeAccessoryIds };
    });

    setAccessoryGate(null);
    setDefaultOverrideReason("");
    setOptionalSkipReasons({});
    if (accessoryGate.durableOperationId) {
      const item = narrowedItems[0];
      durableScans.review(accessoryGate.durableOperationId,{lineItemId:item.lineItemId,assetId:item.assetId,accessoryDecision:"override",includeAccessoryIds:item.includeAccessoryIds,skippedAccessories:skipped});
    } else runCheckOut(narrowedItems);
  };

  // De-prep selected returned items: run return checks where the model has them,
  // otherwise deprep straight back into inventory. Drives the De-prep tab.
  const handleDeprep = (ids: Set<string>) => {
    if (ids.size === 0) return;
    // "Move to Pick" (packed and waiting) and "Deprep" (returned) share this
    // handler; the server's DEPREP does the right one for each unit's own stage.
    const rest = takeAccessoryStage(ids, "DEPREP", (u) => isMoveableAtDeployStage(u) || isMoveableAtDeprepStage(u));
    const bulkDeprepMap = new Map<string, number>();
    const directIds: string[] = [];
    rest.forEach((id) => {
      if (id.includes(":")) {
        const lineItemId = id.split(":")[0];
        bulkDeprepMap.set(lineItemId, (bulkDeprepMap.get(lineItemId) || 0) + 1);
      } else {
        directIds.push(id);
      }
    });

    // Build a RETURN check queue for returned items that have check items on their model.
    // Items that were never deployed (outbound deprep) or have no check items bypass this
    // entirely. Damaged items (prepStatus FLAGGED_FAULTY) also skip the second check.
    const checkQueueBuild: CheckQueueItem[] = [];
    const directDeprep: Array<{ lineItemId: string; quantity?: number; isKit?: boolean }> = [];

    for (const [lineItemId, count] of bulkDeprepMap) {
      const li = lineItems.find((l) => l.id === lineItemId);
      const needsCheck =
        li?.status === "RETURNED" &&
        li.prepStatus === "PACKED" &&
        transitionNeedsCheck("RETURN", { hasCheckItems: lineHasModelChecks(li), fromDeprep: true }) &&
        !!li.modelId;
      if (needsCheck && li) {
        for (let i = 0; i < count; i++) {
          checkQueueBuild.push({
            context: "RETURN",
            modelId: li.modelId!,
            assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "",
            assetName: `${modelDisplayName(li)}${count > 1 ? ` #${i + 1}` : ""}`,
            lineItemId,
            assetId: li.assetId || "",
            bulkAssetId: li.bulkAssetId || undefined,
            fromDeprep: true,
          });
        }
      } else {
        directDeprep.push({ lineItemId, quantity: count });
      }
    }

    for (const id of directIds) {
      const li = lineItems.find((l) => l.id === id);
      if (li && isKitParent(li)) {
        // Kit deprep with checks: respects KIT_LEVEL / PER_ITEM via startKitCheckFlow
        if (li.status === "RETURNED" && startKitCheckFlow(li.kitId!, li, "RETURN", "GOOD", true)) {
          continue;
        }
        directDeprep.push({ lineItemId: id, isKit: true });
      } else {
        const needsCheck =
          li?.status === "RETURNED" &&
          li.prepStatus === "PACKED" &&
          transitionNeedsCheck("RETURN", { hasCheckItems: lineHasModelChecks(li), fromDeprep: true }) &&
          !!li.modelId;
        if (needsCheck && li) {
          checkQueueBuild.push({
            context: "RETURN",
            modelId: li.modelId!,
            assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "",
            assetName: modelDisplayName(li),
            lineItemId: id,
            assetId: li.assetId || "",
            bulkAssetId: li.bulkAssetId || undefined,
            fromDeprep: true,
          });
        } else {
          directDeprep.push({ lineItemId: id });
        }
      }
    }

    // Fire direct deprep for items + kits without checks in one batch call
    // (was one round-trip per selected item/kit). Ops keep their array order so
    // any shared-lineItemId sequencing is preserved server-side.
    if (directDeprep.length > 0) {
      deprepMutation.mutate(
        directDeprep.map((d) => ({
          lineItemId: d.lineItemId,
          quantity: d.quantity,
          isKit: d.isKit,
        })),
      );
    }

    // Start check queue for items that need it
    if (checkQueueBuild.length > 0) {
      startCheckQueue(checkQueueBuild);
    }

    setSelectedDeprep(new Set());
    setSelectedOut(new Set());
  };

  /**
   * Scan a tag in the Assign-assets dialog: fill the next slot that can take it.
   *
   * Eleven identical headsets means eleven dropdowns; a packer holding the gear
   * already knows which unit they picked up. All four outcomes come from the
   * pure `resolvePickerScan` (tested in `asset-picker-scan.test.ts`) — this only
   * applies the result and plays the matching feedback.
   */
  const handleAssetPickerScan = (rawTag: string) => {
    const result = resolvePickerScan(assetPickerItemsRef.current, rawTag);
    setAssetPickerScanValue("");

    switch (result.kind) {
      case "assigned":
        applyAssetPickerItems((prev) =>
          prev.map((item, i) => (i === result.index ? { ...item, selectedAssetId: result.assetId } : item))
        );
        scanFeedback.play("success", {
          label: `${result.modelName} · ${result.assetTag}`,
          outcome: `Assigned #${result.index + 1}`,
        });
        return;
      case "already-assigned":
        // Not a failure — the operator is checking whether it registered.
        scanFeedback.play("exception", {
          label: result.assetTag,
          outcome: `Already assigned to #${result.index + 1}`,
        });
        toast.info(`${result.assetTag} is already assigned to ${result.modelName} #${result.index + 1}`);
        return;
      case "no-slot":
        scanFeedback.play("exception", { label: result.assetTag, outcome: "No slot left" });
        toast.warning(`Every ${result.modelName} slot is already filled`);
        return;
      case "unknown":
        scanFeedback.play("error", { label: result.assetTag || "Unknown tag", outcome: "Not available here" });
        toast.error(`${result.assetTag || "That tag"} isn't an available asset for this prep`);
        return;
    }
  };

  const handleAssetPickerConfirm = () => {
    const incomplete = assetPickerItems.find((i) => !i.selectedAssetId);
    if (incomplete) {
      toast.error("Please select an asset for each item");
      return;
    }

    const selectedIds = assetPickerItems.map((i) => i.selectedAssetId);
    if (new Set(selectedIds).size !== selectedIds.length) {
      toast.error("Each item must have a different asset assigned");
      return;
    }

    setAssetPickerOpen(false);

    // Build check queue for items with checks; prep directly for items without checks
    const allPickedItems = assetPickerItems.map((i) => {
      const li = lineItems.find((l) => l.id === i.lineItemId);
      return { ...i, li, assetId: i.selectedAssetId };
    });
    const serializedWithChecks = allPickedItems.filter(
      (i) => i.checkItemCount > 0 && i.modelId
    );

    const bulkCheckQueue: CheckQueueItem[] = [];
    const bulkNoChecks: typeof assetPickerBulkItems = [];
    for (const bi of assetPickerBulkItems) {
      const li = lineItems.find((l) => l.id === bi.lineItemId);
      if (li && transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(li) }) && li.modelId) {
        for (let i = 0; i < bi.quantity; i++) {
          bulkCheckQueue.push({
            context: "PREP" as const,
            modelId: li.modelId!,
            assetTag: li.bulkAsset?.assetTag || "",
            assetName: modelDisplayName(li),
            lineItemId: li.id,
            assetId: "",
            bulkAssetId: li.bulkAssetId || undefined,
          });
        }
      } else {
        bulkNoChecks.push(bi);
      }
    }

    // Items without checks go through prepItemDirect. Accessories are no
    // longer a prep-time toggle (issue #794 follow-up) — they pack in full,
    // like a kit's members, and checkout gating decides what's missing.
    const withoutChecks: Array<{
      lineItemId: string;
      assetId?: string;
      quantity?: number;
    }> = [
      ...allPickedItems.filter(
        (i) => !i.checkItemCount || i.checkItemCount === 0 || !i.modelId
      ).map((i) => ({
        lineItemId: i.lineItemId,
        assetId: i.assetId,
      })),
      ...bulkNoChecks.map((bi) => ({ lineItemId: bi.lineItemId, quantity: bi.quantity })),
    ];

    const allWithChecks: CheckQueueItem[] = [
      ...serializedWithChecks.map((i) => {
        const selectedAsset = i.availableAssets.find((a) => a.id === i.assetId);
        return {
          context: "PREP" as const,
          modelId: i.li!.modelId!,
          assetTag: selectedAsset?.assetTag || i.li?.asset?.assetTag || "",
          assetName: modelDisplayName(i.li!),
          lineItemId: i.lineItemId,
          assetId: i.assetId || "",
          bulkAssetId: i.li?.bulkAssetId || undefined,
        };
      }),
      ...bulkCheckQueue,
    ];

    if (allWithChecks.length > 0) {
      startCheckQueue(allWithChecks, withoutChecks);
      return;
    }

    // No checks needed — prep all items in one batch. The server applies them in
    // array order, so lines that appear multiple times (shared lineItemId, each
    // splitting/decrementing the original's quantity) stay correctly sequenced.
    prepItemsBatch(
      projectId,
      withoutChecks.map((i) => ({
        lineItemId: i.lineItemId,
        assetId: i.assetId,
        quantity: i.quantity,
        prepContainer: selectedContainer || null,
        ...containerArgs(activeContainerId),
      })),
    )
      .then(() => {
        clearAccessoryVerification(withoutChecks.map((i) => i.lineItemId));
        toast.success("Items prepped — ready to deploy");
        invalidate();
      })
      .catch((e) => showError(e));
  };

  // Pack ONLY the accessories of already-prepped parents. The parent is not
  // re-prepped, and the active container applies to the accessories alone — so
  // batteries can go in the battery box while the beltpacks sit in the pelican.
  // `where`: "active" packs into the active case; "parent" into each parent's own case.
  const handlePrepAccessoriesOnly = async (keys?: Iterable<string>, where: "active" | "parent" = "active") => {
    try {
      await ensureContainerIfNeeded();
      const items: Array<{ lineItemId: string; assetId: string; prepContainer: string | null; containerId?: ContainerChoice; accessoriesOnly: true }> = [];
      const seen = new Set<string>();
      for (const key of keys ?? selectedPrep) {
        const li = lineItems.find((l) => l.id === key.split(":")[0]);
        if (!li || !isAccessoryParent(li) || seen.has(li.id)) continue;
        seen.add(li.id);
        // One entry per packed parent asset — a multi-quantity line has no
        // line-level asset, so its accessories are packed per unit.
        for (const assetId of packedParentAssetIds(li)) {
          const choice: ContainerChoice = where === "parent" ? resolveItemContainerId(li) : activeContainerId;
          items.push({ lineItemId: li.id, assetId, prepContainer: where === "parent" ? null : selectedContainer || null, ...containerArgs(choice), accessoriesOnly: true });
        }
      }
      if (items.length === 0) {
        toast.error("Select prepped items that have accessories");
        return;
      }
      await prepItemsBatch(projectId, items);
      clearAccessoryVerification(items.map((i) => i.lineItemId));
      setSelectedPrep(new Set());
      toast.success("Accessories prepped");
      invalidate();
    } catch (e) {
      showError(e, { fallbackTitle: "Accessory prep failed" });
      invalidate();
    }
  };

  const handleReturnSelected = () => {
    const inKeys = takeAccessoryStage(selectedIn, "RETURN", isMoveableAtReturnStage, returnCondition as "GOOD" | "DAMAGED" | "MISSING");
    if (inKeys.length !== selectedIn.size) setSelectedIn(new Set(inKeys));
    const qtyMap = new Map<string, number>();
    const kitIds: string[] = [];

    for (const key of inKeys) {
      const lineItemId = key.includes(":") ? key.split(":")[0] : key;
      const li = lineItems.find((l) => l.id === lineItemId);
      if (li && li.kitId && !li.isKitChild) {
        if (li.kitId) kitIds.push(li.kitId);
      } else {
        qtyMap.set(lineItemId, (qtyMap.get(lineItemId) || 0) + 1);
      }
    }

    // Return kits (including prep-kits) — check verification first. Kits that
    // pass the gates (verified + no check flow) are collected and returned in
    // one batch call after the loop; gated kits stay on their interactive paths.
    const readyKitReturns: Array<{ kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }> = [];
    for (const kitId of kitIds) {
      const kitLi = lineItems.find((l) => l.kitId === kitId && !l.isKitChild);
      if (kitLi) {
        const children = (kitLi.childLineItems || []) as LineItem[];
        const allIds = collectAllVerifiableIds(children, "return");
        const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));
        if (allIds.length > 0 && verifiedIds.length < allIds.length) {
          setKitConfirm({
            action: "return",
            kitName: kitLi.description || kitLi.kit?.name || "Kit",
            kitId,
            parentLineItemId: kitLi.id,
            verifiedCount: verifiedIds.length,
            totalCount: allIds.length,
            verifiedIds,
          });
          continue;
        }
      }
      // Try kit check flow first
      const kitLiForCheck = lineItems.find((l) => l.kitId === kitId && !l.isKitChild);
      const rc = returnCondition as "GOOD" | "DAMAGED" | "MISSING";
      const started = kitLiForCheck ? startKitCheckFlow(kitId, kitLiForCheck, "RETURN", rc) : false;
      if (!started) {
        readyKitReturns.push({ kitId, returnCondition: rc });
      }
    }
    if (readyKitReturns.length > 0) {
      kitBatchInMutation.mutate(readyKitReturns);
    }

    // Return non-kit items
    const items = Array.from(qtyMap.entries()).map(([lineItemId, qty]) => ({
      lineItemId,
      assetId: lineItems.find((l) => l.id === lineItemId)?.assetId || undefined,
      returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
      quantity: qty,
      notes: returnNotes || undefined,
    }));
    if (items.length > 0) {
      // Build check queue for items with check items
      const returnLineItems = items.map((item) => {
        const li = lineItems.find((l) => l.id === item.lineItemId);
        return { item, li };
      });

      // Expand items with checks: bulk items with qty > 1 get one queue entry per unit
      const queue: CheckQueueItem[] = [];
      const withoutCheckItems: typeof items = [];

      for (const { item, li } of returnLineItems) {
        // Batch "Return Selected" is a return-scan (truck-in) → no check (de-prep only).
        const hasChecks =
          transitionNeedsCheck("RETURN", { hasCheckItems: lineHasModelChecks(li), fromDeprep: false }) &&
          li?.modelId;
        if (hasChecks) {
          const isBulk = !!li.bulkAssetId || (!li.assetId && li.quantity > 1);
          const count = isBulk ? item.quantity : 1;
          for (let i = 0; i < count; i++) {
            queue.push({
              context: "RETURN" as const,
              modelId: li.modelId!,
              assetTag: li.asset?.assetTag || li.bulkAsset?.assetTag || "",
              assetName: modelDisplayName(li),
              lineItemId: item.lineItemId,
              assetId: li.assetId || "",
              bulkAssetId: li.bulkAssetId || undefined,
            });
          }
        } else {
          withoutCheckItems.push(item);
        }
      }

      if (queue.length > 0) {
        startCheckQueue(
          queue,
          withoutCheckItems.map((i) => ({ lineItemId: i.lineItemId, assetId: i.assetId, returnCondition: i.returnCondition, quantity: i.quantity, notes: i.notes }))
        );
        setReturnNotes("");
        return;
      }

      checkInMutation
        .mutateAsync({ items })
        .then(() => { toast.success(`Returned items`); setReturnNotes(""); })
        .catch(() => {});
    } else if (kitIds.length > 0) {
      setReturnNotes("");
    }
  };

  // --- To pick stage (spec §9.2): job table + selection + the one scan pipeline ---
  const pickSections: JobSection[] = buildJobSections(equipmentItems, {
    stage: "pick",
    containerLabelById,
    categoryOf: (li) => (li.model as { category?: { name?: string } | null } | null)?.category?.name ?? "Equipment",
    shortById: new Map(Object.entries(overbookedMap).map(([id, o]) => [id, o.overBy])),
  });
  const pickSelection = useRowSelection(jobRowIds(pickSections));
  // The live `prepActionAvailability` gate, kept: parent verbs never see a packed parent, accessory verbs only do.
  const prepAndClear = (kind: "parents" | "accessories", run: (keys: string[]) => unknown) => {
    void run(keysForRowIds(lineItems, prepRowIds(lineItems, pickSelection.selected, kind), "pick"));
    pickSelection.clear();
  };
  const pickPrepHandlers: PrepHandlers = {
    withAccessories: () => prepAndClear("parents", (keys) => handlePrepSelected({ keys })),
    parentOnly: () => prepAndClear("parents", (keys) => handlePrepSelected({ keys, withoutAccessories: true })),
    accessoriesWithParent: () => prepAndClear("accessories", (keys) => handlePrepAccessoriesOnly(keys, "parent")),
    accessoriesIntoActive: () => prepAndClear("accessories", (keys) => handlePrepAccessoriesOnly(keys, "active")),
    choose: () => {
      const first = lineItems.find((l) => pickSelection.selected.has(l.id) && scanAccessoryOptions(l).length > 0);
      if (first) void routeScanPrep({ lineItemId: first.id, assetId: first.assetId });
      pickSelection.clear();
    },
    unpackParent: () => {
      const packed = lineItems.filter((l) => pickSelection.selected.has(l.id) && parentAlreadyPrepped(l)).map((l) => l.id);
      handleDeprep(new Set(keysForRowIds(lineItems, packed, "prepped")));
      pickSelection.clear();
    },
  };
  const pickScan = useWarehouseScan({
    stage: "pick",
    mode: dockMode === "check" ? "check" : "prep",
    lookup: (raw) => lookupAssetForScan(projectId, raw, "checkout") as Promise<ScanLookup>,
    context: () => ({
      containersByTag: new Map(realContainers.filter((c) => c.tag).map((c) => [c.tag as string, { id: c.id, label: c.label }])),
      batchKeys: new Set(scanBatch.map((b) => `${b.lineItemId}:${b.assetId}`)),
      kitOnJob: (kitId) => lineItems.some((l) => l.kitId === kitId && !l.isKitChild),
    }),
    setCase: handleSelectContainer,
    verifyKitMember: (p) => {
      const kitLi = lineItems.find((l) => l.kitId === p.kitId && !l.isKitChild);
      if (!kitLi) return;
      const children = (kitLi.childLineItems || []) as LineItem[];
      const childLi = children.find((c) => c.assetId === p.assetId)
        || children.flatMap((c) => (c.childLineItems || []) as LineItem[]).find((c) => c.assetId === p.assetId);
      if (childLi) setVerifiedKitItems((prev) => new Set(prev).add(childLi.id));
      setExpandedGroups((prev) => new Set(prev).add(`kit-${kitLi.id}`));
    },
    actKit: async (p) => {
      const kitLi = lineItems.find((l) => l.kitId === p.kitId && !l.isKitChild);
      const allIds = collectAllVerifiableIds(kitLi ? ((kitLi.childLineItems || []) as LineItem[]) : [], "deploy");
      const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));
      if (allIds.length > 0 && verifiedIds.length < allIds.length) {
        setKitConfirm({
          action: "deploy", kitName: p.name, kitId: p.kitId, parentLineItemId: kitLi?.id || p.lineItemId,
          verifiedCount: verifiedIds.length, totalCount: allIds.length, verifiedIds,
        });
        return { text: `${p.name}: confirm unverified items`, tone: "warning" };
      }
      if (kitLi && startKitCheckFlow(p.kitId, kitLi, "PREP")) return { text: `${p.name}: prep check to run`, tone: "warning" };
      if (kitLi) await prepKitChildren(projectId, kitLi.id);
      invalidate();
      return { text: `Kit prepped: ${p.name}` };
    },
    act: (p) => routeScanPrep({ lineItemId: p.lineItemId, assetId: p.assetId, assetName: p.name }),
    describe: (p) => ({ text: `${p.name}: on this job (check only, nothing prepped)`, tone: "neutral" }),
    addAndAct: async (offer) => {
      setAddPromptData({ assetName: offer.name, modelId: offer.modelId, assetId: offer.assetId, bulkAssetId: offer.bulkAssetId, isBulk: offer.isBulk });
      setAddPromptOpen(true);
      return { text: `Confirm adding ${offer.name} to this job`, tone: "neutral" };
    },
    isOffline: () => typeof navigator !== "undefined" && !navigator.onLine,
    play: (kind) => scanFeedback.play(kind),
  });
  const NEW_CASE = "__new-case";
  const caseTarget = {
    verb: "Prep",
    current: activeContainerId ? { id: activeContainerId, label: containerLabelById.get(activeContainerId) ?? "Case" } : { id: "", label: "Loose" },
    options: [{ id: "", label: "Loose" }, ...realContainers.map((c) => ({ id: c.id, label: c.label })), { id: NEW_CASE, label: "New case…" }],
    onChange: (id: string) => (id === NEW_CASE ? setNewContainerSheetOpen(true) : handleSelectContainer(id || null)),
  };

  // --- Header (spec §5.9): the page computes the strings, warehouseHeaderProps shapes them ---
  // Packer facts come only from data this page already has: the job's start (when gear leaves). No truck or
  // packer fact is fed: there is no source for either on the project summary, so they are omitted, not invented.
  const jobStart = project ? projectScheduleRows(project)[0] : undefined;
  const baseHeader = warehouseHeaderProps({
    loadsOut: jobStart?.date ? `${formatDateDayMonth(jobStart.date)}${jobStart.time ? ` ${jobStart.time}` : ""}` : undefined,
    name: project?.name ?? "",
    status: project?.status ?? "",
    statusLabel: statusLabels[project?.status] || project?.status || "",
    openDocument: (type) => window.open(`/api/documents/${projectId}?type=${type}`, "_blank"),
    hasContainers: realContainers.length > 0,
    onViewProject: () => router.push(`/projects/${projectId}`),
    feedback: scanFeedback,
  });
  const kitLabelIndex = useLabelIndex(projectId, "kit-label", true);
  const itemLabelIndex = useLabelIndex(projectId, "item-label", true);
  const labelItems: ActionItem[] = labelActionItems({
    containers: realContainers,
    kit: kitLabelIndex.status === "ready" ? kitLabelIndex.labels : null,
    item: itemLabelIndex.status === "ready" ? itemLabelIndex.labels : null,
    open: (type, id) => openLabel(projectId, type, id),
  });
  const headerProps = { ...baseHeader, documents: { items: [...(baseHeader.documents?.items ?? []), ...labelItems] } };

  // --- Shared row renderers ---
  function renderGroupHeader(
    entry: { kind: "serialized-group"; groupKey: string; modelName: string; items: LineItem[] } | { kind: "bulk-group"; groupKey: string; item: LineItem; unitCount: number },
    childKeys: string[],
    selection: Set<string>,
    setSelection: (s: Set<string>) => void,
    qtyLabel: React.ReactNode,
  ) {
    const isExpanded = expandedGroups.has(entry.groupKey);
    const allChecked = childKeys.length > 0 && childKeys.every((k) => selection.has(k));
    const someChecked = childKeys.some((k) => selection.has(k));
    const name = entry.kind === "serialized-group" ? entry.modelName : modelDisplayName(entry.item);
    const count = entry.kind === "serialized-group" ? entry.items.length : entry.unitCount;
    const hasSubhire = entry.kind === "serialized-group"
      ? entry.items.some((i) => i.subHireId != null)
      : entry.item.subHireId != null;
    const supplierName = entry.kind === "serialized-group"
      ? entry.items.find((i) => i.subHireId != null && i.supplier)?.supplier?.name
      : entry.item.supplier?.name;

    return (
      <TableRow
        className={`cursor-pointer hover:bg-elev ${focusRing}`}
        onClick={() => toggleExpanded(entry.groupKey)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpanded(entry.groupKey);
          }
        }}
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            onCheckedChange={() => toggleGroupSelection(selection, setSelection, childKeys)}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <ChevronRight className={`h-4 w-4 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`} />
            <span className="font-medium text-ink">{name}</span>
            {hasSubhire && (
              <Badge status="neutral" className="ml-1.5 bg-blue-soft text-blue">Subhire</Badge>
            )}
            {hasSubhire && supplierName && (
              <span className="text-caption text-muted ml-1">via {supplierName}</span>
            )}
          </div>
        </TableCell>
        <TableCell className="t-mono text-muted">
          {entry.kind === "bulk-group" ? (entry.item.bulkAsset?.assetTag || "—") : ""}
        </TableCell>
        <TableCell className="text-center tabular-nums">{count}</TableCell>
        {qtyLabel}
      </TableRow>
    );
  }

  if (isLoading) {
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
          <p className="text-caption text-muted mt-0.5">
            It may have been removed, or you don&apos;t have access to it.
          </p>
          <Button variant="line" size="sm" className="mt-3" asChild>
            <Link href="/warehouse">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to warehouse
            </Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  return (
    <RequirePermission resource="warehouse" action="read">
    <FadeIn>
    <div className="space-y-6">
      <DetailHeader {...headerProps} />

      <StageCard
        stage={stage}
        counts={{ pick: pickPrepItems.length, prepped: preppedItems.length, out: checkedOutItems.length, returned: returnedItems.length, deprepped: deprepedItems.length }}
        onStageChange={setStage}
        onScan={(raw) => void pickScan.scan(raw)}
        mode={dockMode}
        onModeChange={setDockMode}
        caseTarget={caseTarget}
        entries={pickScan.entries}
        showDock={stage === "pick"}
      />

      <ScanIntakeStatus entries={durableScans.entries} error={durableScans.error} unsaved={durableScans.unsaved} retry={durableScans.retry} />
      {/* Strangler: the stage strip above drives the old tabs (no TabsList) for every stage but To pick. */}
      <Tabs value={TAB_FOR_STAGE[stage]}>
        {stage === "pick" && (
          <PickStage
            sections={pickSections}
            selection={pickSelection}
            prepInfo={prepSelectionInfo(lineItems, pickSelection.selected)}
            prepHandlers={pickPrepHandlers}
            saleItems={{ items: saleItemsToPrep, onTogglePicked: handleToggleSalePicked, pendingIds: pendingSalePickIds }}
            customUnits={{
              lines: pickPrepItems, overbookedMap, pendingLineIds: pendingCustomUnitLineIds,
              onConvert: handleConvertToCustomUnit, onConvertBack: handleConvertBackToInventory,
            }}
            batch={{ mode: scanCheckMode, onModeChange: setScanCheckMode, names: scanBatch.map((b) => b.assetName), onFinish: finishScanBatch, onClear: () => setScanBatch([]) }}
          />
        )}
        <NewContainerSheet
          open={newContainerSheetOpen}
          onOpenChange={setNewContainerSheetOpen}
          projectId={projectId}
          existingContainers={realContainers.map((c) => ({ id: c.id, label: c.label }))}
          onCreated={handleContainerCreated}
        />
        <MoveToContainerDialog
          open={moveDialogFor !== null}
          onOpenChange={(open) => !open && setMoveDialogFor(null)}
          unitCount={moveDialogUnitIds.length}
          containers={realContainers}
          onConfirm={handleConfirmMove}
          pending={moveIsPending}
        />

        {/* Deploy Tab */}
        <AccessorySelectionContext.Provider value={{ selected: selectedOut, toggle: (key) => toggleSelection(selectedOut, setSelectedOut, key) }}>
        <DeployTab
          deployScanInputRef={deployScanInputRef}
          deployScanValue={deployScanValue}
          setDeployScanValue={setDeployScanValue}
          handleDeployScanKeyDown={handleDeployScanKeyDown}
          deployScanMutationMutate={captureDeployScan}
          deployScanMutationIsPending={durableScans.busy}
          scanHistoryEntries={scanFeedback.entries}
          selectedOut={selectedOut}
          setSelectedOut={setSelectedOut}
          selectedOutCount={selectedOutCount}
          allOutKeys={allOutKeys}
          checkOutItemsList={checkOutItemsList}
          deployContainerGroups={deployContainerGroups}
          verifiedKitItems={verifiedKitItems}
          setVerifiedKitItems={setVerifiedKitItems}
          expandedGroups={expandedGroups}
          toggleExpanded={toggleExpanded}
          handleCheckOutSelected={handleCheckOutSelected}
          handleDeprep={handleDeprep}
          deprepIsPending={deprepMutation.isPending}
          clearContainerMutate={(c) => clearContainerMutation.mutate(c)}
          clearContainerIsPending={clearContainerMutation.isPending}
          checkOutIsPending={checkOutMutation.isPending}
          onMoveSelected={() => setMoveDialogFor("deploy")}
          onDeployContainer={handleDeployContainer}
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />
        </AccessorySelectionContext.Provider>

        {/* De-prep Tab — returned gear, run return checks, back to inventory */}
        <AccessorySelectionContext.Provider value={{ selected: selectedDeprep, toggle: (key) => toggleSelection(selectedDeprep, setSelectedDeprep, key) }}>
        <DeployTab
          mode="deprep"
          deployScanInputRef={deployScanInputRef}
          deployScanValue={deployScanValue}
          setDeployScanValue={setDeployScanValue}
          handleDeployScanKeyDown={handleDeployScanKeyDown}
          deployScanMutationMutate={captureDeployScan}
          deployScanMutationIsPending={durableScans.busy}
          scanHistoryEntries={scanFeedback.entries}
          selectedOut={selectedDeprep}
          setSelectedOut={setSelectedDeprep}
          selectedOutCount={selectedDeprepCount}
          allOutKeys={allDeprepKeys}
          checkOutItemsList={returnedItems}
          deployContainerGroups={deprepContainerGroups}
          verifiedKitItems={verifiedKitItems}
          setVerifiedKitItems={setVerifiedKitItems}
          expandedGroups={expandedGroups}
          toggleExpanded={toggleExpanded}
          handleCheckOutSelected={handleCheckOutSelected}
          handleDeprep={handleDeprep}
          deprepIsPending={deprepMutation.isPending}
          handleUnreturn={handleUnreturn}
          unreturnIsPending={unreturnMutation.isPending || unreturnKitsMutation.isPending}
          clearContainerMutate={(c) => clearContainerMutation.mutate(c)}
          clearContainerIsPending={clearContainerMutation.isPending}
          checkOutIsPending={checkOutMutation.isPending}
          onMoveSelected={() => setMoveDialogFor("deprep")}
          onDeployContainer={() => {}}
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />
        </AccessorySelectionContext.Provider>

        {/* Return Tab */}
        <AccessorySelectionContext.Provider value={{ selected: selectedIn, toggle: (key) => toggleSelection(selectedIn, setSelectedIn, key) }}>
        <ReturnTab
          returnScanInputRef={returnScanInputRef}
          returnScanValue={returnScanValue}
          setReturnScanValue={setReturnScanValue}
          handleReturnScanKeyDown={handleReturnScanKeyDown}
          returnScanMutationMutate={captureReturnScan}
          returnScanMutationIsPending={durableScans.busy}
          scanHistoryEntries={scanFeedback.entries}
          returnCondition={returnCondition}
          setReturnCondition={setReturnCondition}
          returnNotes={returnNotes}
          setReturnNotes={setReturnNotes}
          selectedIn={selectedIn}
          setSelectedIn={setSelectedIn}
          selectedInCount={selectedInCount}
          allInKeys={allInKeys}
          checkedOutItems={checkedOutItems}
          returnContainerGroups={returnContainerGroups}
          verifiedKitItems={verifiedKitItems}
          setVerifiedKitItems={setVerifiedKitItems}
          expandedGroups={expandedGroups}
          toggleExpanded={toggleExpanded}
          handleReturnSelected={handleReturnSelected}
          checkInIsPending={checkInMutation.isPending}
          handleUndeploy={handleUndeploy}
          undeployIsPending={undeployMutation.isPending || undeployKitsMutation.isPending}
          onReportIssue={handleReportIssue}
          onMoveSelected={() => setMoveDialogFor("return")}
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />
        </AccessorySelectionContext.Provider>

        {/* De-prepped Tab — terminal stage, read-only: gear back in inventory */}
        <TabsContent value="deprepped">
          <div className="space-y-4 pt-4">
            {deprepedItems.length === 0 ? (
              <EmptyState
                title="Nothing de-prepped yet"
                description="Gear you deprep on the Returned tab lands here, checked back into inventory."
              />
            ) : (
              <div className="rounded-[var(--r-lg)] border border-line overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Asset tag</TableHead>
                      <TableHead className="text-center w-16">Qty</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead className="w-40 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deprepedItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="font-medium text-ink">
                            {isKitParent(item)
                              ? item.description || item.kit?.name || "Kit"
                              : modelDisplayName(item)}
                          </span>
                          {isKitParent(item) && (
                            <Badge status="neutral" className="ml-1.5">Kit</Badge>
                          )}
                        </TableCell>
                        <TableCell className="t-mono text-muted">
                          {item.asset?.assetTag || item.bulkAsset?.assetTag || item.kit?.assetTag || "—"}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{deprepedQuantity(item)}</TableCell>
                        <TableCell>
                          <Badge status="ok" className="bg-ok-soft text-ok">Back in inventory</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {/* Move back a stage: re-pack this returned item (→ Returned). */}
                          <Button
                            variant="line"
                            size="sm"
                            onClick={() => (isRelocatedLineId(item.id)
                              ? stageAccessories((item.units ?? []).map((u) => u.id), "UNDEPREP")
                              : undeprepMutation.mutate(item.id))}
                            disabled={undeprepMutation.isPending}
                          >
                            <Undo2 className="mr-1.5 h-4 w-4" />
                            Move to Returned
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>


        {/* ================================================================ */}
        {/* CLOSE-OUT TAB                                                    */}
        {/* ================================================================ */}
        <TabsContent value="close-out">
          <CloseOutTab projectId={projectId} onChanged={refetchProject} />
        </TabsContent>
      </Tabs>

      {/* Kit Verification Confirmation */}
      {kitConfirm && (
        <Dialog open={true} onOpenChange={() => closeKitConfirm()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {kitConfirm.action === "deploy" ? "Prep without full verification?" : "Return without full verification?"}
              </DialogTitle>
            </DialogHeader>
            <p className="text-ui-text text-muted">
              <span className="font-medium text-ink">{kitConfirm.kitName}</span> has{" "}
              <span className="font-medium text-ink tabular-nums">{kitConfirm.verifiedCount}/{kitConfirm.totalCount}</span>{" "}
              items verified. You can {kitConfirm.action === "deploy" ? "prep" : "return"} only the verified items, or {kitConfirm.action === "deploy" ? "prep" : "return"} everything.
            </p>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="line" size="sm" onClick={() => closeKitConfirm()}>
                Cancel
              </Button>
              {kitConfirm.verifiedCount > 0 && (
                <Button
                  variant="line"
                  size="sm"
                  onClick={() => {
                    if (kitConfirm.durableOperationId) {
                      if (durableScans.review(kitConfirm.durableOperationId,{kitId:kitConfirm.kitId,lineItemId:kitConfirm.parentLineItemId,kitDecision:"verified",verifiedLineItemIds:kitConfirm.verifiedIds})) closeKitConfirm();
                      return;
                    }
                    if (kitConfirm.action === "deploy") {
                      // Prep verified children — ONE batch call (was N round-trips).
                      prepItemsBatch(
                        projectId,
                        kitConfirm.verifiedIds.map((id) => ({ lineItemId: id }))
                      ).then(() => {
                        toast.success(`Prepped ${kitConfirm.verifiedCount} verified items`);
                        invalidate();
                      }).catch((e) => showError(e));
                    } else {
                      // Return only verified children — kit parent stays deployed until all returned
                      checkInMutation
                        .mutateAsync({
                          items: kitConfirm.verifiedIds.map((id) => ({
                            lineItemId: id,
                            returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
                            notes: returnNotes || undefined,
                          })),
                        })
                        .then(() => toast.success(`Returned ${kitConfirm.verifiedCount} verified items`))
                        .catch(() => {});
                    }
                    closeKitConfirm();
                  }}
                >
                  {kitConfirm.action === "deploy" ? "Prep" : "Return"} Verified ({kitConfirm.verifiedCount})
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  if (kitConfirm.durableOperationId) {
                    if (durableScans.review(kitConfirm.durableOperationId,{kitId:kitConfirm.kitId,lineItemId:kitConfirm.parentLineItemId,kitDecision:"all"})) closeKitConfirm();
                    return;
                  }
                  const kitLi = lineItems.find((l) => l.kitId === kitConfirm.kitId && !l.isKitChild);
                  const rc = returnCondition as "GOOD" | "DAMAGED" | "MISSING";
                  const started = kitLi
                    ? startKitCheckFlow(kitConfirm.kitId, kitLi, kitConfirm.action === "deploy" ? "PREP" : "RETURN", rc)
                    : false;
                  if (!started) {
                    if (kitConfirm.action === "deploy") {
                      // No checks — prep every kit member
                      prepKitsBatch(projectId, [kitConfirm.parentLineItemId])
                        .then((res) => {
                          if (res.errors.length > 0) toast.error(`Kit skipped: ${kitConfirm.kitName}`);
                          else toast.success(`Kit prepped: ${kitConfirm.kitName}`);
                          invalidate();
                        })
                        .catch((e) => showError(e, { fallbackTitle: "Failed to prep kit" }));
                    } else {
                      kitCheckInMutation.mutate({ kitId: kitConfirm.kitId, returnCondition: rc });
                    }
                  }
                  closeKitConfirm();
                }}
              >
                {kitConfirm.action === "deploy" ? "Prep" : "Return"} All ({kitConfirm.totalCount})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Accessory checkout gate (issue #794 follow-up) */}
      {accessoryGate && (
        <Dialog open={true} onOpenChange={() => setAccessoryGate(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Missing accessories</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {accessoryGate.missingDefaults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-ui-text font-medium text-t-out">
                    These default accessories aren&apos;t packed yet:
                  </p>
                  <ul className="text-ui-text text-muted list-disc pl-5 space-y-0.5">
                    {accessoryGate.missingDefaults.map((d) => (
                      <li key={d.accessoryLineItemId}>
                        {d.accessoryName} <span className="text-muted">— {d.parentName}</span>
                      </li>
                    ))}
                  </ul>
                  <Label htmlFor="default-override-reason" className="text-ui-text">
                    {isManagerTier ? "Reason (pre-filled — edit or confirm)" : "Reason for deploying without them"}
                  </Label>
                  <Textarea
                    id="default-override-reason"
                    value={defaultOverrideReason}
                    onChange={(e) => setDefaultOverrideReason(e.target.value)}
                    placeholder="Why is it OK to deploy without these?"
                    rows={2}
                    className="text-ui-text"
                  />
                </div>
              )}
              {accessoryGate.missingOptionals.length > 0 && (
                <div className="space-y-2">
                  <p className="text-ui-text font-medium text-ink">
                    These optional accessories aren&apos;t packed yet:
                  </p>
                  <div className="space-y-2">
                    {accessoryGate.missingOptionals.map((o) => (
                      <div key={o.accessoryLineItemId} className="rounded-[var(--r)] border border-line p-2 space-y-1.5">
                        <p className="text-ui-text text-ink">
                          {o.accessoryName} <span className="text-muted">— {o.parentName}</span>
                        </p>
                        <Select
                          value={optionalSkipReasons[o.accessoryLineItemId]?.preset ?? "Not needed for this job"}
                          onValueChange={(val) =>
                            setOptionalSkipReasons((prev) => ({
                              ...prev,
                              [o.accessoryLineItemId]: { preset: val, note: prev[o.accessoryLineItemId]?.note ?? "" },
                            }))
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue>{optionalSkipReasons[o.accessoryLineItemId]?.preset ?? "Not needed for this job"}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Out of stock">Out of stock</SelectItem>
                            <SelectItem value="Not needed for this job">Not needed for this job</SelectItem>
                            <SelectItem value="Customer declined">Customer declined</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <input
                          type="text"
                          value={optionalSkipReasons[o.accessoryLineItemId]?.note ?? ""}
                          onChange={(e) =>
                            setOptionalSkipReasons((prev) => ({
                              ...prev,
                              [o.accessoryLineItemId]: { preset: prev[o.accessoryLineItemId]?.preset ?? "Not needed for this job", note: e.target.value },
                            }))
                          }
                          placeholder="Optional note..."
                          className={`flex h-9 w-full rounded-[var(--r)] border border-line bg-transparent px-2.5 text-ui-text text-ink ${focusRing}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="line" size="sm" onClick={() => setAccessoryGate(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={accessoryGate.missingDefaults.length > 0 && defaultOverrideReason.trim() === ""}
                onClick={confirmAccessoryGate}
              >
                Deploy anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Accessory partial-verification confirm — "Deploy Verified Only" vs
          "Deploy All", the kit-prep-style dialog applied to the real Deploy
          action (issue #794's remaining acceptance criterion). */}
      {accessoryVerifyConfirm && (
        <Dialog open={true} onOpenChange={() => setAccessoryVerifyConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Deploy without full verification?</DialogTitle>
            </DialogHeader>
            <p className="text-ui-text text-muted">
              <span className="font-medium text-ink">{accessoryVerifyConfirm.parentName}</span> has{" "}
              <span className="font-medium text-ink tabular-nums">
                {accessoryVerifyConfirm.verifiedCount}/{accessoryVerifyConfirm.totalCount}
              </span>{" "}
              accessories verified. You can deploy the parent with only the verified accessories,
              or deploy with everything.
            </p>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="line" size="sm" onClick={() => setAccessoryVerifyConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="line"
                size="sm"
                onClick={() => {
                  if (accessoryVerifyConfirm.durableOperationId) durableScans.review(accessoryVerifyConfirm.durableOperationId,{
                    lineItemId:accessoryVerifyConfirm.parentLineItemId,assetId:accessoryVerifyConfirm.parentAssetId,
                    accessoryDecision:"verified",includeAccessoryIds:accessoryVerifyConfirm.verifiedAccessoryIds,
                  });
                  else runCheckOut([{
                    lineItemId: accessoryVerifyConfirm.parentLineItemId,
                    assetId: accessoryVerifyConfirm.parentAssetId,
                    includeAccessoryIds: accessoryVerifyConfirm.verifiedAccessoryIds,
                  }]);
                  setAccessoryVerifyConfirm(null);
                }}
              >
                Deploy Verified Only ({accessoryVerifyConfirm.verifiedCount})
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (accessoryVerifyConfirm.durableOperationId) durableScans.review(accessoryVerifyConfirm.durableOperationId,{
                    lineItemId:accessoryVerifyConfirm.parentLineItemId,assetId:accessoryVerifyConfirm.parentAssetId,accessoryDecision:"all",
                  });
                  else runCheckOut([{
                    lineItemId: accessoryVerifyConfirm.parentLineItemId,
                    assetId: accessoryVerifyConfirm.parentAssetId,
                  }]);
                  setAccessoryVerifyConfirm(null);
                }}
              >
                Deploy All ({accessoryVerifyConfirm.totalCount})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {scanAccessoryPrompt && (
        <ScanAccessoryDialog
          key={scanAccessoryPrompt.target.lineItemId + (scanAccessoryPrompt.target.assetId ?? "")}
          prompt={scanAccessoryPrompt.data}
          onDecide={(d) => decideScanAccessories(scanAccessoryPrompt, d)}
          onDiscard={() => {
            setScanAccessoryPrompt(null);
            scanFeedback.play("info", { label: scanAccessoryPrompt.data.parentName, outcome: "Scan discarded" });
            scanFocus();
          }}
        />
      )}
      {scanModePrompt && (
        <ScanCheckModeDialog
          itemName={scanModePrompt.name}
          onChoose={(mode) => {
            const { target, opts } = scanModePrompt;
            setScanModePrompt(null);
            setScanCheckMode(mode);
            void proceedScanPrep(target, opts, mode);
          }}
          onDiscard={() => {
            setScanModePrompt(null);
            scanFocus();
          }}
        />
      )}

      {/* Add to Project Prompt */}
      <Dialog open={addPromptOpen} onOpenChange={setAddPromptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to job?</DialogTitle>
          </DialogHeader>
          <p className="text-ui-text text-muted">
            <span className="font-medium text-ink">{addPromptData?.assetName}</span>{" "}
            is not on this project. Would you like to add it and check it out?
          </p>
          <DialogFooter>
            <Button
              variant="line"
              onClick={() => {
                setAddPromptOpen(false);
                setAddPromptData(null);
                scanInputRef.current?.focus();
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={quickAddMutation.isPending}
              loading={quickAddMutation.isPending}
              onClick={() => {
                if (!addPromptData) return;
                quickAddMutation.mutate({
                  modelId: addPromptData.modelId,
                  assetId: addPromptData.assetId || undefined,
                  bulkAssetId: addPromptData.bulkAssetId || undefined,
                  quantity: 1,
                });
              }}
            >
              Add &amp; deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Asset Picker Dialog */}
      <Dialog open={assetPickerOpen} onOpenChange={setAssetPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign assets</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-ui-text text-muted">
              Scan each unit as you pick it, or choose from the dropdowns.
            </p>

            {/* Scan-to-assign. Continuous, because assigning eleven headsets is
                one pass down a shelf — the camera stays open between units.
                Typing and HID wedges land on the same handler via Enter.

                Sticky: DialogContent is the scroll container, and eleven slots
                scroll the field out of view exactly when it is being used every
                few seconds. Full-bleed (-mx-6/px-6 against the dialog's p-6) so
                rows scrolling underneath don't show through the edges. */}
            <div className="sticky top-0 z-10 -mx-6 space-y-1.5 border-b border-line bg-elev px-6 pb-3">
              <AssetTagInput
                value={assetPickerScanValue}
                onChange={(e) => setAssetPickerScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAssetPickerScan(assetPickerScanValue);
                  }
                }}
                onScan={handleAssetPickerScan}
                scannerTitle="Scan to assign"
                continuous
                placeholder="Scan an asset tag to assign it..."
                className="h-11 font-mono"
                autoFocus
              />
              <p className="text-ui-text text-muted" aria-live="polite">
                {countAssigned(assetPickerItems)} of {assetPickerItems.length} assigned
              </p>
            </div>

            {assetPickerItems.map((pickerItem, idx) => (
              <div key={`${pickerItem.lineItemId}-${idx}`} className="space-y-1.5">
                <Label className="text-ui-text font-medium">
                  {pickerItem.modelName}
                  {assetPickerItems.filter((i) => i.lineItemId === pickerItem.lineItemId).length > 1
                    ? ` #${assetPickerItems.filter((i, j) => i.lineItemId === pickerItem.lineItemId && j <= idx).length}`
                    : ""}
                </Label>
                {pickerItem.availableAssets.length === 0 ? (
                  <p className="text-ui-text text-t-out">No available assets</p>
                ) : (
                  <Select
                    value={pickerItem.selectedAssetId}
                    onValueChange={(val) => {
                      const assetId = val ?? "";
                      applyAssetPickerItems((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, selectedAssetId: assetId } : item
                        )
                      );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an asset...">
                        {pickerItem.selectedAssetId
                          ? (() => {
                              const a = pickerItem.availableAssets.find((x) => x.id === pickerItem.selectedAssetId);
                              return a ? `${a.assetTag}${a.customName ? ` — ${a.customName}` : ""}` : pickerItem.selectedAssetId;
                            })()
                          : "Select an asset..."}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {pickerItem.availableAssets
                        .filter((a) => {
                          // Exclude assets already selected for other items
                          const otherSelected = assetPickerItems
                            .filter((_, i) => i !== idx)
                            .map((i) => i.selectedAssetId);
                          return !otherSelected.includes(a.id);
                        })
                        .map((asset) => (
                          <SelectItem key={asset.id} value={asset.id}>
                            {asset.assetTag}
                            {asset.customName ? ` — ${asset.customName}` : ""}
                            {asset.serialNumber ? ` (S/N: ${asset.serialNumber})` : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="line" onClick={() => setAssetPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssetPickerConfirm}
              disabled={assetPickerItems.some((i) => !i.selectedAssetId)}
            >
              Prep
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CheckFlowSheet
        flow={checkFlow}
        projectId={projectId}
        orgId={orgId}
        selectedContainer={selectedContainer}
        activeContainerId={activeContainerId}
        invalidate={invalidate}
      />
      <ReportIssueDialog
        open={reportIssueTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReportIssueTarget(null);
        }}
        targetLabel={
          reportIssueTarget?.asset?.assetTag
          ?? reportIssueTarget?.bulkAsset?.assetTag
          ?? (reportIssueTarget ? modelDisplayName(reportIssueTarget) : "item")
        }
        projectId={projectId}
        lineItemId={reportIssueTarget?.id}
        assetId={reportIssueTarget?.assetId ?? undefined}
      />
    </div>
    </FadeIn>
    </RequirePermission>
  );
}
