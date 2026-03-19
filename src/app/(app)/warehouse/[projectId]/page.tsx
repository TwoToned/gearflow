"use client";

import { Fragment, use, useState, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScanBarcode,
  ChevronRight,
  Package,
  ArrowLeft,
  Printer,
  PackageCheck,
  PackageX,
  Container,
  CircleCheck,
  Circle,
  ClipboardList,
  MoreVertical,
  FileText,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import {
  getProjectForWarehouse,
  lookupAssetForScan,
  checkOutItems,
  checkInItems,
  checkOutKit,
  checkInKit,
  getAvailableAssetsForModel,
  quickAddAndCheckOut,
} from "@/server/warehouse";
import { lineItemStatusLabels, formatLabel } from "@/lib/status-labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
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
import { OnlinePickList } from "@/components/warehouse/online-pick-list";
import { PrepsTab } from "@/components/warehouse/preps-tab";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveOrganization } from "@/lib/auth-client";

const statusColors: Record<string, string> = {
  ENQUIRY: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  QUOTING: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  QUOTED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  PREPPING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  ON_SITE: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  COMPLETED: "bg-green-500/10 text-green-500 border-green-500/20",
  INVOICED: "bg-green-500/10 text-green-500 border-green-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
};

const statusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

const lineItemStatusColors: Record<string, string> = {
  QUOTED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  PREPPED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  PACKED: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
};

interface LineItem {
  id: string;
  type: string;
  status: string;
  quantity: number;
  checkedOutQuantity: number;
  returnedQuantity: number;
  description: string | null;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  parentLineItemId: string | null;
  model: { name: string; modelNumber?: string | null } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit: { id: string; assetTag: string; name: string; isPrep: boolean } | null;
  isSubhire: boolean;
  childLineItems?: LineItem[];
}

interface AvailableAsset {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  customName: string | null;
}

function isBulkItem(item: LineItem) {
  return !!item.bulkAssetId || (!item.assetId && item.quantity > 1);
}

function modelDisplayName(item: LineItem) {
  if (!item.model) return item.description || "Unnamed item";
  return [item.model.name, item.model.modelNumber].filter(Boolean).join(" - ");
}

