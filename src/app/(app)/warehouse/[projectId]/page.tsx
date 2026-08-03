"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, useState, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useNativeWarehouseProject } from "@/hooks/use-native-warehouse";
import {
  ScanBarcode,
  ChevronRight,
  ArrowLeft,
  Printer,
  PackageCheck,
  PackageX,
  PackageOpen,
  Truck,
  ClipboardList,
  MoreVertical,
  FileText,
  ChevronDown,
  ExternalLink,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/show-error";
import { focusRing } from "@/lib/utils";
import { transitionNeedsCheck, lineHasModelChecks, kitHasChecks } from "@/lib/warehouse-check-policy";

import {
  lookupAssetForScan,
  getAvailableAssetsForModels,
} from "@/server/warehouse";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import { ScanAudioToggle } from "@/components/scan-audio-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Tabs,
  TabsList,
  TabsTrigger,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { OnlinePickList } from "@/components/warehouse/online-pick-list";
import { ItemCheckForm } from "@/components/warehouse/item-check-form";
import { ReportIssueDialog } from "@/components/warehouse/report-issue-dialog";
import { CloseOutTab } from "@/components/warehouse/close-out-tab";
import { PickPrepTab } from "@/components/warehouse/pick-prep-tab";
import { DeployTab } from "@/components/warehouse/deploy-tab";
import { ReturnTab } from "@/components/warehouse/return-tab";
import { WarehouseLifecycle } from "@/components/warehouse/warehouse-lifecycle";
import { summarizeWarehouseStages } from "@/components/warehouse/warehouse-stages";
import { EmptyState } from "@/components/ui/empty-state";
import type { LineItem, AvailableAsset, GroupEntry } from "@/components/warehouse/warehouse-types";
import {
  isBulkItem,
  modelDisplayName,
  isKitParent,
  isAccessoryParent,
  accessoryChildrenOf,
  collectAllVerifiableIds,
  bulkUnitKey,
  bulkUnpackedRemaining,
  bulkPackedWaiting,
  isInPickPrepStage,
  isInPreppedStage,
  isInReturnedStage,
  isInDeprepedStage,
  isInCheckedOutStage,
} from "@/components/warehouse/warehouse-types";
import {
  pullItem,
  prepItemDirect,
  prepItemsBatch,
  deprepKit,
  deprepItemsBatch,
  prepKitChildren,
  prepKitsBatch,
  unpackItem,
} from "@/server/check-records";
import { useConvex, useConvexAuth } from "convex/react";
import { api as convexApi } from "../../../../../convex/_generated/api";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";
import { useCheckRecordWrites } from "@/hooks/use-check-record-writes";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCurrentRole } from "@/lib/use-permissions";
import { isInternalStockLine } from "@/lib/warehouse-subhire-filter";

const statusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
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