// ---------------------------------------------------------------------------
// Render kit children (with nested kit support for prep-kits)
// ---------------------------------------------------------------------------
function KitChildRows({
  kitChildren,
  verifiedKitItems,
  expandedGroups,
  toggleExpanded,
  onToggleVerify,
  mode,
}: {
  kitChildren: LineItem[];
  verifiedKitItems: Set<string>;
  expandedGroups: Set<string>;
  toggleExpanded: (key: string) => void;
  onToggleVerify: (assetId: string) => void;
  mode: "deploy" | "return";
}) {
  return (
    <>
      {kitChildren.map((child) => {
        const isVerified = verifiedKitItems.has(child.id);
        const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
        const nestedExpanded = expandedGroups.has(`nested-${child.id}`);

        // Filter nested kit grandchildren based on deploy/return mode
        const allGrandchildren = isNestedKit ? (child.childLineItems as LineItem[]) : [];
        const filteredGrandchildren = isNestedKit
          ? mode === "deploy"
            ? allGrandchildren.filter((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED")
            : allGrandchildren.filter((gc) => gc.status === "CHECKED_OUT")
          : [];

        // For nested kits: detect partial deployment
        const nestedKitPartial = isNestedKit
          && allGrandchildren.some((gc) => gc.status === "CHECKED_OUT")
          && allGrandchildren.some((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED");

        // Skip nested kits with no relevant grandchildren in this mode
        // (but still show regular items based on the parent's filtering)
        if (isNestedKit && filteredGrandchildren.length === 0) return null;

        return (
          <Fragment key={child.id}>
            <TableRow
              className={`${isVerified ? "bg-green-500/5" : "bg-muted/30"} ${isNestedKit ? "cursor-pointer" : ""}`}
              onClick={isNestedKit ? () => toggleExpanded(`nested-${child.id}`) : undefined}
            >
              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => onToggleVerify(child.id)} className="mx-auto block">
                  {isVerified
                    ? <CircleCheck className="h-4 w-4 text-green-500" />
                    : <Circle className="h-4 w-4 text-muted-foreground/30 hover:text-muted-foreground transition-colors" />
                  }
                </button>
              </TableCell>
              <TableCell className="pl-12 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  {isNestedKit && (
                    <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${nestedExpanded ? "rotate-90" : ""}`} />
                  )}
                  {isNestedKit && <Container className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span>{child.model?.name || child.description || "Item"}</span>
                  {isNestedKit && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Kit</Badge>
                  )}
                  {nestedKitPartial && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border-amber-500/20">Partial</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {child.asset?.assetTag || child.bulkAsset?.assetTag || (isNestedKit ? (child.kit?.assetTag || "—") : "—")}
              </TableCell>
              <TableCell className="text-center">{isNestedKit ? filteredGrandchildren.length : child.quantity}</TableCell>
              <TableCell>
                {isVerified
                  ? <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Verified</Badge>
                  : nestedKitPartial
                    ? <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">Partial</Badge>
                    : <Badge variant="outline" className={lineItemStatusColors[child.status] || ""}>{lineItemStatusLabels[child.status] || formatLabel(child.status)}</Badge>
                }
              </TableCell>
            </TableRow>
            {isNestedKit && nestedExpanded && filteredGrandchildren.map((nested) => {
              const nestedVerified = verifiedKitItems.has(nested.id);
              return (
                <TableRow key={nested.id} className={nestedVerified ? "bg-green-500/5" : "bg-muted/20"}>
                  <TableCell className="text-center">
                    <button type="button" onClick={() => onToggleVerify(nested.id)} className="mx-auto block">
                      {nestedVerified
                        ? <CircleCheck className="h-4 w-4 text-green-500" />
                        : <Circle className="h-4 w-4 text-muted-foreground/30 hover:text-muted-foreground transition-colors" />
                      }
                    </button>
                  </TableCell>
                  <TableCell className="pl-20 text-sm text-muted-foreground">
                    {nested.model?.name || nested.description || "Item"}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {nested.asset?.assetTag || nested.bulkAsset?.assetTag || "—"}
                  </TableCell>
                  <TableCell className="text-center">{nested.quantity}</TableCell>
                  <TableCell>
                    {nestedVerified
                      ? <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Verified</Badge>
                      : <Badge variant="outline" className={lineItemStatusColors[nested.status] || ""}>{lineItemStatusLabels[nested.status] || formatLabel(nested.status)}</Badge>
                    }
                  </TableCell>
                </TableRow>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Grouping: serialized items with same model get grouped, bulk items become
// expandable with per-unit rows, single serialized items stay flat.
// ---------------------------------------------------------------------------

type GroupEntry =
  | { kind: "single"; item: LineItem }
  | { kind: "serialized-group"; groupKey: string; modelName: string; items: LineItem[] }
  | { kind: "bulk-group"; groupKey: string; item: LineItem; unitCount: number }
  | { kind: "kit-group"; groupKey: string; item: LineItem; children: LineItem[] };

function isKitParent(item: LineItem) {
  return !!item.kitId && !item.isKitChild;
}

function collectAllVerifiableIds(children: LineItem[], mode: "deploy" | "return"): string[] {
  const ids: string[] = [];
  for (const child of children) {
    const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;

    if (isNestedKit) {
      // For nested kits, only count relevant grandchildren (not the nested kit parent itself)
      const grandchildren = child.childLineItems as LineItem[];
      const filtered = mode === "deploy"
        ? grandchildren.filter((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED")
        : grandchildren.filter((gc) => gc.status === "CHECKED_OUT");
      for (const gc of filtered) {
        ids.push(gc.id);
      }
    } else {
      // Regular child: include based on mode
      if (mode === "deploy" && child.status !== "CHECKED_OUT" && child.status !== "CANCELLED") {
        ids.push(child.id);
      } else if (mode === "return" && child.status === "CHECKED_OUT") {
        ids.push(child.id);
      }
    }
  }
  return ids;
}

function groupItems(items: LineItem[]): GroupEntry[] {
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
    } else if (isBulkItem(item)) {
      const remaining = item.quantity - item.checkedOutQuantity;
      const unitCount = item.status === "RETURNED" ? item.quantity : remaining;
      result.push({
        kind: "bulk-group",
        groupKey: `bulk-${item.id}`,
        item,
        unitCount: Math.max(unitCount, 0),
      });
    } else if (item.model) {
      const key = item.model.name + (item.model.modelNumber ? ` - ${item.model.modelNumber}` : "");
      const existing = serializedByModel.get(key);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        serializedByModel.set(key, arr);
        result.push({ kind: "serialized-group", groupKey: `ser-${key}`, modelName: key, items: arr });
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
    if (e.kind === "bulk-group" && e.unitCount <= 1) {
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
    } else if (isBulkItem(item)) {
      const remaining = item.checkedOutQuantity - item.returnedQuantity;
      result.push({
        kind: "bulk-group",
        groupKey: `bulk-in-${item.id}`,
        item,
        unitCount: Math.max(remaining, 0),
      });
    } else if (item.model) {
      const key = item.model.name + (item.model.modelNumber ? ` - ${item.model.modelNumber}` : "");
      const existing = serializedByModel.get(key);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        serializedByModel.set(key, arr);
        result.push({ kind: "serialized-group", groupKey: `ser-in-${key}`, modelName: key, items: arr });
      }
    } else {
      result.push({ kind: "single", item });
    }
  }

  return result.map((e) => {
    if (e.kind === "serialized-group" && e.items.length === 1) {
      return { kind: "single" as const, item: e.items[0] };
    }
    if (e.kind === "bulk-group" && e.unitCount <= 1) {
      return { kind: "single" as const, item: e.item };
    }
    return e;
  });
}

// Selection key helpers
// Serialized: just the lineItem id
// Bulk unit: `${lineItemId}:${unitIndex}`
function bulkUnitKey(lineItemId: string, unitIndex: number) {
  return `${lineItemId}:${unitIndex}`;
}

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
  const initialTab = tabParam === "check-in" ? "check-in" : tabParam === "preps" ? "preps" : "check-out";
  const queryClient = useQueryClient();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const returnScanInputRef = useRef<HTMLInputElement>(null);

  const [scanValue, setScanValue] = useState("");
  const [returnScanValue, setReturnScanValue] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [returnCondition, setReturnCondition] = useState("GOOD");
  const [returnNotes, setReturnNotes] = useState("");
  const [pickListOpen, setPickListOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Selection state
  const [selectedOut, setSelectedOut] = useState<Set<string>>(new Set());
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

  const { data: project, isLoading } = useQuery({
    queryKey: ["warehouse-project", orgId, projectId],
    queryFn: () => getProjectForWarehouse(projectId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["warehouse-project", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-prep-kits", orgId, projectId] });
    setSelectedOut(new Set());
    setSelectedIn(new Set());
  };

  const checkOutMutation = useMutation({
    mutationFn: (items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>) =>
      checkOutItems(projectId, items),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const checkInMutation = useMutation({
    mutationFn: (data: {
      items: Array<{ lineItemId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING"; quantity?: number; notes?: string }>;
    }) => checkInItems(projectId, data.items),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const quickAddMutation = useMutation({
    mutationFn: (data: { modelId: string; assetId?: string; bulkAssetId?: string; quantity?: number }) =>
      quickAddAndCheckOut(projectId, data),
    onSuccess: () => {
      invalidate();
      toast.success(`Added to project and deployed: ${addPromptData?.assetName || "Asset"}`);
      setAddPromptOpen(false);
      setAddPromptData(null);
      setScanValue("");
      scanInputRef.current?.focus();
    },
    onError: (e) => toast.error(e.message),
  });

  const kitCheckOutMutation = useMutation({
    mutationFn: (kitId: string) => checkOutKit(projectId, kitId),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const kitCheckInMutation = useMutation({
    mutationFn: (data: { kitId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }) =>
      checkInKit(projectId, data.kitId, data.returnCondition),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  // --- Scan mutations ---
  const scanMutation = useMutation({
    mutationFn: (assetTag: string) => lookupAssetForScan(projectId, assetTag, "checkout"),
    onSuccess: (result) => {
      // Handle kit scans
      if (result.found && result.type === "kit") {
        const kitResult = result as { kitId: string; kitAssetTag: string; assetName: string; lineItemId: string | null; reason: string | null };
        if (kitResult.lineItemId && !kitResult.reason) {
          // Check verification status before deploying
          const kitLi = lineItems.find((l) => l.kitId === kitResult.kitId && !l.isKitChild);
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
            kitCheckOutMutation.mutate(kitResult.kitId, {
              onSuccess: () => {
                toast.success(`Kit deployed: ${kitResult.assetName}`);
                setScanValue("");
                scanInputRef.current?.focus();
              },
            });
          }
        } else {
          const messages: Record<string, string> = {
            not_on_project: "Kit not assigned to this project",
            already_checked_out: "Kit already deployed",
          };
          toast.error(messages[kitResult.reason as string] || "Cannot deploy this kit");
          setScanValue("");
          scanInputRef.current?.focus();
        }
        return;
      }

      // Handle kit member scans — verify the item is present in the kit
      if (result.found && result.type === "kit_member") {
        const memberResult = result as { kitId: string | null; kitAssetTag: string | null; assetId: string | null; assetName: string };
        // Check if this kit is on the project
        const kitOnProject = memberResult.kitId && lineItems.find((li) => li.kitId === memberResult.kitId && !li.isKitChild);
        if (kitOnProject && memberResult.assetId) {
          // Find the child line item by assetId and verify by line item id
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
          // Auto-expand the kit group
          const kitGroupKey = `kit-${kitOnProject.id}`;
          setExpandedGroups((prev) => {
            const next = new Set(prev);
            next.add(kitGroupKey);
            return next;
          });
          toast.success(`Verified: ${memberResult.assetName}`);
        } else {
          toast.error(`This asset is in a kit${memberResult.kitAssetTag ? ` (${memberResult.kitAssetTag})` : ""} not on this project.`);
        }
        setScanValue("");
        scanInputRef.current?.focus();
        return;
      }

      if (result.found && result.lineItemId) {
        checkOutMutation.mutate([{
          lineItemId: result.lineItemId,
          ...(result.assetId ? { assetId: result.assetId } : {}),
        }], {
          onSuccess: () => {
            toast.success(`Deployed: ${result.assetName || "Asset"}`);
            setScanValue("");
            scanInputRef.current?.focus();
          },
        });
      } else if (result.found && !result.lineItemId) {
        if (result.reason === "not_on_project" && "modelId" in result && result.modelId) {
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
        const messages: Record<string, string> = {
          already_checked_out: "Already deployed on this project",
          asset_checked_out_elsewhere: `Already deployed${detail}`,
          not_on_project: "Asset not assigned to this project",
          not_checked_out: "Asset is not deployed on this project",
          already_returned: "All units already returned",
          asset_unavailable: `Asset is ${assetStatus.replace("_", " ").toLowerCase()} and cannot be deployed`,
        };
        toast.error(messages[result.reason as string] || "Cannot deploy this asset");
        setScanValue("");
        scanInputRef.current?.focus();
      } else {
        toast.error("Asset not found");
        setScanValue("");
        scanInputRef.current?.focus();
      }
    },
    onError: (e) => {
      toast.error(e.message);
      setScanValue("");
      scanInputRef.current?.focus();
    },
  });

  const returnScanMutation = useMutation({
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
            kitCheckInMutation.mutate(
              { kitId: kitResult.kitId, returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING" },
              {
                onSuccess: () => {
                  toast.success(`Kit returned: ${kitResult.assetName}`);
                  setReturnScanValue("");
                  setReturnNotes("");
                  returnScanInputRef.current?.focus();
                },
              }
            );
          }
        } else {
          const messages: Record<string, string> = {
            not_on_project: "Kit not assigned to this project",
            not_checked_out: "Kit is not deployed",
          };
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
          toast.success(`Verified: ${memberResult.assetName}`);
        } else {
          toast.error(`This asset is in a kit${memberResult.kitAssetTag ? ` (${memberResult.kitAssetTag})` : ""} not on this project.`);
        }
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
        return;
      }

      if (result.found && result.lineItemId) {
        checkInMutation.mutate(
          {
            items: [{
              lineItemId: result.lineItemId,
              returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
              notes: returnNotes || undefined,
            }],
          },
          {
            onSuccess: () => {
              toast.success(`Returned: ${result.assetName || "Asset"}`);
              setReturnScanValue("");
              setReturnNotes("");
              returnScanInputRef.current?.focus();
            },
          }
        );
      } else if (result.found && !result.lineItemId) {
        const messages: Record<string, string> = {
          not_checked_out: "Asset is not deployed on this project",
          not_on_project: "Asset not assigned to this project",
          already_returned: "All units already returned",
          already_checked_out: "Already deployed",
        };
        toast.error(messages[result.reason as string] || "Cannot return this asset");
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
      } else {
        toast.error("Asset not found");
        setReturnScanValue("");
        returnScanInputRef.current?.focus();
      }
    },
    onError: (e) => {
      toast.error(e.message);
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
  // Filter out kit children — they show under their parent row
  const equipmentItems = lineItems.filter((item) => item.type === "EQUIPMENT" && !item.isKitChild);

  const checkOutItemsList = equipmentItems.filter((item) => {
    if (item.status === "CANCELLED") return false;
    // Kit parents: show in deploy tab if any children/grandchildren still need deploying
    if (isKitParent(item)) {
      const children = (item.childLineItems || []) as LineItem[];
      return children.some((c) => {
        if (c.status !== "CHECKED_OUT" && c.status !== "CANCELLED") return true;
        // Nested kit: check grandchildren too
        if (c.kitId && c.childLineItems?.length) {
          return (c.childLineItems as LineItem[]).some(
            (gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED"
          );
        }
        return false;
      });
    }
    if (item.status === "RETURNED") return true;
    if (isBulkItem(item)) return item.checkedOutQuantity < item.quantity;
    return item.status !== "CHECKED_OUT";
  });

  const checkedOutItems = equipmentItems.filter((item) => {
    // Kit parents: show in return tab if any children/grandchildren are deployed
    if (isKitParent(item)) {
      const children = (item.childLineItems || []) as LineItem[];
      return children.some((c) => {
        if (c.status === "CHECKED_OUT") return true;
        // Nested kit: check grandchildren too
        if (c.kitId && c.childLineItems?.length) {
          return (c.childLineItems as LineItem[]).some((gc) => gc.status === "CHECKED_OUT");
        }
        return false;
      });
    }
    if (isBulkItem(item)) return item.checkedOutQuantity > item.returnedQuantity;
    return item.status === "CHECKED_OUT";
  });

  const groupedOut = groupItems(checkOutItemsList);

  const groupedIn = groupCheckinItems(checkedOutItems);

  // Build all selectable keys for check-out
  const allOutKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of groupedOut) {
      if (entry.kind === "single") {
        keys.push(entry.item.id);
      } else if (entry.kind === "serialized-group") {
        entry.items.forEach((i) => keys.push(i.id));
      } else if (entry.kind === "kit-group") {
        keys.push(entry.item.id);
      } else {
        for (let u = 0; u < entry.unitCount; u++) keys.push(bulkUnitKey(entry.item.id, u));
      }
    }
    return keys;
  }, [groupedOut]);

  const allInKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of groupedIn) {
      if (entry.kind === "single") {
        keys.push(entry.item.id);
      } else if (entry.kind === "serialized-group") {
        entry.items.forEach((i) => keys.push(i.id));
      } else if (entry.kind === "kit-group") {
        keys.push(entry.item.id);
      } else {
        for (let u = 0; u < entry.unitCount; u++) keys.push(bulkUnitKey(entry.item.id, u));
      }
    }
    return keys;
  }, [groupedIn]);

  const selectedOutCount = selectedOut.size;
  const selectedInCount = selectedIn.size;

  // --- Checkout / Checkin selected ---
  const handleCheckOutSelected = async () => {
    // Separate bulk keys (contain ":"), kit items, and serialized keys
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

    // Check out kits (including prep-kits) — check verification first
    for (const kitItemId of kitLineItemIds) {
      const li = lineItems.find((l) => l.id === kitItemId);
      if (li?.kitId) {
        const children = (li.childLineItems || []) as LineItem[];
        const allIds = collectAllVerifiableIds(children, "deploy");
        const verifiedIds = allIds.filter((id) => verifiedKitItems.has(id));
        if (allIds.length > 0 && verifiedIds.length < allIds.length) {
          // Not fully verified — prompt
          setKitConfirm({
            action: "deploy",
            kitName: li.description || li.kit?.name || "Kit",
            kitId: li.kitId,
            parentLineItemId: li.id,
            verifiedCount: verifiedIds.length,
            totalCount: allIds.length,
            verifiedIds,
          });
        } else {
          kitCheckOutMutation.mutate(li.kitId);
        }
      }
    }

    // If only kits were selected, we're done
    if (serializedLineItemIds.length === 0 && bulkQtyMap.size === 0) return;

    // Find serialized items that need asset assignment
    const unassignedSerialized = serializedLineItemIds
      .map((id) => lineItems.find((li) => li.id === id))
      .filter((li): li is LineItem => !!li && !li.assetId && !isBulkItem(li) && !!li.modelId && !li.isSubhire);

    const alreadyAssigned = serializedLineItemIds
      .map((id) => lineItems.find((li) => li.id === id))
      .filter((li): li is LineItem => !!li && (!!li.assetId || isBulkItem(li) || li.isSubhire));

    const bulkItems = Array.from(bulkQtyMap.entries()).map(([lineItemId, qty]) => ({
      lineItemId,
      quantity: qty,
    }));

    if (unassignedSerialized.length === 0) {
      // No asset picker needed — check out directly
      const items = [
        ...alreadyAssigned.map((li) => ({ lineItemId: li.id, assetId: li.assetId || undefined })),
        ...bulkItems,
      ];
      if (items.length === 0) return;
      checkOutMutation.mutate(items, {
        onSuccess: () => toast.success(`Checked out ${selectedOutCount} items`),
      });
      return;
    }

    // Fetch available assets for each unique modelId
    const uniqueModelIds = [...new Set(unassignedSerialized.map((li) => li.modelId!))];
    const assetsByModel = new Map<string, AvailableAsset[]>();

    try {
      const results = await Promise.all(
        uniqueModelIds.map(async (modelId) => {
          const assets = await getAvailableAssetsForModel(modelId);
          return { modelId, assets: assets as AvailableAsset[] };
        })
      );
      for (const { modelId, assets } of results) {
        assetsByModel.set(modelId, assets);
      }
    } catch {
      toast.error("Failed to load available assets");
      return;
    }

    // Open the picker dialog
    setAssetPickerItems(
      unassignedSerialized.map((li) => ({
        lineItemId: li.id,
        modelId: li.modelId!,
        modelName: modelDisplayName(li),
        availableAssets: assetsByModel.get(li.modelId!) || [],
        selectedAssetId: "",
      }))
    );
    setAssetPickerBulkItems(bulkItems);
    setAssetPickerOpen(true);
  };

  const handleAssetPickerConfirm = () => {
    // Validate all serialized items have an asset selected
    const incomplete = assetPickerItems.find((i) => !i.selectedAssetId);
    if (incomplete) {
      toast.error("Please select an asset for each item");
      return;
    }

    // Check for duplicate asset selections
    const selectedIds = assetPickerItems.map((i) => i.selectedAssetId);
    if (new Set(selectedIds).size !== selectedIds.length) {
      toast.error("Each item must have a different asset assigned");
      return;
    }

    // Also include already-assigned serialized items from the original selection
    const serializedLineItemIds = [...selectedOut].filter((k) => !k.includes(":"));
    const alreadyAssigned = serializedLineItemIds
      .map((id) => lineItems.find((li) => li.id === id))
      .filter((li): li is LineItem => !!li && !!li.assetId && !isBulkItem(li));

    const items = [
      ...assetPickerItems.map((i) => ({ lineItemId: i.lineItemId, assetId: i.selectedAssetId })),
      ...alreadyAssigned.map((li) => ({ lineItemId: li.id, assetId: li.assetId || undefined })),
      ...assetPickerBulkItems,
    ];

    setAssetPickerOpen(false);
    checkOutMutation.mutate(items, {
      onSuccess: () => toast.success(`Checked out ${selectedOutCount} items`),
    });
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

    // Return kits (including prep-kits) — check verification first
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
      kitCheckInMutation.mutate({
        kitId,
        returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
      });
    }

    // Return non-kit items
    const items = Array.from(qtyMap.entries()).map(([lineItemId, qty]) => ({
      lineItemId,
      returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
      quantity: qty,
      notes: returnNotes || undefined,
    }));
    if (items.length > 0) {
      checkInMutation.mutate(
        { items },
        { onSuccess: () => { toast.success(`Returned items`); setReturnNotes(""); } }
      );
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

    return (
      <TableRow
        className="cursor-pointer hover:bg-accent/50"
        onClick={() => toggleExpanded(entry.groupKey)}
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={allChecked || someChecked}
            indeterminate={someChecked && !allChecked}
            onCheckedChange={() => toggleGroupSelection(selection, setSelection, childKeys)}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
            <span className="font-medium">{name}</span>
                      </div>
        </TableCell>
        <TableCell className="font-mono text-sm text-muted-foreground">
          {entry.kind === "bulk-group" ? (entry.item.bulkAsset?.assetTag || "—") : ""}
        </TableCell>
        <TableCell className="text-center">{count}</TableCell>
        {qtyLabel}
      </TableRow>
    );
  }

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!project) return <div className="text-muted-foreground">Project not found.</div>;

  return (
    <RequirePermission resource="warehouse" action="read">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="icon-sm" render={<Link href="/warehouse" />}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-mono text-sm text-muted-foreground">{project.projectNumber}</span>
            <Badge variant="outline" className={statusColors[project.status] || ""}>
              {statusLabels[project.status] || project.status}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.client && <p className="text-muted-foreground">{project.client.name}</p>}
        </div>
        <div className="flex gap-2">
          {/* Mobile: Pick List button shown prominently */}
          <Button variant="outline" className="sm:hidden" onClick={() => setPickListOpen(true)}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Pick List
          </Button>
          {/* Mobile: Pull Slip as secondary */}
          <Button variant="outline" className="sm:hidden" onClick={() => window.open(`/api/documents/${projectId}?type=pull-slip`, "_blank")}>
            <Printer className="h-4 w-4" />
          </Button>
          {/* Desktop: Documents dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="hidden sm:flex" />}>
              <FileText className="mr-2 h-4 w-4" />
              Documents
              <ChevronDown className="ml-1 h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=pull-slip`, "_blank")}>
                Pull Slip
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=delivery-docket`, "_blank")}>
                Delivery Docket
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=return-sheet`, "_blank")}>
                Return Sheet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=quote`, "_blank")}>
                Quote / Proposal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/documents/${projectId}?type=invoice`, "_blank")}>
                Invoice
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Desktop: View Project button */}
          <Button variant="outline" className="hidden sm:flex" render={<Link href={`/projects/${projectId}`} />}>
            <ExternalLink className="mr-2 h-4 w-4" />
            View Project
          </Button>
          {/* Desktop: more menu */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="hidden sm:flex" />}>
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setPickListOpen(true)}>
                <ClipboardList className="mr-2 h-4 w-4" />
                Online Pick List
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
              Pick List
            </DialogTitle>
          </DialogHeader>
          <div className={`overflow-y-auto ${isMobile ? "flex-1" : "max-h-[70vh]"}`}>
            <OnlinePickList projectId={projectId} />
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="check-out">
            <PackageCheck className="mr-1.5 h-4 w-4" />
            Deploy ({checkOutItemsList.length})
          </TabsTrigger>
          <TabsTrigger value="check-in">
            <PackageX className="mr-1.5 h-4 w-4" />
            Return ({checkedOutItems.length})
          </TabsTrigger>
          <TabsTrigger value="preps">
            <Package className="mr-1.5 h-4 w-4" />
            Preps
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* CHECK OUT TAB                                                    */}
        {/* ================================================================ */}
        <TabsContent value="check-out">
          <div className="space-y-4 pt-4">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <ScanBarcode className="h-5 w-5 text-muted-foreground shrink-0 hidden sm:block" />
                  <div className="flex-1">
                    <Label htmlFor="scan-checkout" className="sr-only">Scan asset tag</Label>
                    <ScanInput
                      ref={scanInputRef}
                      id="scan-checkout"
                      placeholder="Scan or enter asset tag..."
                      value={scanValue}
                      onChange={(e) => setScanValue(e.target.value)}
                      onKeyDown={handleScanKeyDown}
                      onScan={(value) => scanMutation.mutate(value)}
                      scannerTitle="Scan asset to deploy"
                      continuous
                      disabled={scanMutation.isPending || checkOutMutation.isPending}
                      autoFocus
                    />
                  </div>
                  <Button
                    onClick={handleCheckOutSelected}
                    disabled={selectedOutCount === 0 || checkOutMutation.isPending}
                    className="shrink-0"
                  >
                    <span className="hidden sm:inline">Deploy</span>
                    <span className="sm:hidden">Deploy</span>
                    {selectedOutCount > 0 ? ` (${selectedOutCount})` : ""}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {checkOutItemsList.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  <p>All items deployed.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allOutKeys.length > 0 && (allOutKeys.every((k) => selectedOut.has(k)) || allOutKeys.some((k) => selectedOut.has(k)))}
                          indeterminate={allOutKeys.length > 0 && allOutKeys.some((k) => selectedOut.has(k)) && !allOutKeys.every((k) => selectedOut.has(k))}
                          onCheckedChange={() => toggleAll(selectedOut, setSelectedOut, allOutKeys)}
                        />
                      </TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Asset Tag</TableHead>
                      <TableHead className="text-center w-16">Qty</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedOut.map((entry) => {
                      // --- Serialized group ---
                      if (entry.kind === "serialized-group") {
                        const childKeys = entry.items.map((i) => i.id);
                        const isExpanded = expandedGroups.has(entry.groupKey);
                        return (
                          <Fragment key={entry.groupKey}>
                            {renderGroupHeader(
                              entry, childKeys, selectedOut, setSelectedOut,
                              <TableCell>
                                <Badge variant="outline" className={lineItemStatusColors[entry.items[0].status] || ""}>
                                  {entry.items[0].status}
                                </Badge>
                              </TableCell>
                            )}
                            {isExpanded && entry.items.map((item) => (
                              <TableRow key={item.id} className="bg-muted/30">
                                <TableCell>
                                  <Checkbox
                                    checked={selectedOut.has(item.id)}
                                    onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
                                  />
                                </TableCell>
                                <TableCell className="pl-12 text-sm text-muted-foreground">
                                  {item.asset?.assetTag ? `${item.model?.name || "Asset"}` : "Unassigned"}
      
                                </TableCell>
                                <TableCell className="font-mono text-sm text-muted-foreground">
                                  {item.asset?.assetTag || "—"}
                                </TableCell>
                                <TableCell className="text-center">1</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={lineItemStatusColors[item.status] || ""}>
                                    {lineItemStatusLabels[item.status] || formatLabel(item.status)}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      }

                      // --- Bulk group ---
                      if (entry.kind === "bulk-group") {
                        const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                        const isExpanded = expandedGroups.has(entry.groupKey);
                        const checkedCount = childKeys.filter((k) => selectedOut.has(k)).length;
                        return (
                          <Fragment key={entry.groupKey}>
                            {renderGroupHeader(
                              entry, childKeys, selectedOut, setSelectedOut,
                              <TableCell>
                                {checkedCount > 0 ? (
                                  <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20">
                                    {checkedCount} selected
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className={lineItemStatusColors[entry.item.status] || ""}>
                                    {lineItemStatusLabels[entry.item.status] || formatLabel(entry.item.status)}
                                  </Badge>
                                )}
                              </TableCell>
                            )}
                            {isExpanded && childKeys.map((key, idx) => (
                              <TableRow key={key} className="bg-muted/30">
                                <TableCell>
                                  <Checkbox
                                    checked={selectedOut.has(key)}
                                    onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, key)}
                                  />
                                </TableCell>
                                <TableCell className="pl-12 text-sm text-muted-foreground">
                                  Unit {idx + 1}
                                </TableCell>
                                <TableCell className="font-mono text-sm text-muted-foreground">
                                  {entry.item.bulkAsset?.assetTag || "—"}
                                </TableCell>
                                <TableCell className="text-center">1</TableCell>
                                <TableCell />
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      }

                      // --- Kit group ---
                      if (entry.kind === "kit-group") {
                        const isExpanded = expandedGroups.has(entry.groupKey);
                        const allIds = collectAllVerifiableIds(entry.children, "deploy");
                        const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                        const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                        // Detect partial deployment: parent is checked out but some children still need deploying
                        const allChildren = (entry.item.childLineItems || []) as LineItem[];
                        const isPartiallyDeployed = entry.item.status === "CHECKED_OUT" && allChildren.some((c) => c.status === "CHECKED_OUT");
                        return (
                          <Fragment key={entry.groupKey}>
                            <TableRow
                              className="cursor-pointer hover:bg-accent/50"
                              onClick={() => toggleExpanded(entry.groupKey)}
                            >
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selectedOut.has(entry.item.id)}
                                  onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, entry.item.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                  <Container className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium">{entry.item.description || entry.item.kit?.name || "Kit"}</span>
                                  <Badge variant="secondary" className={`ml-1 text-[10px] px-1.5 py-0 ${entry.item.kit?.isPrep ? "bg-purple-500/10 text-purple-500 border-purple-500/20" : ""}`}>
                                    {entry.item.kit?.isPrep ? "Prep" : "Kit"}
                                  </Badge>
                                  {allIds.length > 0 && (
                                    <Badge
                                      variant="outline"
                                      className={allVerified
                                        ? "ml-1 text-[10px] px-1.5 py-0 bg-green-500/10 text-green-500 border-green-500/20"
                                        : verifiedCount > 0
                                          ? "ml-1 text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border-amber-500/20"
                                          : "ml-1 text-[10px] px-1.5 py-0"
                                      }
                                    >
                                      {verifiedCount}/{allIds.length} verified
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-sm text-muted-foreground">
                                {entry.item.kit?.isPrep && entry.item.kit.assetTag.startsWith("PREP-") ? "—" : (entry.item.kit?.assetTag || "—")}
                              </TableCell>
                              <TableCell className="text-center">{entry.children.length}</TableCell>
                              <TableCell>
                                {isPartiallyDeployed ? (
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                                    Partial
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className={lineItemStatusColors[entry.item.status] || ""}>
                                    {lineItemStatusLabels[entry.item.status] || formatLabel(entry.item.status)}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <KitChildRows
                                kitChildren={entry.children}
                                verifiedKitItems={verifiedKitItems}
                                expandedGroups={expandedGroups}
                                toggleExpanded={toggleExpanded}
                                mode="deploy"
                                onToggleVerify={(assetId) => {
                                  setVerifiedKitItems((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(assetId)) next.delete(assetId);
                                    else next.add(assetId);
                                    return next;
                                  });
                                }}
                              />
                            )}
                          </Fragment>
                        );
                      }

                      // --- Single item ---
                      const item = entry.item;
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedOut.has(item.id)}
                              onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{modelDisplayName(item)}</span>
                            {item.isSubhire && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-600 border-cyan-500/20">Subhire</Badge>
                            )}

                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {item.asset?.assetTag || item.bulkAsset?.assetTag || "—"}
                          </TableCell>
                          <TableCell className="text-center">{item.quantity}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={lineItemStatusColors[item.status] || ""}>
                              {lineItemStatusLabels[item.status] || formatLabel(item.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* CHECK IN TAB                                                     */}
        {/* ================================================================ */}
        <TabsContent value="check-in">
          <div className="space-y-4 pt-4">
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center gap-3">
                  <ScanBarcode className="h-5 w-5 text-muted-foreground shrink-0 hidden sm:block" />
                  <div className="flex-1">
                    <Label htmlFor="scan-checkin" className="sr-only">Scan asset tag</Label>
                    <ScanInput
                      ref={returnScanInputRef}
                      id="scan-checkin"
                      placeholder="Scan or enter asset tag to return..."
                      value={returnScanValue}
                      onChange={(e) => setReturnScanValue(e.target.value)}
                      onKeyDown={handleReturnScanKeyDown}
                      onScan={(value) => returnScanMutation.mutate(value)}
                      scannerTitle="Scan asset to return"
                      continuous
                      disabled={returnScanMutation.isPending || checkInMutation.isPending}
                    />
                  </div>
                  <Button
                    onClick={handleReturnSelected}
                    disabled={selectedInCount === 0 || checkInMutation.isPending}
                    className="shrink-0"
                  >
                    <span className="hidden sm:inline">Return</span>
                    <span className="sm:hidden">In</span>
                    {selectedInCount > 0 ? ` (${selectedInCount})` : ""}
                  </Button>
                </div>
                <div className="flex items-center gap-4 pl-8">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="return-condition" className="text-sm">Condition:</Label>
                    <select
                      id="return-condition"
                      value={returnCondition}
                      onChange={(e) => setReturnCondition(e.target.value)}
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="GOOD">Good</option>
                      <option value="DAMAGED">Damaged</option>
                      <option value="MISSING">Missing</option>
                    </select>
                  </div>
                  {(returnCondition === "DAMAGED" || returnCondition === "MISSING") && (
                    <div className="flex-1">
                      <Textarea
                        placeholder="Notes about damage or missing items..."
                        value={returnNotes}
                        onChange={(e) => setReturnNotes(e.target.value)}
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {checkedOutItems.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  <p>No items currently deployed.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allInKeys.length > 0 && (allInKeys.every((k) => selectedIn.has(k)) || allInKeys.some((k) => selectedIn.has(k)))}
                          indeterminate={allInKeys.length > 0 && allInKeys.some((k) => selectedIn.has(k)) && !allInKeys.every((k) => selectedIn.has(k))}
                          onCheckedChange={() => toggleAll(selectedIn, setSelectedIn, allInKeys)}
                        />
                      </TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Asset Tag</TableHead>
                      <TableHead className="text-center w-16">Qty</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedIn.map((entry) => {
                      // --- Serialized group ---
                      if (entry.kind === "serialized-group") {
                        const childKeys = entry.items.map((i) => i.id);
                        const isExpanded = expandedGroups.has(entry.groupKey);
                        return (
                          <Fragment key={entry.groupKey}>
                            {renderGroupHeader(
                              entry, childKeys, selectedIn, setSelectedIn,
                              <TableCell>
                                <Badge variant="outline" className={lineItemStatusColors["CHECKED_OUT"]}>
                                  Deployed
                                </Badge>
                              </TableCell>
                            )}
                            {isExpanded && entry.items.map((item) => (
                              <TableRow key={item.id} className="bg-muted/30">
                                <TableCell>
                                  <Checkbox
                                    checked={selectedIn.has(item.id)}
                                    onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                                  />
                                </TableCell>
                                <TableCell className="pl-12 text-sm text-muted-foreground">
                                  {item.asset?.assetTag ? `${item.model?.name || "Asset"}` : "Unassigned"}
      
                                </TableCell>
                                <TableCell className="font-mono text-sm text-muted-foreground">
                                  {item.asset?.assetTag || "—"}
                                </TableCell>
                                <TableCell className="text-center">1</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={lineItemStatusColors["CHECKED_OUT"]}>
                                    Deployed
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      }

                      // --- Bulk group ---
                      if (entry.kind === "bulk-group") {
                        const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                        const isExpanded = expandedGroups.has(entry.groupKey);
                        const checkedCount = childKeys.filter((k) => selectedIn.has(k)).length;
                        return (
                          <Fragment key={entry.groupKey}>
                            {renderGroupHeader(
                              entry, childKeys, selectedIn, setSelectedIn,
                              <TableCell>
                                {checkedCount > 0 ? (
                                  <Badge variant="outline" className="bg-teal-500/10 text-teal-500 border-teal-500/20">
                                    {checkedCount} selected
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className={lineItemStatusColors["CHECKED_OUT"]}>
                                    Deployed
                                  </Badge>
                                )}
                              </TableCell>
                            )}
                            {isExpanded && childKeys.map((key, idx) => (
                              <TableRow key={key} className="bg-muted/30">
                                <TableCell>
                                  <Checkbox
                                    checked={selectedIn.has(key)}
                                    onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, key)}
                                  />
                                </TableCell>
                                <TableCell className="pl-12 text-sm text-muted-foreground">
                                  Unit {idx + 1}
                                </TableCell>
                                <TableCell className="font-mono text-sm text-muted-foreground">
                                  {entry.item.bulkAsset?.assetTag || "—"}
                                </TableCell>
                                <TableCell className="text-center">1</TableCell>
                                <TableCell />
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      }

                      // --- Kit group ---
                      if (entry.kind === "kit-group") {
                        const isExpanded = expandedGroups.has(entry.groupKey);
                        const allIds = collectAllVerifiableIds(entry.children, "return");
                        const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                        const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                        // Detect partial deployment: some children are deployed, others are not
                        const allChildren = (entry.item.childLineItems || []) as LineItem[];
                        const isPartiallyDeployed = allChildren.some((c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED");
                        return (
                          <Fragment key={entry.groupKey}>
                            <TableRow
                              className="cursor-pointer hover:bg-accent/50"
                              onClick={() => toggleExpanded(entry.groupKey)}
                            >
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selectedIn.has(entry.item.id)}
                                  onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, entry.item.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                  <Container className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium">{entry.item.description || entry.item.kit?.name || "Kit"}</span>
                                  <Badge variant="secondary" className={`ml-1 text-[10px] px-1.5 py-0 ${entry.item.kit?.isPrep ? "bg-purple-500/10 text-purple-500 border-purple-500/20" : ""}`}>
                                    {entry.item.kit?.isPrep ? "Prep" : "Kit"}
                                  </Badge>
                                  {allIds.length > 0 && (
                                    <Badge
                                      variant="outline"
                                      className={allVerified
                                        ? "ml-1 text-[10px] px-1.5 py-0 bg-green-500/10 text-green-500 border-green-500/20"
                                        : verifiedCount > 0
                                          ? "ml-1 text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border-amber-500/20"
                                          : "ml-1 text-[10px] px-1.5 py-0"
                                      }
                                    >
                                      {verifiedCount}/{allIds.length} verified
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-sm text-muted-foreground">
                                {entry.item.kit?.isPrep && entry.item.kit.assetTag.startsWith("PREP-") ? "—" : (entry.item.kit?.assetTag || "—")}
                              </TableCell>
                              <TableCell className="text-center">{entry.children.length}</TableCell>
                              <TableCell>
                                {isPartiallyDeployed ? (
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                                    Partial
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className={lineItemStatusColors["CHECKED_OUT"]}>
                                    Deployed
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <KitChildRows
                                kitChildren={entry.children}
                                verifiedKitItems={verifiedKitItems}
                                expandedGroups={expandedGroups}
                                toggleExpanded={toggleExpanded}
                                mode="return"
                                onToggleVerify={(assetId) => {
                                  setVerifiedKitItems((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(assetId)) next.delete(assetId);
                                    else next.add(assetId);
                                    return next;
                                  });
                                }}
                              />
                            )}
                          </Fragment>
                        );
                      }

                      // --- Single item ---
                      const item = entry.item;
                      const isBulk = isBulkItem(item);
                      const assetTag = item.asset?.assetTag || item.bulkAsset?.assetTag || null;
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIn.has(item.id)}
                              onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{modelDisplayName(item)}</span>
                            {item.isSubhire && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-600 border-cyan-500/20">Subhire</Badge>
                            )}

                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {assetTag || "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {isBulk ? (
                              <span>
                                <span className={item.returnedQuantity > 0 ? "font-semibold text-teal-600" : ""}>
                                  {item.returnedQuantity}
                                </span>
                                <span className="text-muted-foreground">/{item.checkedOutQuantity}</span>
                              </span>
                            ) : (
                              <span>1</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={lineItemStatusColors["CHECKED_OUT"]}>
                              Deployed
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* PREPS TAB                                                        */}
        {/* ================================================================ */}
        <TabsContent value="preps">
          <PrepsTab projectId={projectId} />
        </TabsContent>
      </Tabs>

      {/* Kit Verification Confirmation */}
      {kitConfirm && (
        <Dialog open={true} onOpenChange={() => setKitConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {kitConfirm.action === "deploy" ? "Deploy without full verification?" : "Return without full verification?"}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{kitConfirm.kitName}</span> has{" "}
              <span className="font-medium text-foreground">{kitConfirm.verifiedCount}/{kitConfirm.totalCount}</span>{" "}
              items verified. You can {kitConfirm.action === "deploy" ? "deploy" : "return"} only the verified items, or {kitConfirm.action === "deploy" ? "deploy" : "return"} everything.
            </p>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" size="sm" onClick={() => setKitConfirm(null)}>
                Cancel
              </Button>
              {kitConfirm.verifiedCount > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (kitConfirm.action === "deploy") {
                      // Deploy verified children + the kit parent (if not already deployed) so it moves to return tab
                      const parentLi = lineItems.find((l) => l.id === kitConfirm.parentLineItemId);
                      const children = parentLi ? ((parentLi.childLineItems || []) as LineItem[]) : [];

                      // Also include nested kit parent line items when their grandchildren are being deployed
                      const nestedKitParentIds: string[] = [];
                      for (const child of children) {
                        if (child.kitId && child.childLineItems?.length) {
                          const hasVerifiedGrandchild = (child.childLineItems as LineItem[]).some(
                            (gc) => kitConfirm.verifiedIds.includes(gc.id)
                          );
                          if (hasVerifiedGrandchild && child.status !== "CHECKED_OUT") {
                            nestedKitParentIds.push(child.id);
                          }
                        }
                      }

                      const items = [
                        ...(parentLi?.status !== "CHECKED_OUT" ? [{ lineItemId: kitConfirm.parentLineItemId }] : []),
                        ...nestedKitParentIds.map((id) => ({ lineItemId: id })),
                        ...kitConfirm.verifiedIds.map((id) => ({ lineItemId: id })),
                      ];
                      checkOutMutation.mutate(items, {
                        onSuccess: () => toast.success(`Deployed ${kitConfirm.verifiedCount} verified items`),
                      });
                    } else {
                      // Return only verified children — kit parent stays deployed until all returned
                      checkInMutation.mutate(
                        {
                          items: kitConfirm.verifiedIds.map((id) => ({
                            lineItemId: id,
                            returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
                            notes: returnNotes || undefined,
                          })),
                        },
                        { onSuccess: () => toast.success(`Returned ${kitConfirm.verifiedCount} verified items`) }
                      );
                    }
                    setKitConfirm(null);
                  }}
                >
                  {kitConfirm.action === "deploy" ? "Deploy" : "Return"} Verified ({kitConfirm.verifiedCount})
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  if (kitConfirm.action === "deploy") {
                    kitCheckOutMutation.mutate(kitConfirm.kitId);
                  } else {
                    kitCheckInMutation.mutate({
                      kitId: kitConfirm.kitId,
                      returnCondition: returnCondition as "GOOD" | "DAMAGED" | "MISSING",
                    });
                  }
                  setKitConfirm(null);
                }}
              >
                {kitConfirm.action === "deploy" ? "Deploy" : "Return"} All ({kitConfirm.totalCount})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Add to Project Prompt */}
      <Dialog open={addPromptOpen} onOpenChange={setAddPromptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Project?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{addPromptData?.assetName}</span>{" "}
            is not on this project. Would you like to add it and check it out?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
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
              {quickAddMutation.isPending ? "Adding..." : "Add & Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Asset Picker Dialog */}
      <Dialog open={assetPickerOpen} onOpenChange={setAssetPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Assets</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select which specific asset to deploy for each item.
            </p>
            {assetPickerItems.map((pickerItem, idx) => (
              <div key={pickerItem.lineItemId} className="space-y-1.5">
                <Label className="text-sm font-medium">{pickerItem.modelName}</Label>
                {pickerItem.availableAssets.length === 0 ? (
                  <p className="text-sm text-destructive">No available assets</p>
                ) : (
                  <Select
                    value={pickerItem.selectedAssetId}
                    onValueChange={(val) => {
                      setAssetPickerItems((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, selectedAssetId: val ?? "" } : item
                        )
                      );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an asset..." />
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
            <Button variant="outline" onClick={() => setAssetPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssetPickerConfirm}
              disabled={assetPickerItems.some((i) => !i.selectedAssetId)}
            >
              Deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </RequirePermission>
  );
}