// `countStage` picks how a bulk line's per-unit count is derived so a partially
// prepped line shows the right number of units in each tab: the units still to
// pick in Pick, and the units packed-and-waiting in Prepped. Omitted (De-prep /
// legacy) keeps the whole ordered quantity.
function groupItems(
  items: LineItem[],
  mode: "prep" | "deploy" = "prep",
  countStage?: "prep" | "prepped",
): GroupEntry[] {
  const serializedByModel = new Map<string, LineItem[]>();
  const result: GroupEntry[] = [];

  for (const item of items) {
    if (isKitParent(item)) {
      // Deploy tab: show children that aren't checked out, or nested kits with undeployed grandchildren
      const allChildren = (item.childLineItems || []) as LineItem[];
      const deployChildren = allChildren.filter((c) => {
        if (c.status === "CANCELLED") return false;
        if (c.status !== "CHECKED_OUT") return true;
        // Nested kit that's checked out: still include if any grandchildren need deploying
        if (c.kitId && c.childLineItems?.length) {
          return (c.childLineItems as LineItem[]).some(
            (gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED"
          );
        }
        return false;
      });
      result.push({
        kind: "kit-group",
        groupKey: `kit-${item.id}`,
        item,
        children: deployChildren,
      });
    } else if (isAccessoryParent(item)) {
      // Deploy tab: accessories render like a kit's children — always visible,
      // not gated behind the prep asset-picker (issue #794 follow-up).
      const deployChildren = accessoryChildrenOf(item).filter((c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED");
      result.push({
        kind: "accessory-group",
        groupKey: `acc-${item.id}`,
        item,
        children: deployChildren,
      });
    } else if (isBulkItem(item)) {
      // Bulk items (qty > 1) show as expandable groups with per-unit rows
      // just like serialized groups. unitCount reflects the units actionable in
      // this stage (still-to-pick vs packed-and-waiting) so a partially prepped
      // line shows the right count in each tab.
      const unitCount =
        countStage === "prep"
          ? bulkUnpackedRemaining(item)
          : countStage === "prepped"
            ? bulkPackedWaiting(item)
            : item.quantity;
      result.push({
        kind: "bulk-group",
        groupKey: `bulk-${item.id}`,
        item,
        unitCount,
      });
    } else if (item.model) {
      const modelKey = item.model.name + (item.model.modelNumber ? ` - ${item.model.modelNumber}` : "");
      // In deploy mode, items in different containers must be in separate groups
      // so each group's container is unambiguous for the container section headers
      const containerSuffix = mode === "deploy" ? `\0${item.prepContainer || ""}` : "";
      const key = modelKey + containerSuffix;
      const existing = serializedByModel.get(key);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        serializedByModel.set(key, arr);
        result.push({ kind: "serialized-group", groupKey: `ser-${key}`, modelName: modelKey, items: arr });
      }
    } else {
      result.push({ kind: "single", item });
    }
  }

  // Flatten serialized groups with only 1 item
  return result.map((e) => {
    if (e.kind === "serialized-group" && e.items.length === 1) {
      return { kind: "single" as const, item: e.items[0] };
    }
    if (e.kind === "bulk-group" && e.unitCount <= 1 && e.unitCount === e.item.quantity) {
      return { kind: "single" as const, item: e.item };
    }
    return e;
  });
}

function groupCheckinItems(items: LineItem[]): GroupEntry[] {
  const serializedByModel = new Map<string, LineItem[]>();
  const result: GroupEntry[] = [];

  for (const item of items) {
    if (isKitParent(item)) {
      // Return tab: show children that are checked out, or nested kits with deployed grandchildren
      const allChildren = (item.childLineItems || []) as LineItem[];
      const returnChildren = allChildren.filter((c) => {
        if (c.status === "CHECKED_OUT") return true;
        // Nested kit not checked out: still include if any grandchildren are deployed
        if (c.kitId && c.childLineItems?.length) {
          return (c.childLineItems as LineItem[]).some((gc) => gc.status === "CHECKED_OUT");
        }
        return false;
      });
      result.push({
        kind: "kit-group",
        groupKey: `kit-in-${item.id}`,
        item,
        children: returnChildren,
      });
    } else if (isAccessoryParent(item)) {
      const returnChildren = accessoryChildrenOf(item).filter((c) => c.status === "CHECKED_OUT");
      result.push({
        kind: "accessory-group",
        groupKey: `acc-in-${item.id}`,
        item,
        children: returnChildren,
      });
    } else if (isBulkItem(item)) {
      const remaining = item.checkedOutQuantity - item.returnedQuantity;
      result.push({
        kind: "bulk-group",
        groupKey: `bulk-in-${item.id}`,
        item,
        unitCount: Math.max(remaining, 0),
      });
    } else if (item.model) {
      const modelKey = item.model.name + (item.model.modelNumber ? ` - ${item.model.modelNumber}` : "");
      // Items in different containers must be in separate groups
      const containerSuffix = `\0${item.prepContainer || ""}`;
      const key = modelKey + containerSuffix;
      const existing = serializedByModel.get(key);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        serializedByModel.set(key, arr);
        result.push({ kind: "serialized-group", groupKey: `ser-in-${key}`, modelName: modelKey, items: arr });
      }
    } else {
      result.push({ kind: "single", item });
    }
  }

  return result.map((e) => {
    if (e.kind === "serialized-group" && e.items.length === 1) {
      return { kind: "single" as const, item: e.items[0] };
    }
    if (e.kind === "bulk-group" && e.unitCount <= 1 && e.unitCount === e.item.quantity) {
      return { kind: "single" as const, item: e.item };
    }
    return e;
  });
}

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

function WarehouseProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "check-in" ? "check-in" : tabParam === "check-out" ? "check-out" : tabParam === "close-out" ? "close-out" : "pick-prep";
  const scanInputRef = useRef<HTMLInputElement>(null);
  const deployScanInputRef = useRef<HTMLInputElement>(null);
  const returnScanInputRef = useRef<HTMLInputElement>(null);

  const [scanValue, setScanValue] = useState("");
  const [deployScanValue, setDeployScanValue] = useState("");
  const [returnScanValue, setReturnScanValue] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [returnCondition, setReturnCondition] = useState("GOOD");
  const [returnNotes, setReturnNotes] = useState("");
  const [pickListOpen, setPickListOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const wConvex = useConvex();
  const { isAuthenticated: wAuthed } = useConvexAuth();

  // Container state for prep grouping
  const [selectedContainer, setSelectedContainer] = useState<string>("");

  // Selection state
  const [selectedPrep, setSelectedPrep] = useState<Set<string>>(new Set());
  const [selectedOut, setSelectedOut] = useState<Set<string>>(new Set());
  const [selectedDeprep, setSelectedDeprep] = useState<Set<string>>(new Set());
  const [selectedIn, setSelectedIn] = useState<Set<string>>(new Set());

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

  // Kit verification confirmation dialog
  const [kitConfirm, setKitConfirm] = useState<{
    action: "deploy" | "return";
    kitName: string;
    kitId: string;
    parentLineItemId: string;
    verifiedCount: number;
    totalCount: number;
    verifiedIds: string[];
  } | null>(null);

  // Accessory checkout gate (issue #794 follow-up) — soft-blocks Deploy when a
  // parent's DEFAULT accessories aren't packed, and asks "why" for missing
  // OPTIONALs. `pendingCheckOutItems` is the batch waiting on this dialog.
  const [accessoryGate, setAccessoryGate] = useState<{
    pendingCheckOutItems: Array<{ lineItemId: string; assetId?: string; quantity?: number }>;
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
    parentLineItemId: string;
    parentAssetId?: string;
    parentName: string;
    verifiedCount: number;
    totalCount: number;
    /** Verified accessories' own asset/bulkAsset identities — what
     *  `checkOutItems`'s `includeAccessoryIds` actually narrows by. */
    verifiedAccessoryIds: string[];
  } | null>(null);

  // Check form state — opens when a scanned item's model has check items
  const [checkFormOpen, setCheckFormOpen] = useState(false);
  const [checkFormData, setCheckFormData] = useState<{
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
    /** When true, this is a kit queue — on complete, deploy/return the kit atomically */
    kitQueueKitId?: string;
    kitQueueReturnCondition?: "GOOD" | "DAMAGED" | "MISSING";
    /** When true, this RETURN check was triggered by a deprep action from the deploy tab. */
    fromDeprep?: boolean;
  } | null>(null);
  const [checkFormSubmitting, setCheckFormSubmitting] = useState(false);

  // "Report issue" dialog (GitHub #898) — opened from a CHECKED_OUT line item
  // row on the Return tab (Deployed gear). Non-null target = dialog open.
  const [reportIssueTarget, setReportIssueTarget] = useState<LineItem | null>(null);
  const handleReportIssue = (item: LineItem) => setReportIssueTarget(item);

  // Queue for multi-item check flows
  type CheckQueueItem = {
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
    kitQueueReturnCondition?: "GOOD" | "DAMAGED" | "MISSING";
    /** When true, this RETURN check was triggered by a deprep action from the deploy tab.
     *  Used to route focus back to the deploy scan input on completion, and to route
     *  submission through completeCheckAndStore (which transitions the item back to inventory). */
    fromDeprep?: boolean;
  };
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
            includeAccessoryIds: i.includeAccessoryIds,
          })),
        )
          .then(() => {
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
  // Browser-direct check-record writes (deprep/pack/flag/store + kit/child/adhoc).
  const checkRecordWrites = useCheckRecordWrites();
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

  const checkOutMutation = useServerMutation({
    mutationFn: async (params: { items: Array<{ lineItemId: string; assetId?: string; quantity?: number; includeAccessoryIds?: string[] }>; includeAccessories?: boolean }) => {
      const result = await warehouseWrites.checkOutItems(projectId, params.items, params.includeAccessories);
      // Sync container status for affected containers — ONE batch call (was one
      // round-trip per container).
      const containers = new Set(
        params.items.map((i) => lineItems.find((l) => l.id === i.lineItemId)?.prepContainer).filter(Boolean) as string[]
      );
      if (containers.size > 0) await warehouseWrites.syncContainersBatch(projectId, [...containers]);
      return result;
    },
    onSuccess: invalidate,
    onError: (e) => showError(e),
  });

  const checkInMutation = useServerMutation({
    mutationFn: async (data: {
      items: Array<{ lineItemId: string; assetId?: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING"; quantity?: number; notes?: string }>;
    }) => {
      const result = await warehouseWrites.checkInItems(projectId, data.items);
      // Sync container status for affected containers — ONE batch call (was one
      // round-trip per container).
      const containers = new Set(
        data.items.map((i) => lineItems.find((l) => l.id === i.lineItemId)?.prepContainer).filter(Boolean) as string[]
      );
      if (containers.size > 0) await warehouseWrites.syncContainersBatch(projectId, [...containers]);
      return result;
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (e) => showError(e),
  });

  const quickAddMutation = useServerMutation({
    mutationFn: async (data: { modelId: string; assetId?: string; bulkAssetId?: string; quantity?: number }) => {
      await ensureContainerIfNeeded();
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
        prepItemDirect(projectId, li.id, li.assetId || undefined, undefined, selectedContainer || null)
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

  const kitCheckOutMutation = useServerMutation({
    mutationFn: (kitId: string) => warehouseWrites.checkOutKit(projectId, kitId),
    onSuccess: () => invalidate(),
    onError: (e) => showError(e),
  });

  const kitCheckInMutation = useServerMutation({
    mutationFn: (data: { kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }) =>
      warehouseWrites.checkInKit(projectId, data.kitId, data.returnCondition),
    onSuccess: () => invalidate(),
    onError: (e) => showError(e),
  });

  // Bulk kit deploy/return — one round-trip for all selected kits (was one
  // checkOutKit/checkInKit per kit). Per-kit errors come back from the server.
  type KitBatchResult = { succeeded: string[]; errors: { kitId: string; message: string }[] };
  const kitBatchOutMutation = useServerMutation<KitBatchResult, string[]>({
    mutationFn: (kitIds: string[]) => warehouseWrites.checkOutKitsBatch(projectId, kitIds),
    onSuccess: (res) => {
      if (res.succeeded.length > 0) toast.success(`Deployed ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"}`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} failed: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });
  const kitBatchInMutation = useServerMutation<KitBatchResult, Array<{ kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }>>({
    mutationFn: (kits) => warehouseWrites.checkInKitsBatch(projectId, kits),
    onSuccess: (res) => {
      if (res.succeeded.length > 0) toast.success(`Returned ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"}`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} failed: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });

  // Batched deprep — reverse prep for every selected item + kit in one call.
  // (Drives the deprep buttons' pending state via `.isPending`.)
  const deprepMutation = useServerMutation({
    mutationFn: (ops: Array<{ lineItemId: string; quantity?: number; isKit?: boolean }>) =>
      deprepItemsBatch(projectId, ops),
    onSuccess: (_res, ops) => {
      toast.success(`Removed ${ops.length} from prep`);
      invalidate();
    },
    onError: (e) => showError(e),
  });

  // ── Move-back (reverse a stage) mutations ──────────────────────────────────
  const undeployMutation = useServerMutation({
    mutationFn: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) =>
      warehouseWrites.undeployItems(projectId, items),
    onSuccess: () => { toast.success("Moved back to Prepped"); invalidate(); },
    onError: (e) => showError(e),
  });
  const undeployKitsMutation = useServerMutation<KitBatchResult, string[]>({
    mutationFn: (kitIds: string[]) => warehouseWrites.undeployKitsBatch(projectId, kitIds),
    onSuccess: (res) => {
      if (res.succeeded.length > 0) toast.success(`Moved ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"} back to Prepped`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} skipped: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });
  const unreturnMutation = useServerMutation({
    mutationFn: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) =>
      warehouseWrites.unreturnItems(projectId, items),
    onSuccess: () => { toast.success("Moved back to Deployed"); invalidate(); },
    onError: (e) => showError(e),
  });
  const unreturnKitsMutation = useServerMutation<KitBatchResult, string[]>({
    mutationFn: (kitIds: string[]) => warehouseWrites.unreturnKitsBatch(projectId, kitIds),
    onSuccess: (res) => {
      if (res.succeeded.length > 0) toast.success(`Moved ${res.succeeded.length} kit${res.succeeded.length === 1 ? "" : "s"} back to Deployed`);
      if (res.errors.length > 0) toast.error(`${res.errors.length} kit${res.errors.length === 1 ? "" : "s"} skipped: ${res.errors[0].message}`);
      invalidate();
    },
    onError: (e) => showError(e),
  });
  const undeprepMutation = useServerMutation({
    mutationFn: (lineItemId: string) => warehouseWrites.undeprepLine(projectId, lineItemId),
    onSuccess: () => { toast.success("Re-packed — back to Returned"); invalidate(); },
    onError: (e) => showError(e),
  });

  // Parse a selection set (bulk `id:idx` keys, plain line ids, kit parents) into
  // per-line quantities + kit ids, then fire the given item/kit reverse mutations.
  const moveBackSelection = (
    ids: Set<string>,
    fireItems: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) => void,
    fireKits: (kitIds: string[]) => void,
  ) => {
    if (ids.size === 0) return;
    const qtyMap = new Map<string, number>();
    const kitIds = new Set<string>();
    for (const key of ids) {
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
    moveBackSelection(ids, (items) => undeployMutation.mutate(items), (kitIds) => undeployKitsMutation.mutate(kitIds));
    setSelectedIn(new Set());
  };
  // Returned → Deployed
  const handleUnreturn = (ids: Set<string>) => {
    moveBackSelection(ids, (items) => unreturnMutation.mutate(items), (kitIds) => unreturnKitsMutation.mutate(kitIds));
    setSelectedDeprep(new Set());
  };

  const clearContainerMutation = useServerMutation({
    mutationFn: (containerName: string) => warehouseWrites.clearPrepContainer(projectId, containerName),
    onSuccess: () => {
      toast.success("Container removed");
      invalidate();
    },
    onError: (e) => showError(e),
  });

  // --- Scan mutations ---
  const scanMutation = useServerMutation({
    mutationFn: (assetTag: string) => lookupAssetForScan(projectId, assetTag, "checkout"),
    onSuccess: async (result) => {
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
                  scanFeedback.play("success");
                  toast.success(`Kit prepped: ${kitResult.assetName}`);
                  invalidate();
                })
                .catch((e) => {
                  scanFeedback.play("error");
                  showError(e, { fallbackTitle: "Failed to prep kit" });
                });
              setScanValue("");
              scanInputRef.current?.focus();
            }
          }
        } else {
          const messages: Record<string, string> = {
            not_on_project: "Kit not assigned to this project",
            already_checked_out: "Kit already deployed",
          };
          scanFeedback.play("error");
          toast.error(messages[kitResult.reason as string] || "Cannot prep this kit");
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
          scanFeedback.play("success");
          toast.success(`Verified: ${memberResult.assetName}`);
        } else {
          scanFeedback.play("error");
          toast.error(`This asset is in a kit${memberResult.kitAssetTag ? ` (${memberResult.kitAssetTag})` : ""} not on this project.`);
        }
        setScanValue("");
        scanInputRef.current?.focus();
        return;
      }

      if (result.found && result.type === "asset_child") {
        const r = result as { assetName: string; parentAssetTag: string | null };
        // Disambiguation needed — scanned an accessory, not its parent. Resolved
        // but needs attention, not a hard failure.
        scanFeedback.play("exception");
        toast.info(`${r.assetName} is an accessory${r.parentAssetTag ? ` of ${r.parentAssetTag}` : ""} — scan the parent; accessories move with it.`);
        setScanValue("");
        scanInputRef.current?.focus();
        return;
      }

      if (result.found && result.lineItemId) {
        // Ensure container asset is on project before prepping
        await ensureContainerIfNeeded();

        // Check if model has check items — if so, open check form for prep
        const matchedLi = lineItems.find((l) => l.id === result.lineItemId);
        const hasChecks = transitionNeedsCheck("PREP", { hasCheckItems: lineHasModelChecks(matchedLi) });

        if (hasChecks && matchedLi?.modelId) {
          // Pull item first, then open check form (prep flow)
          pullItem(projectId, result.lineItemId).catch(() => {});
          setCheckFormData({
            context: "PREP",
            modelId: matchedLi.modelId,
            assetTag: matchedLi.asset?.assetTag || matchedLi.bulkAsset?.assetTag || "",
            assetName: result.assetName || modelDisplayName(matchedLi),
            lineItemId: result.lineItemId,
            assetId: result.assetId || matchedLi.assetId || "",
            bulkAssetId: matchedLi.bulkAssetId || undefined,
          });
          setCheckFormOpen(true);
          setScanValue("");
          scanInputRef.current?.focus();
        } else {
          // No check items — prep directly (set prepStatus=PACKED, no deploy)
          prepItemDirect(projectId, result.lineItemId, result.assetId || undefined, undefined, selectedContainer || null)
            .then(() => {
              scanFeedback.play("success");
              toast.success(`Prepped: ${result.assetName || "Asset"}`);
              setScanValue("");
              scanInputRef.current?.focus();
              invalidate();
            })
            .catch((e) => {
              scanFeedback.play("error");
              showError(e);
            });
        }
      } else if (result.found && !result.lineItemId) {
        if (result.reason === "not_on_project" && "modelId" in result && result.modelId) {
          // Asset found but not on this project — resolved but needs a decision
          // (add it?), not a hard failure.
          scanFeedback.play("exception");
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
          already_checked_out: "Already deployed on this project",
          asset_checked_out_elsewhere: `Already deployed${detail}`,
          not_on_project: "Asset not assigned to this project",
          not_checked_out: "Asset is not deployed on this project",
          already_returned: "All units already returned",
          asset_unavailable: `Asset is ${assetStatus.replace("_", " ").toLowerCase()} and cannot be deployed`,
          tt_blocked: `Test & Tag ${ttStatus.toLowerCase()}${ttNextDue ? ` — next test due ${ttNextDue}` : ""}. Cannot deploy until tested.`,
        };
        // "already_returned" is resolved but needs attention (all units are back
        // already) rather than a hard failure — every other reason here blocks
        // the scan outright.
        scanFeedback.play(result.reason === "already_returned" ? "exception" : "error");
        toast.error(messages[result.reason as string] || "Cannot deploy this asset");
        setScanValue("");
        scanInputRef.current?.focus();
      } else {
        // Unknown tag — resolved (we know it's not in the system) but needs the
        // operator's attention, not a hard error.
        scanFeedback.play("exception");
        toast.error("Asset not found");
        setScanValue("");
        scanInputRef.current?.focus();
      }
    },
    onError: (e) => {
      scanFeedback.play("error");
      showError(e);
      setScanValue("");
      scanInputRef.current?.focus();
    },
  });

  const deployScanMutation = useServerMutation({
    mutationFn: (assetTag: string) => lookupAssetForScan(projectId, assetTag, "checkout"),
    onSuccess: (result) => {
      // Deploy scan: find matching prepped item and deploy it
      if (result.found && result.type === "kit") {
        const kitResult = result as { kitId: string; assetName: string; lineItemId: string | null; reason: string | null };
        const kitLi = lineItems.find((l) => l.kitId === kitResult.kitId && !l.isKitChild);
        if (kitLi && kitLi.prepStatus === "PACKED") {
          kitCheckOutMutation
            .mutateAsync(kitResult.kitId)
            .then(() => {
              scanFeedback.play("success");
              toast.success(`Deployed kit: ${kitResult.assetName}`);
            })
            .catch(() => scanFeedback.play("error"));
        } else if (kitResult.reason === "already_checked_out") {
          scanFeedback.play("error");
          toast.error("Kit already deployed");
        } else {
          scanFeedback.play("error");
          toast.error("Kit is not prepped yet — prep it first in Pick/Prep");
        }
        setDeployScanValue("");
        deployScanInputRef.current?.focus();
        return;
      }

      if (result.found && result.type === "kit_member") {
        const memberResult = result as { kitId: string | null; kitAssetTag: string | null; assetName: string };
        scanFeedback.play("error");
        toast.error(`This asset is in a kit${memberResult.kitAssetTag ? ` (${memberResult.kitAssetTag})` : ""} — scan the kit barcode to deploy`);
        setDeployScanValue("");
        deployScanInputRef.current?.focus();
        return;
      }

      if (result.found && result.type === "asset_child") {
        const r = result as { assetName: string; parentAssetTag: string | null };
        // Disambiguation needed — scanned an accessory, not its parent.
        scanFeedback.play("exception");
        toast.error(`${r.assetName} is an accessory${r.parentAssetTag ? ` of ${r.parentAssetTag}` : ""} — scan the parent to deploy; it moves with the parent.`);
        setDeployScanValue("");
        deployScanInputRef.current?.focus();
        return;
      }

      if (result.found && result.lineItemId) {
        const matchedLi = lineItems.find((l) => l.id === result.lineItemId);
        if (matchedLi?.prepStatus === "PACKED" && matchedLi.status !== "CHECKED_OUT") {
          checkOutMutation
            .mutateAsync({ items: [{ lineItemId: result.lineItemId, assetId: result.assetId || undefined }] })
            .then(() => {
              scanFeedback.play("success");
              toast.success(`Deployed: ${result.assetName || "Item"}`);
            })
            .catch(() => scanFeedback.play("error"));
        } else if (matchedLi?.status === "CHECKED_OUT") {
          scanFeedback.play("error");
          toast.error("Item already deployed");
        } else {
          scanFeedback.play("error");
          toast.error("Item is not prepped yet — prep it first in Pick/Prep");
        }
      } else if (result.found && !result.lineItemId) {
        scanFeedback.play("error");
        toast.error(result.reason === "not_on_project" ? "Asset not on this project" : "Cannot deploy this item");
      } else {
        // Unknown tag.
        scanFeedback.play("exception");
        toast.error("Asset not found");
      }
      setDeployScanValue("");
      deployScanInputRef.current?.focus();
    },
    onError: (e) => {
      scanFeedback.play("error");
      showError(e);
      setDeployScanValue("");
      deployScanInputRef.current?.focus();
    },
  });

  const returnScanMutation = useServerMutation({
    mutationFn: (assetTag: string) => lookupAssetForScan(projectId, assetTag, "checkin"),
    onSuccess: (result) => {
      // Handle kit return scans
      if (result.found && result.type === "kit") {
        const kitResult = result as { kitId: string; assetName: string; lineItemId: string | null; reason: string | null };
        if (kitResult.lineItemId && !kitResult.reason) {
          // Check verification status before returning
          const kitLi = lineItems.find((l) => l.kitId === kitResult.kitId && !l.isKitChild);
          const children = kitLi ? ((kitLi.childLineItems || []) as LineItem[]) : [];
          const allIds = collectAllVerifiableIds(children, "return");
          const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));
          if (allIds.length > 0 && verifiedIds.length < allIds.length) {
            setKitConfirm({
              action: "return",
              kitName: kitResult.assetName,
              kitId: kitResult.kitId,
              parentLineItemId: kitLi?.id || kitResult.lineItemId || "",
              verifiedCount: verifiedIds.length,
              totalCount: allIds.length,
              verifiedIds,
            });
            setReturnScanValue("");
            returnScanInputRef.current?.focus();
          } else {
            // Try to start kit check flow; if no checks needed, return directly
            const started = kitLi ? startKitCheckFlow(kitResult.kitId, kitLi, "RETURN", returnCondition as "GOOD" | "DAMAGED" | "MISSING") : false;
            if (!started) {
              kitCheckInMutation
                .mutateAsync({ kitId: kitResult.kitId, returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING" })
                .then(() => {
                  scanFeedback.play("success");
                  toast.success(`Kit returned: ${kitResult.assetName}`);
                  setReturnScanValue("");
                  setReturnNotes("");
                  returnScanInputRef.current?.focus();
                })
                .catch(() => scanFeedback.play("error"));
            }
          }
        } else {
          const messages: Record<string, string> = {
            not_on_project: "Kit not assigned to this project",
            not_checked_out: "Kit is not deployed",
          };
          scanFeedback.play("error");
          toast.error(messages[kitResult.reason as string] || "Cannot return this kit");
          setReturnScanValue("");
          returnScanInputRef.current?.focus();
        }
        return;
      }

      // Handle kit member scans — verify on return too
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
          const kitGroupKey = `kit-in-${kitOnProject.id}`;
          setExpandedGroups((prev) => {
            const next = new Set(prev);
            next.add(kitGroupKey);
            return next;
          });
          scanFeedback.play("success");
          toast.success(`Verified: ${memberResult.assetName}`);
        } else {
          scanFeedback.play("error");
          toast.error(`This asset is in a kit${memberResult.kitAssetTag ? ` (${memberResult.kitAssetTag})` : ""} not on this project.`);
        }
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
        return;
      }

      if (result.found && result.type === "asset_child") {
        const r = result as { assetName: string; parentAssetTag: string | null };
        // Disambiguation needed — scanned an accessory, not its parent.
        scanFeedback.play("exception");
        toast.info(`${r.assetName} is an accessory${r.parentAssetTag ? ` of ${r.parentAssetTag}` : ""} — scan the parent to return; it comes back with the parent.`);
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
        return;
      }

      if (result.found && result.lineItemId) {
        // A return-scan (truck-in) never opens a check form — the return check runs
        // only at de-prep (shelf-in). transitionNeedsCheck("RETURN", …) returns false
        // here, so this collapses to the direct check-in below.
        const matchedLi = lineItems.find((l) => l.id === result.lineItemId);
        const needsReturnCheck = transitionNeedsCheck("RETURN", {
          hasCheckItems: lineHasModelChecks(matchedLi),
          fromDeprep: false,
        });

        if (needsReturnCheck && matchedLi?.modelId) {
          // Unpack item first, then open check form
          unpackItem(projectId, result.lineItemId).catch(() => {});
          setCheckFormData({
            context: "RETURN",
            modelId: matchedLi.modelId,
            assetTag: matchedLi.asset?.assetTag || matchedLi.bulkAsset?.assetTag || "",
            assetName: result.assetName || modelDisplayName(matchedLi),
            lineItemId: result.lineItemId,
            assetId: result.assetId || matchedLi.assetId || "",
            bulkAssetId: matchedLi.bulkAssetId || undefined,
          });
          setCheckFormOpen(true);
          setReturnScanValue("");
          returnScanInputRef.current?.focus();
        } else {
          // No check items — direct checkin (existing behavior)
          checkInMutation
            .mutateAsync({
              items: [{
                lineItemId: result.lineItemId,
                assetId: result.assetId ?? undefined,
                returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
                notes: returnNotes || undefined,
              }],
            })
            .then(() => {
              scanFeedback.play("success");
              toast.success(`Returned: ${result.assetName || "Asset"}`);
              setReturnScanValue("");
              setReturnNotes("");
              returnScanInputRef.current?.focus();
            })
            .catch(() => scanFeedback.play("error"));
        }
      } else if (result.found && !result.lineItemId) {
        const messages: Record<string, string> = {
          not_checked_out: "Asset is not deployed on this project",
          not_on_project: "Asset not assigned to this project",
          already_returned: "All units already returned",
          already_checked_out: "Already deployed",
        };
        // "already_returned" is resolved but needs attention (nothing left to
        // return), not a hard failure — every other reason here blocks the scan.
        scanFeedback.play(result.reason === "already_returned" ? "exception" : "error");
        toast.error(messages[result.reason as string] || "Cannot return this asset");
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
      } else {
        // Unknown tag.
        scanFeedback.play("exception");
        toast.error("Asset not found");
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
      }
    },
    onError: (e) => {
      scanFeedback.play("error");
      showError(e);
      setReturnScanValue("");
      returnScanInputRef.current?.focus();
    },
  });

  const handleScanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && scanValue.trim()) {
        e.preventDefault();
        scanMutation.mutate(scanValue.trim());
      }
    },
    [scanValue, scanMutation]
  );

  const handleDeployScanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && deployScanValue.trim()) {
        e.preventDefault();
        deployScanMutation.mutate(deployScanValue.trim());
      }
    },
    [deployScanValue, deployScanMutation]
  );

  const handleReturnScanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && returnScanValue.trim()) {
        e.preventDefault();
        returnScanMutation.mutate(returnScanValue.trim());
      }
    },
    [returnScanValue, returnScanMutation]
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

  // Fetch container assets from the configured case category
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
  const equipmentItems = lineItems.filter((item) => {
    if (item.type !== "EQUIPMENT") return false;
    if (item.isContainerLineItem) return false;
    if (item.isKitChild && isInternalStockLine(item.subHireId)) return false; // real kit children stay hidden
    // Hide sub-hire group parent wrappers — children show individually
    if (item.subHireId != null && !item.isKitChild && !item.kitId && (item.childLineItems?.length ?? 0) > 0) return false;
    return true;
  });

  // Per-stage counts for the lifecycle stepper (Pick/prep → … → De-prepped).
  const stageCounts = summarizeWarehouseStages(equipmentItems);

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

  const groupedPrep = groupItems(pickPrepItems, "prep", "prep");
  const groupedOut = groupItems(checkOutItemsList, "deploy", "prepped");
  // De-prep reuses the deploy grouping (same GroupEntry shape + selection keys).
  const groupedDeprep = groupItems(returnedItems, "deploy");

  // Group deploy items by container for visual sectioning
  const deployContainerGroups = useMemo(() => {
    const groups: Array<{ container: string | null; entries: typeof groupedOut }> = [];
    const containerMap = new Map<string | null, typeof groupedOut>();

    for (const entry of groupedOut) {
      const item = entry.kind === "serialized-group" ? entry.items[0] : entry.item;
      const container = item.prepContainer || null;
      if (!containerMap.has(container)) {
        containerMap.set(container, []);
      }
      containerMap.get(container)!.push(entry);
    }

    // Sort: named containers first (alphabetically), then ungrouped
    const sorted = Array.from(containerMap.entries()).sort(([a], [b]) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    });

    for (const [container, entries] of sorted) {
      groups.push({ container, entries });
    }
    return groups;
  }, [groupedOut]);

  // Group de-prep items by the container they came back in (visual sectioning).
  const deprepContainerGroups = useMemo(() => {
    const groups: Array<{ container: string | null; entries: typeof groupedDeprep }> = [];
    const containerMap = new Map<string | null, typeof groupedDeprep>();

    for (const entry of groupedDeprep) {
      const item = entry.kind === "serialized-group" ? entry.items[0] : entry.item;
      const container = item.prepContainer || null;
      if (!containerMap.has(container)) {
        containerMap.set(container, []);
      }
      containerMap.get(container)!.push(entry);
    }

    const sorted = Array.from(containerMap.entries()).sort(([a], [b]) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    });

    for (const [container, entries] of sorted) {
      groups.push({ container, entries });
    }
    return groups;
  }, [groupedDeprep]);

  const groupedIn = groupCheckinItems(checkedOutItems);

  // Group return items by container for visual sectioning
  const returnContainerGroups = useMemo(() => {
    const groups: Array<{ container: string | null; entries: typeof groupedIn }> = [];
    const containerMap = new Map<string | null, typeof groupedIn>();

    for (const entry of groupedIn) {
      const item = entry.kind === "serialized-group" ? entry.items[0] : entry.item;
      const container = item.prepContainer || null;
      if (!containerMap.has(container)) {
        containerMap.set(container, []);
      }
      containerMap.get(container)!.push(entry);
    }

    const sorted = Array.from(containerMap.entries()).sort(([a], [b]) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    });

    for (const [container, entries] of sorted) {
      groups.push({ container, entries });
    }
    return groups;
  }, [groupedIn]);

  // Build all selectable keys for pick/prep
  const allPrepKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of groupedPrep) {
      if (entry.kind === "single") {
        keys.push(entry.item.id);
      } else if (entry.kind === "serialized-group") {
        entry.items.forEach((i) => keys.push(i.id));
      } else if (entry.kind === "kit-group" || entry.kind === "accessory-group") {
        keys.push(entry.item.id);
      } else {
        for (let u = 0; u < entry.unitCount; u++) keys.push(bulkUnitKey(entry.item.id, u));
      }
    }
    return keys;
  }, [groupedPrep]);

  // Build all selectable keys for check-out
  const allOutKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of groupedOut) {
      if (entry.kind === "single") {
        keys.push(entry.item.id);
      } else if (entry.kind === "serialized-group") {
        entry.items.forEach((i) => keys.push(i.id));
      } else if (entry.kind === "kit-group" || entry.kind === "accessory-group") {
        keys.push(entry.item.id);
      } else {
        for (let u = 0; u < entry.unitCount; u++) keys.push(bulkUnitKey(entry.item.id, u));
      }
    }
    return keys;
  }, [groupedOut]);

  const allDeprepKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of groupedDeprep) {
      if (entry.kind === "single") {
        keys.push(entry.item.id);
      } else if (entry.kind === "serialized-group") {
        entry.items.forEach((i) => keys.push(i.id));
      } else if (entry.kind === "kit-group" || entry.kind === "accessory-group") {
        keys.push(entry.item.id);
      } else {
        for (let u = 0; u < entry.unitCount; u++) keys.push(bulkUnitKey(entry.item.id, u));
      }
    }
    return keys;
  }, [groupedDeprep]);

  const allInKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of groupedIn) {
      if (entry.kind === "single") {
        keys.push(entry.item.id);
      } else if (entry.kind === "serialized-group") {
        entry.items.forEach((i) => keys.push(i.id));
      } else if (entry.kind === "kit-group" || entry.kind === "accessory-group") {
        keys.push(entry.item.id);
      } else {
        for (let u = 0; u < entry.unitCount; u++) keys.push(bulkUnitKey(entry.item.id, u));
      }
    }
    return keys;
  }, [groupedIn]);

  const selectedPrepCount = selectedPrep.size;
  const selectedOutCount = selectedOut.size;
  const selectedDeprepCount = selectedDeprep.size;
  const selectedInCount = selectedIn.size;

  // --- Prep selected items (for manual selection without scanner) ---
  const handlePrepSelected = async () => {
    try {
      // If prepping into a container asset, ensure it's on the project
      await ensureContainerIfNeeded();

      const items: { lineItemId: string; assetId?: string; quantity?: number }[] = [];
      const kitLineItemIds: string[] = [];
      const bulkItems: { lineItemId: string; quantity: number }[] = [];

      for (const key of selectedPrep) {
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
          setAssetPickerItems(pickerItems);
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
      for (const kitItemId of kitLineItemIds) {
        const li = lineItems.find((l) => l.id === kitItemId);
        if (li?.kitId) {
          const children = (li.childLineItems || []) as LineItem[];
          const allIds = collectAllVerifiableIds(children, "deploy");
          const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));

          if (allIds.length > 0 && verifiedIds.length < allIds.length) {
            // Not fully verified — prompt the user
            setKitConfirm({
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
      }> = [];
      for (const bi of bulkNoCheckItems) {
        directPrepItems.push({
          lineItemId: bi.lineItemId,
          quantity: bi.quantity,
          prepContainer: selectedContainer || null,
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
        });
      }
      if (directPrepItems.length > 0) {
        await prepItemsBatch(projectId, directPrepItems);
      }

      // Start check queue if any items need checks
      const allChecks = [...readyCheckQueue, ...bulkCheckQueue];
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
        const verifiedAccessoryIds = verified
          .map((c) => c.assetId ?? c.bulkAssetId ?? "")
          .filter((v): v is string => v !== "");
        return { li, verifiedCount: verified.length, totalCount: packed.length, verifiedAccessoryIds };
      }
    }
    return null;
  }

  const handleCheckOutSelected = async () => {
    const bulkQtyMap = new Map<string, number>();
    const serializedLineItemIds: string[] = [];
    const kitLineItemIds: string[] = [];

    for (const key of selectedOut) {
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

    const { missingDefaults, missingOptionals } = computeMissingAccessories(serializedLineItemIds);
    if (missingDefaults.length > 0 || missingOptionals.length > 0) {
      setDefaultOverrideReason(isManagerTier ? "Manager override — deployed without full verification" : "");
      setOptionalSkipReasons({});
      setAccessoryGate({ pendingCheckOutItems: items, missingDefaults, missingOptionals });
      return;
    }

    const partial = findPartiallyVerifiedAccessoryParent(serializedLineItemIds);
    if (partial) {
      const rest = items.filter((i) => i.lineItemId !== partial.li.id);
      if (rest.length > 0) runCheckOut(rest);
      setAccessoryVerifyConfirm({
        parentLineItemId: partial.li.id,
        parentAssetId: partial.li.assetId || undefined,
        parentName: modelDisplayName(partial.li),
        verifiedCount: partial.verifiedCount,
        totalCount: partial.totalCount,
        verifiedAccessoryIds: partial.verifiedAccessoryIds,
      });
      return;
    }

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
    try {
      await warehouseWrites.logAccessoryCheckoutOverride(projectId, parentName, skipped);
    } catch {
      // Never let the audit trail write block the actual deploy.
    }
    setAccessoryGate(null);
    setDefaultOverrideReason("");
    setOptionalSkipReasons({});
    runCheckOut(pendingCheckOutItems);
  };

  // De-prep selected returned items: run return checks where the model has them,
  // otherwise deprep straight back into inventory. Drives the De-prep tab.
  const handleDeprep = (ids: Set<string>) => {
    if (ids.size === 0) return;
    const bulkDeprepMap = new Map<string, number>();
    const directIds: string[] = [];
    ids.forEach((id) => {
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
      })),
    )
      .then(() => {
        toast.success("Items prepped — ready to deploy");
        invalidate();
      })
      .catch((e) => showError(e));
  };

  const handleReturnSelected = () => {
    const qtyMap = new Map<string, number>();
    const kitIds: string[] = [];

    for (const key of selectedIn) {
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
          <p className="text-ui-text font-medium text-ink">Project not found</p>
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
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/warehouse" aria-label="Back to warehouse">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="t-mono text-muted">{project.projectNumber}</span>
            <StatusIndicator category="project" value={project.status} label={statusLabels[project.status] || project.status} variant="pill" />
          </div>
          <h1 className="t-title text-ink">{project.name}</h1>
          {project.client && <p className="text-muted">{project.client.name}</p>}
        </div>
        <div className="flex gap-2">
          {/* Scan audio toggle — shared across prep/deploy/return scan verdicts */}
          <ScanAudioToggle enabled={scanFeedback.enabled} onToggle={scanFeedback.toggle} />
          {/* Mobile: Pick List button shown prominently */}
          <Button variant="line" className="sm:hidden" onClick={() => setPickListOpen(true)}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Pick list
          </Button>
          {/* Mobile: Pull Slip as secondary */}
          <Button variant="line" size="icon" className="sm:hidden" aria-label="Print pull slip" onClick={() => window.open(`/api/documents/${projectId}?type=pull-slip`, "_blank")}>
            <Printer className="h-4 w-4" />
          </Button>
          {/* Desktop: Documents dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="line" className="hidden sm:flex">
                <FileText className="mr-2 h-4 w-4" />
                Documents
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=pull-slip`, "_blank")}>
                Pull slip
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=delivery-docket`, "_blank")}>
                Delivery docket
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=return-sheet`, "_blank")}>
                Return sheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Desktop: View Project button */}
          <Button variant="line" className="hidden sm:flex" asChild>
            <Link href={`/projects/${projectId}`}>
              <ExternalLink className="mr-2 h-4 w-4" />
              View project
            </Link>
          </Button>
          {/* Desktop: more menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="line" size="icon" className="hidden sm:flex" aria-label="More actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setPickListOpen(true)}>
                <ClipboardList className="mr-2 h-4 w-4" />
                Online pick list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Online Pick List Dialog */}
      <Dialog open={pickListOpen} onOpenChange={setPickListOpen}>
        <DialogContent className={isMobile ? "h-[100dvh] max-h-[100dvh] w-full max-w-full rounded-none border-0 flex flex-col" : "sm:max-w-lg"} style={isMobile ? { paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))", paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" } : undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Pick list
            </DialogTitle>
          </DialogHeader>
          <div className={`overflow-y-auto ${isMobile ? "flex-1" : "max-h-[70vh]"}`}>
            <OnlinePickList projectId={projectId} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Lifecycle stepper — where every piece of this job's gear sits, left to
          right. Returned gear shows in its own stage, never folded back into
          Prep or Deploy. */}
      <FadeIn>
        <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] px-4 py-3">
          <WarehouseLifecycle counts={stageCounts} />
        </div>
      </FadeIn>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="pick-prep">
            <ScanBarcode className="mr-1.5 h-4 w-4" />
            Pick ({pickPrepItems.length})
          </TabsTrigger>
          <TabsTrigger value="check-out">
            <PackageCheck className="mr-1.5 h-4 w-4" />
            Prepped ({preppedItems.length})
          </TabsTrigger>
          <TabsTrigger value="check-in">
            <Truck className="mr-1.5 h-4 w-4" />
            Deployed ({checkedOutItems.length})
          </TabsTrigger>
          <TabsTrigger value="deprep">
            <PackageX className="mr-1.5 h-4 w-4" />
            Returned ({returnedItems.length})
          </TabsTrigger>
          <TabsTrigger value="deprepped">
            <PackageOpen className="mr-1.5 h-4 w-4" />
            De-prepped ({deprepedItems.length})
          </TabsTrigger>
          <TabsTrigger value="close-out">
            <PackageCheck className="mr-1.5 h-4 w-4" />
            Close-out
          </TabsTrigger>
        </TabsList>

        {/* Pick/Prep Tab */}
        <PickPrepTab
          scanInputRef={scanInputRef}
          scanValue={scanValue}
          setScanValue={setScanValue}
          handleScanKeyDown={handleScanKeyDown}
          scanMutationMutate={(v) => scanMutation.mutate(v)}
          scanMutationIsPending={scanMutation.isPending}
          selectedContainer={selectedContainer}
          setSelectedContainer={setSelectedContainer}
          containerOptions={containerOptions}
          selectedPrep={selectedPrep}
          setSelectedPrep={setSelectedPrep}
          selectedPrepCount={selectedPrepCount}
          allPrepKeys={allPrepKeys}
          pickPrepItems={pickPrepItems}
          groupedPrep={groupedPrep}
          verifiedKitItems={verifiedKitItems}
          setVerifiedKitItems={setVerifiedKitItems}
          expandedGroups={expandedGroups}
          toggleExpanded={toggleExpanded}
          handlePrepSelected={handlePrepSelected}
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />

        {/* Deploy Tab */}
        <DeployTab
          deployScanInputRef={deployScanInputRef}
          deployScanValue={deployScanValue}
          setDeployScanValue={setDeployScanValue}
          handleDeployScanKeyDown={handleDeployScanKeyDown}
          deployScanMutationMutate={(v) => deployScanMutation.mutate(v)}
          deployScanMutationIsPending={deployScanMutation.isPending}
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
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />

        {/* De-prep Tab — returned gear, run return checks, back to inventory */}
        <DeployTab
          mode="deprep"
          deployScanInputRef={deployScanInputRef}
          deployScanValue={deployScanValue}
          setDeployScanValue={setDeployScanValue}
          handleDeployScanKeyDown={handleDeployScanKeyDown}
          deployScanMutationMutate={(v) => deployScanMutation.mutate(v)}
          deployScanMutationIsPending={deployScanMutation.isPending}
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
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />

        {/* Return Tab */}
        <ReturnTab
          returnScanInputRef={returnScanInputRef}
          returnScanValue={returnScanValue}
          setReturnScanValue={setReturnScanValue}
          handleReturnScanKeyDown={handleReturnScanKeyDown}
          returnScanMutationMutate={(v) => returnScanMutation.mutate(v)}
          returnScanMutationIsPending={returnScanMutation.isPending}
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
          toggleSelection={toggleSelection}
          toggleGroupSelection={toggleGroupSelection}
          toggleAll={toggleAll}
          renderGroupHeader={renderGroupHeader}
        />

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
                        <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
                        <TableCell>
                          <Badge status="ok" className="bg-ok-soft text-ok">Back in inventory</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {/* Move back a stage: re-pack this returned item (→ Returned). */}
                          <Button
                            variant="line"
                            size="sm"
                            onClick={() => undeprepMutation.mutate(item.id)}
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
        <Dialog open={true} onOpenChange={() => setKitConfirm(null)}>
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
              <Button variant="line" size="sm" onClick={() => setKitConfirm(null)}>
                Cancel
              </Button>
              {kitConfirm.verifiedCount > 0 && (
                <Button
                  variant="line"
                  size="sm"
                  onClick={() => {
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
                    setKitConfirm(null);
                  }}
                >
                  {kitConfirm.action === "deploy" ? "Prep" : "Return"} Verified ({kitConfirm.verifiedCount})
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  const kitLi = lineItems.find((l) => l.kitId === kitConfirm.kitId && !l.isKitChild);
                  const rc = returnCondition as "GOOD" | "DAMAGED" | "MISSING";
                  const started = kitLi
                    ? startKitCheckFlow(kitConfirm.kitId, kitLi, kitConfirm.action === "deploy" ? "PREP" : "RETURN", rc)
                    : false;
                  if (!started) {
                    if (kitConfirm.action === "deploy") {
                      // No checks — prep all items
                      toast.success(`Kit prepped: ${kitConfirm.kitName}`);
                      invalidate();
                    } else {
                      kitCheckInMutation.mutate({ kitId: kitConfirm.kitId, returnCondition: rc });
                    }
                  }
                  setKitConfirm(null);
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
                        {d.accessoryName} <span className="text-faint">— {d.parentName}</span>
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
                          {o.accessoryName} <span className="text-faint">— {o.parentName}</span>
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
                  runCheckOut([{
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
                  runCheckOut([{
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

      {/* Add to Project Prompt */}
      <Dialog open={addPromptOpen} onOpenChange={setAddPromptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to project?</DialogTitle>
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
              Select which specific asset to deploy for each item.
            </p>
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
                      setAssetPickerItems((prev) =>
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
      {/* Check Form Sheet */}
      {checkFormData && (
        <ItemCheckForm
          open={checkFormOpen}
          onOpenChange={(open) => {
            if (!open) {
              setCheckFormOpen(false);
              setCheckFormData(null);
              setCheckQueue([]);
              setCheckQueueIndex(0);
            }
          }}
          modelId={checkFormData.modelId}
          kitId={checkFormData.kitId}
          assetTag={checkFormData.assetTag}
          assetName={checkFormData.assetName}
          context={checkFormData.context}
          isSubmitting={checkFormSubmitting}
          queuePosition={checkQueue.length > 1 ? checkQueueIndex + 1 : undefined}
          queueTotal={checkQueue.length > 1 ? checkQueue.length : undefined}
          onCancel={() => {
            setCheckFormOpen(false);
            setCheckFormData(null);
            setCheckQueue([]);
            setCheckQueueIndex(0);
          }}
          onPassAllRemaining={checkQueue.length > 1 ? async () => {
            // Auto-pass all remaining items in the queue (including current)
            setCheckFormSubmitting(true);
            try {
              const remaining = checkQueue.slice(checkQueueIndex);
              for (const item of remaining) {
                const isKitLevelItem = !!item.kitId;
                const isKitQueueChild = !!item.kitQueueKitId && !item.kitId;

                // Fetch check items (kit-level or model-level)
                const checkItems = isKitLevelItem
                  ? await wConvex.query(convexApi.kitCheckItems.assignmentsForKit, { orgId: orgId as string, kitId: item.kitId! })
                  : await wConvex.query(convexApi.modelCheckItems.assignmentsForModel, { orgId: orgId as string, modelId: item.modelId! });
                const checks: CheckRecordFormValues[] = (checkItems as Array<{ checkItem: { id: string; type: string } }>).map((mci) => ({
                  checkItemId: mci.checkItem.id,
                  result: mci.checkItem.type === "NOTES" ? "NOTES_ONLY" as const : "PASS" as const,
                  photos: [],
                }));

                // Empty-checks guard (mirrors the PR #120 form guard for the
                // "pass all remaining" path). The completeCheck*/saveKit* server
                // actions enforce checks.min(1) and 500 on an empty array. The
                // cached project's _count.modelCheckItems gate that queued this
                // item can diverge from the live getModelCheckItems fetch above
                // (e.g. an admin removed the model's check items after the
                // warehouse page cached the project), leaving `checks` empty.
                // Route those items through their no-check equivalent instead of
                // crashing — items with no checks are meant to flow through
                // prepItemDirect / checkInItems, not the check actions.
                if (checks.length === 0) {
                  if (isKitLevelItem || isKitQueueChild) {
                    // Kit deploy/return is finalized in finishCheckQueue — there
                    // is nothing to record here, so just skip the save.
                    continue;
                  }
                  if (item.context === "PREP") {
                    await prepItemDirect(
                      projectId,
                      item.lineItemId,
                      item.assetId || undefined,
                      item.assetId ? undefined : 1,
                      selectedContainer || null,
                    );
                  } else if (item.fromDeprep) {
                    // completeCheckAndDeprep tolerates an empty checks[] (it
                    // does not re-parse against a .min(1) schema).
                    await checkRecordWrites.completeCheckAndDeprep({
                      projectId,
                      lineItemId: item.lineItemId,
                      assetId: item.assetId,
                      bulkAssetId: item.bulkAssetId,
                      checks,
                    });
                  } else {
                    // RETURN store with no checks — return to inventory via the
                    // no-check check-in path (same as finishCheckQueue's direct
                    // items) rather than completeCheckAndStore (min(1)).
                    await warehouseWrites.checkInItems(projectId, [
                      {
                        lineItemId: item.lineItemId,
                        assetId: item.assetId || undefined,
                        returnCondition: "GOOD",
                        quantity: item.assetId ? undefined : 1,
                      },
                    ]);
                  }
                  continue;
                }

                if (isKitLevelItem) {
                  // Kit-level: save records only, deploy happens in finishCheckQueue
                  await checkRecordWrites.saveKitLevelChecks(projectId, item.kitId!, item.lineItemId, item.context, checks);
                } else if (isKitQueueChild) {
                  // PER_ITEM child: save records only, deploy happens in finishCheckQueue
                  await checkRecordWrites.saveChildItemChecks(projectId, item.lineItemId, item.assetId || undefined, item.bulkAssetId, item.context, checks);
                } else if (item.context === "PREP") {
                  await pullItem(projectId, item.lineItemId).catch(() => {});
                  await checkRecordWrites.completeCheckAndPack({
                    projectId,
                    lineItemId: item.lineItemId,
                    assetId: item.assetId,
                    bulkAssetId: item.bulkAssetId,
                    prepContainer: selectedContainer || null,
                    checks,
                    includeAccessoryIds: item.includeAccessoryIds,
                  });
                } else if (item.fromDeprep) {
                  await checkRecordWrites.completeCheckAndDeprep({
                    projectId,
                    lineItemId: item.lineItemId,
                    assetId: item.assetId,
                    bulkAssetId: item.bulkAssetId,
                    checks,
                  });
                } else {
                  await unpackItem(projectId, item.lineItemId).catch(() => {});
                  await checkRecordWrites.completeCheckAndStore({
                    projectId,
                    lineItemId: item.lineItemId,
                    assetId: item.assetId,
                    bulkAssetId: item.bulkAssetId,
                    checks,
                    condition: "GOOD",
                  });
                }
              }
              toast.success(`Passed all checks for ${remaining.length} item${remaining.length !== 1 ? "s" : ""}`);
              finishCheckQueue();
            } catch (e) {
              showError(e, { fallbackTitle: "Pass all failed" });
            } finally {
              setCheckFormSubmitting(false);
            }
          } : undefined}
          onSubmit={async (checks: CheckRecordFormValues[], returnInfo?: { condition: "GOOD" | "DAMAGED" | "MISSING"; notes?: string }) => {
            if (!checkFormData) return;
            setCheckFormSubmitting(true);
            try {
              const hasFails = checks.some((c) => c.result === "FAIL");
              const isKitLevelItem = !!checkFormData.kitId;
              const isKitQueueChild = !!checkFormData.kitQueueKitId && !checkFormData.kitId;

              if (isKitLevelItem) {
                // Kit-level check: save records, then deploy/return in finishCheckQueue
                await checkRecordWrites.saveKitLevelChecks(projectId, checkFormData.kitId!, checkFormData.lineItemId, checkFormData.context, checks);
                toast.success(hasFails ? "Kit check completed with issues" : "Kit check passed");
              } else if (isKitQueueChild) {
                // PER_ITEM child: save records only, deploy/return happens in finishCheckQueue
                await checkRecordWrites.saveChildItemChecks(
                  projectId,
                  checkFormData.lineItemId,
                  checkFormData.assetId || undefined,
                  checkFormData.bulkAssetId,
                  checkFormData.context,
                  checks
                );
                toast.success(hasFails ? "Item check completed with issues" : "Item check passed");
              } else if (checkFormData.context === "PREP") {
                if (hasFails) {
                  await checkRecordWrites.completeCheckAndFlag({
                    projectId,
                    lineItemId: checkFormData.lineItemId,
                    assetId: checkFormData.assetId,
                    bulkAssetId: checkFormData.bulkAssetId,
                    checks,
                    flagType: "FLAGGED_FAULTY",
                  });
                  toast.success("Item flagged as faulty");
                } else {
                  await checkRecordWrites.completeCheckAndPack({
                    projectId,
                    lineItemId: checkFormData.lineItemId,
                    assetId: checkFormData.assetId,
                    bulkAssetId: checkFormData.bulkAssetId,
                    prepContainer: selectedContainer || null,
                    checks,
                    includeAccessoryIds: checkFormData.includeAccessoryIds,
                  });
                  toast.success("Item checked and packed");
                }
              } else if (checkFormData.fromDeprep) {
                // RETURN deprep — item is already returned, just record checks and reset prepStatus
                await checkRecordWrites.completeCheckAndDeprep({
                  projectId,
                  lineItemId: checkFormData.lineItemId,
                  assetId: checkFormData.assetId,
                  bulkAssetId: checkFormData.bulkAssetId,
                  checks,
                });
                toast.success("Item checked and returned to inventory");
              } else {
                // RETURN — condition comes from the check form
                const condition = returnInfo?.condition || "GOOD";
                await checkRecordWrites.completeCheckAndStore({
                  projectId,
                  lineItemId: checkFormData.lineItemId,
                  assetId: checkFormData.assetId,
                  bulkAssetId: checkFormData.bulkAssetId,
                  checks,
                  condition,
                  notes: returnInfo?.notes || undefined,
                });
                const condLabel = condition === "GOOD" ? "stored" : condition === "DAMAGED" ? "flagged damaged" : "flagged missing";
                toast.success(`Item checked and ${condLabel}`);
              }

              // Advance queue or close
              if (checkQueue.length > 1) {
                advanceCheckQueue();
                invalidate();
              } else {
                // Single item or last in queue — finish
                finishCheckQueue();
              }
            } catch (e) {
              showError(e, { fallbackTitle: "Check submission failed" });
            } finally {
              setCheckFormSubmitting(false);
            }
          }}
        />
      )}
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
