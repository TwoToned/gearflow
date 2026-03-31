"use client";

import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, MoreVertical, AlertTriangle, FolderPlus, ChevronDown, MapPin } from "lucide-react";
import { toast } from "sonner";

import {
  createSubHire,
  getSubHire,
  updateSubHire,
  deleteSubHire,
  updateSubHireStatus,
  addSubHireItem,
  updateSubHireItem,
  removeSubHireItem,
  getSubHires,
  getSupplierModelRate,
  getSupplierRateHistory,
  createSubHireGroup,
  updateSubHireGroup,
  deleteSubHireGroup,
  setItemGroup,
  updateSubHireOrderPricing,
  updateSubHirePlacement,
  updateSubHirePaymentStatus,
  addSubHireMedia,
  removeSubHireMedia,
} from "@/server/sub-hires";
import { getProjectCategories } from "@/server/project-categories";
import { getSuppliers } from "@/server/suppliers";
import { getModels } from "@/server/models";
import { formatCurrency } from "@/lib/formatters";
import { subHireStatusLabels, formatLabel } from "@/lib/status-labels";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { CanDo } from "@/components/auth/permission-gate";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import type { SubHireStatus, SubHirePaymentStatus } from "@/generated/prisma/client";

const paymentStatusLabels: Record<SubHirePaymentStatus, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially Paid",
  PAID: "Paid",
};

// ─── Confirm Dialog ─────────────────────────────────────────────────────────

interface ConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  variant: "default" | "destructive";
  onConfirm: () => void;
}

function ConfirmDialog({
  action,
  onClose,
}: {
  action: ConfirmAction | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!action} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {action?.variant === "destructive" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
            )}
            <div>
              <DialogTitle>{action?.title}</DialogTitle>
              <DialogDescription>{action?.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={action?.variant === "destructive" ? "destructive" : "default"}
            onClick={() => {
              action?.onConfirm();
              onClose();
            }}
          >
            {action?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Placement Picker ───────────────────────────────────────────────────────

function PlacementPicker({
  projectId,
  value,
  onChange,
  size = "sm",
}: {
  projectId: string;
  value: { groupId?: string | null; categoryId?: string | null };
  onChange: (placement: { targetGroupId: string | null; targetCategoryId: string | null }) => void;
  size?: "sm" | "xs";
}) {
  const { data: activeOrg } = useActiveOrganization();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: categories } = useQuery<any[]>({
    queryKey: ["project-categories", activeOrg?.id, projectId],
    queryFn: () => getProjectCategories(projectId),
    enabled: !!activeOrg?.id && !!projectId,
  });

  // Build a flat encoded value: "uncategorized", "cat:ID", or "grp:ID"
  const encoded = value.groupId
    ? `grp:${value.groupId}`
    : value.categoryId
      ? `cat:${value.categoryId}`
      : "uncategorized";

  const handleChange = (v: string | null) => {
    if (!v || v === "uncategorized") {
      onChange({ targetGroupId: null, targetCategoryId: null });
    } else if (v.startsWith("cat:")) {
      onChange({ targetGroupId: null, targetCategoryId: v.slice(4) });
    } else if (v.startsWith("grp:")) {
      onChange({ targetGroupId: v.slice(4), targetCategoryId: null });
    }
  };

  // Resolve display label
  let displayLabel = "Uncategorized";
  if (categories && value.groupId) {
    for (const cat of categories) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const grp = (cat.groups || []).find((g: any) => g.id === value.groupId);
      if (grp) { displayLabel = `${cat.name} › ${grp.title}`; break; }
    }
  } else if (categories && value.categoryId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cat = categories.find((c: any) => c.id === value.categoryId);
    if (cat) displayLabel = cat.name;
  }

  const cls = size === "xs" ? "h-7 text-[11px]" : "h-8 text-xs";

  return (
    <Select value={encoded} onValueChange={handleChange}>
      <SelectTrigger className={`${cls} w-full`}>
        <div className="flex items-center gap-1 min-w-0">
          <MapPin className="h-3 w-3 shrink-0 text-fg-4" />
          <SelectValue>{displayLabel}</SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="uncategorized">Uncategorized</SelectItem>
        {(categories || []).map((cat: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const groups = (cat.groups || []) as Array<Record<string, any>>;
          return (
            <div key={cat.id as string}>
              <SelectItem value={`cat:${cat.id}`}>
                {cat.name as string}
              </SelectItem>
              {groups.map((grp) => (
                <SelectItem key={grp.id} value={`grp:${grp.id}`}>
                  <span className="pl-3 text-fg-2">{grp.title}</span>
                </SelectItem>
              ))}
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );
}

// ─── Status transitions ──────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, { forward?: { status: SubHireStatus; label: string }; cancel?: boolean }> = {
  DRAFT: { forward: { status: "CONFIRMED", label: "Confirm" }, cancel: true },
  CONFIRMED: { forward: { status: "RETURNED", label: "Mark Returned" }, cancel: true },
  ON_HIRE: { forward: { status: "RETURNED", label: "Mark Returned" }, cancel: true },
  RETURNED: {},
  CANCELLED: {},
};

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Main Dialog ─────────────────────────────────────────────────────────────

interface SubHireOrderDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If set, opens in manage mode for this sub-hire */
  subHireId?: string | null;
}

export function SubHireOrderDialog({
  projectId,
  open,
  onOpenChange,
  subHireId: initialSubHireId,
}: SubHireOrderDialogProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();

  // Track which sub-hire we're managing (null = list/create mode)
  const [managingId, setManagingId] = useState<string | null>(initialSubHireId || null);
  const [view, setView] = useState<"list" | "create" | "manage">(
    initialSubHireId ? "manage" : "list"
  );

  // Reset when dialog opens/closes
  useEffect(() => {
    if (open) {
      if (initialSubHireId) {
        setManagingId(initialSubHireId);
        setView("manage");
      } else {
        setManagingId(null);
        setView("list");
      }
    }
  }, [open, initialSubHireId]);

  const handleCreated = (newId: string) => {
    setManagingId(newId);
    setView("manage");
    queryClient.invalidateQueries({ queryKey: ["project-sub-hires"] });
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
  };

  const handleDeleted = () => {
    setManagingId(null);
    setView("list");
    queryClient.invalidateQueries({ queryKey: ["project-sub-hires"] });
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
  };

  const handleBack = () => {
    setManagingId(null);
    setView("list");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        {view === "list" && (
          <SubHireListView
            projectId={projectId}
            orgId={orgId}
            onCreateNew={() => setView("create")}
            onManage={(id) => { setManagingId(id); setView("manage"); }}
            onClose={() => onOpenChange(false)}
          />
        )}
        {view === "create" && (
          <SubHireCreateView
            projectId={projectId}
            orgId={orgId}
            onBack={handleBack}
            onCreated={handleCreated}
          />
        )}
        {view === "manage" && managingId && (
          <SubHireManageView
            subHireId={managingId}
            orgId={orgId}
            projectId={projectId}
            onBack={handleBack}
            onDeleted={handleDeleted}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function SubHireListView({
  projectId,
  orgId,
  onCreateNew,
  onManage,
  onClose,
}: {
  projectId: string;
  orgId?: string;
  onCreateNew: () => void;
  onManage: (id: string) => void;
  onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subHires = [], isLoading } = useQuery<any[]>({
    queryKey: ["project-sub-hires", orgId, projectId],
    queryFn: () => getSubHires({ projectId }),
    enabled: !!orgId,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sub-Hire Orders</DialogTitle>
        <DialogDescription>Manage sub-hire orders for this project</DialogDescription>
      </DialogHeader>
      <div className="py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : subHires.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-bg-inset">
              <ArrowLeft className="h-5 w-5 text-fg-4 rotate-[135deg]" />
            </div>
            <p className="text-sm font-medium text-fg-2 mb-1">No sub-hire orders yet</p>
            <p className="text-xs text-fg-4 mb-4">Create a sub-hire when you need to rent equipment from a supplier for this project.</p>
            <CanDo resource="subHire" action="create">
              <Button size="sm" onClick={onCreateNew}>
                <Plus className="mr-1 h-3 w-3" />
                New Sub-Hire Order
              </Button>
            </CanDo>
          </div>
        ) : (
          <div className="space-y-2">
            {subHires.map((sh: Record<string, unknown>) => {
              const margin = Number(sh.totalCharge) - Number(sh.totalCost);
              const isOverdue = sh.status === "ON_HIRE" && sh.hireEnd && new Date(sh.hireEnd as string) < new Date();
              return (
                <button
                  key={sh.id as string}
                  type="button"
                  onClick={() => onManage(sh.id as string)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-bg-elevated transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{sh.orderNumber as string}</span>
                      {isOverdue ? (
                        <StatusIndicator category="subHire" intent="error" label="Overdue" value="OVERDUE" />
                      ) : (
                        <StatusIndicator
                          category="subHire"
                          value={sh.status as string}
                          label={subHireStatusLabels[sh.status as string] || formatLabel(sh.status as string)}
                        />
                      )}
                    </div>
                    <p className="text-sm text-fg-3 truncate mt-0.5">
                      {String((sh.supplier as Record<string, string>)?.name || "")}
                      {sh.hireStart ? ` · ${formatDate(sh.hireStart as string)}` : ""}
                      {sh.hireEnd ? ` – ${formatDate(sh.hireEnd as string)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm tabular-nums">{formatCurrency(Number(sh.totalCharge))}</div>
                    <div className={`text-xs tabular-nums ${margin > 0 ? "text-success" : margin < 0 ? "text-error" : "text-fg-4"}`}>
                      {margin > 0 ? "+" : ""}{formatCurrency(margin)} margin
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {subHires.length > 0 && (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <CanDo resource="subHire" action="create">
            <Button onClick={onCreateNew}>
              <Plus className="mr-1 h-3 w-3" />
              New Sub-Hire Order
            </Button>
          </CanDo>
        </DialogFooter>
      )}
    </>
  );
}

// ─── Create View ─────────────────────────────────────────────────────────────

function SubHireCreateView({
  projectId,
  orgId,
  onBack,
  onCreated,
}: {
  projectId: string;
  orgId?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [hireStart, setHireStart] = useState("");
  const [hireEnd, setHireEnd] = useState("");
  const [showOnDocs, setShowOnDocs] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: () => getSuppliers(),
    enabled: !!orgId,
  });
  const supplierOptions = ((suppliersData || []) as Array<Record<string, unknown>>).map((s) => ({
    value: s.id as string,
    label: s.name as string,
  }));

  const createMutation = useMutation({
    mutationFn: () =>
      createSubHire({
        supplierId,
        projectId,
        hireStart: hireStart || undefined,
        hireEnd: hireEnd || undefined,
        showOnDocs,
        notes: notes || undefined,
      }),
    onSuccess: (result: Record<string, unknown>) => {
      toast.success("Sub-hire order created");
      onCreated(result.id as string);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <DialogTitle>New Sub-Hire Order</DialogTitle>
            <DialogDescription>Create a sub-hire to rent equipment from a supplier</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label>Supplier</Label>
          <ComboboxPicker
            value={supplierId}
            onChange={setSupplierId}
            options={supplierOptions}
            placeholder="Select supplier..."
            searchPlaceholder="Search suppliers..."
            emptyMessage="No suppliers found."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Hire Start</Label>
            <Input type="date" value={hireStart} onChange={(e) => setHireStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Hire End</Label>
            <Input type="date" value={hireEnd} onChange={(e) => setHireEnd(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>Cancel</Button>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!supplierId || createMutation.isPending}
        >
          {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create &amp; Add Items
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Manage View ─────────────────────────────────────────────────────────────

function SubHireManageView({
  subHireId,
  orgId,
  projectId,
  onBack,
  onDeleted,
}: {
  subHireId: string;
  orgId?: string;
  projectId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [showItemForm, setShowItemForm] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingItem, setEditingItem] = useState<any>(null);
  const [addToGroupId, setAddToGroupId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingGroup, setEditingGroup] = useState<Record<string, any> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subHire, isLoading } = useQuery<any>({
    queryKey: ["sub-hire", orgId, subHireId],
    queryFn: () => getSubHire(subHireId),
    enabled: !!orgId,
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: SubHireStatus) => updateSubHireStatus(subHireId, newStatus),
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSubHire(subHireId),
    onSuccess: () => {
      toast.success("Sub-hire deleted");
      onDeleted();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateSubHire(subHireId, data),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const paymentStatusMutation = useMutation({
    mutationFn: (status: SubHirePaymentStatus) => updateSubHirePaymentStatus(subHireId, status),
    onSuccess: () => {
      toast.success("Payment status updated");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeSubHireItem(itemId),
    onSuccess: () => {
      toast.success("Item removed");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createGroupMutation = useMutation({
    mutationFn: (title: string) => createSubHireGroup(subHireId, { title }),
    onSuccess: (result: Record<string, unknown>) => {
      toast.success("Group created");
      setShowNewGroupInput(false);
      setNewGroupTitle("");
      setExpandedGroups((prev) => new Set([...prev, result.id as string]));
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) => deleteSubHireGroup(groupId),
    onSuccess: () => {
      toast.success("Group deleted");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: Record<string, unknown> }) =>
      updateSubHireGroup(groupId, data),
    onSuccess: () => {
      toast.success("Group updated");
      setEditingGroup(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const moveItemMutation = useMutation({
    mutationFn: ({ itemId, groupId }: { itemId: string; groupId: string | null }) =>
      setItemGroup(itemId, groupId),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const placementMutation = useMutation({
    mutationFn: (args: { entityType: "order" | "group" | "item"; entityId: string; targetGroupId: string | null; targetCategoryId: string | null }) =>
      updateSubHirePlacement(args.entityType, args.entityId, {
        targetGroupId: args.targetGroupId,
        targetCategoryId: args.targetCategoryId,
      }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const pricingMutation = useMutation({
    mutationFn: (data: { pricingMode: string; orderTotalCost?: number | null; orderTotalCharge?: number | null }) =>
      updateSubHireOrderPricing(subHireId, data),
    onSuccess: () => {
      toast.success("Pricing updated");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["sub-hire", orgId, subHireId] });
    queryClient.invalidateQueries({ queryKey: ["project-sub-hires"] });
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
    // Refresh equipment tab data when line items are generated/modified
    queryClient.invalidateQueries({ queryKey: ["project-categories", projectId] });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-items", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-line-items"] });
  }

  if (isLoading) {
    return (
      <>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-5 w-48 rounded" />
              <Skeleton className="h-3.5 w-32 rounded" />
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Summary strip skeleton */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-md bg-bg-inset p-3 text-center space-y-1.5">
                <Skeleton className="h-3 w-10 mx-auto rounded" />
                <Skeleton className="h-4 w-16 mx-auto rounded" />
              </div>
            ))}
          </div>
          {/* Items heading skeleton */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
          {/* Items table skeleton */}
          <div className="rounded-md border p-3 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3.5 flex-1 rounded" />
                <Skeleton className="h-3.5 w-8 rounded" />
                <Skeleton className="h-3.5 w-16 rounded" />
                <Skeleton className="h-3.5 w-16 rounded" />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (!subHire) {
    return (
      <>
        <DialogHeader><DialogTitle>Not Found</DialogTitle></DialogHeader>
        <div className="py-8 text-center text-fg-3 text-sm">Sub-hire not found.</div>
      </>
    );
  }

  const transitions = VALID_TRANSITIONS[subHire.status] || {};
  const margin = Number(subHire.totalCharge) - Number(subHire.totalCost);
  const isOverdue = subHire.status === "ON_HIRE" && subHire.hireEnd && new Date(subHire.hireEnd) < new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = (subHire.groups || []) as Array<Record<string, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems = (subHire.items || []) as Array<Record<string, any>>;
  const ungroupedItems = allItems.filter((item) => !item.groupId);
  const isOrderTotal = subHire.pricingMode === "ORDER_TOTAL";

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate">{subHire.orderNumber} &mdash; {subHire.supplier?.name}</DialogTitle>
              {isOverdue ? (
                <StatusIndicator category="subHire" intent="error" label="Overdue" value="OVERDUE" />
              ) : (
                <StatusIndicator
                  category="subHire"
                  value={subHire.status}
                  label={subHireStatusLabels[subHire.status] || formatLabel(subHire.status)}
                />
              )}
            </div>
            <DialogDescription>
              {formatDate(subHire.hireStart)} &ndash; {formatDate(subHire.hireEnd)}
            </DialogDescription>
          </div>
          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {transitions.forward && (
                  <DropdownMenuItem
                    onClick={() => statusMutation.mutate(transitions.forward!.status)}
                    disabled={statusMutation.isPending}
                  >
                    {transitions.forward!.label}
                  </DropdownMenuItem>
                )}
                {transitions.cancel && (
                  <DropdownMenuItem
                    onClick={() => {
                      setConfirmAction({
                        title: "Cancel order",
                        description: "Cancel this sub-hire order? This will update the status to cancelled.",
                        confirmLabel: "Cancel Order",
                        variant: "destructive",
                        onConfirm: () => statusMutation.mutate("CANCELLED"),
                      });
                    }}
                    className="text-destructive"
                  >
                    Cancel Order
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setConfirmAction({
                      title: "Delete sub-hire",
                      description: "Permanently delete this sub-hire order and all its items? This cannot be undone.",
                      confirmLabel: "Delete",
                      variant: "destructive",
                      onConfirm: () => deleteMutation.mutate(),
                    });
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md bg-bg-inset p-3 text-center">
            <div className="text-xs text-fg-3">Cost</div>
            <div className="text-sm font-semibold tabular-nums">{formatCurrency(Number(subHire.totalCost))}</div>
          </div>
          <div className="rounded-md bg-bg-inset p-3 text-center">
            <div className="text-xs text-fg-3">Charge</div>
            <div className="text-sm font-semibold tabular-nums">{formatCurrency(Number(subHire.totalCharge))}</div>
          </div>
          <div className="rounded-md bg-bg-inset p-3 text-center">
            <div className="text-xs text-fg-3">Margin</div>
            <div className={`text-sm font-semibold tabular-nums ${margin > 0 ? "text-success" : margin < 0 ? "text-error" : "text-fg-3"}`}>
              {margin > 0 ? "+" : ""}{formatCurrency(margin)}
            </div>
          </div>
        </div>

        {/* Pricing mode */}
        <div className="rounded-md bg-bg-inset p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Cost pricing</div>
              <div className="text-xs text-fg-4">
                {isOrderTotal
                  ? "Flat total from supplier — items are for tracking only"
                  : "Per-item cost and charge"}
              </div>
            </div>
            <CanDo resource="subHire" action="update">
              <Select
                value={subHire.pricingMode}
                onValueChange={(v) => {
                  if (v) pricingMutation.mutate({
                    pricingMode: v,
                    orderTotalCost: v === "ORDER_TOTAL" ? Number(subHire.orderTotalCost ?? 0) : null,
                    orderTotalCharge: v === "ORDER_TOTAL" ? (subHire.orderTotalCharge != null ? Number(subHire.orderTotalCharge) : null) : null,
                  });
                }}
              >
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue>{isOrderTotal ? "Order Total" : "Per Item"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ITEMIZED">Per Item</SelectItem>
                  <SelectItem value="ORDER_TOTAL">Order Total</SelectItem>
                </SelectContent>
              </Select>
            </CanDo>
          </div>
          {isOrderTotal && (
            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-border/50">
              <div className="space-y-1">
                <Label className="text-xs">Total Cost ($)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  className="h-8 text-sm"
                  defaultValue={Number(subHire.orderTotalCost ?? 0)}
                  onBlur={(e) => {
                    const val = Number(e.target.value);
                    pricingMutation.mutate({
                      pricingMode: "ORDER_TOTAL",
                      orderTotalCost: val,
                      orderTotalCharge: subHire.orderTotalCharge != null ? Number(subHire.orderTotalCharge) : null,
                    });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total Charge ($)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  className="h-8 text-sm"
                  placeholder="Auto from items"
                  defaultValue={subHire.orderTotalCharge != null ? Number(subHire.orderTotalCharge) : ""}
                  onBlur={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    pricingMutation.mutate({
                      pricingMode: "ORDER_TOTAL",
                      orderTotalCost: Number(subHire.orderTotalCost ?? 0),
                      orderTotalCharge: val,
                    });
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Default placement */}
        <div className="rounded-md bg-bg-inset p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg-3 mb-2">Default placement on project</div>
          <PlacementPicker
            projectId={projectId}
            value={{
              groupId: subHire.defaultTargetGroupId || subHire.defaultTargetGroup?.id,
              categoryId: subHire.defaultTargetCategoryId || subHire.defaultTargetCategory?.id,
            }}
            onChange={(p) => placementMutation.mutate({
              entityType: "order",
              entityId: subHireId,
              targetGroupId: p.targetGroupId,
              targetCategoryId: p.targetCategoryId,
            })}
          />
          <p className="text-[11px] text-fg-4 mt-1.5">Items and groups can override this individually</p>
        </div>

        {/* Items + Groups */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-fg">Items</h4>
            <CanDo resource="subHire" action="update">
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowNewGroupInput(true)}
                >
                  <FolderPlus className="mr-1 h-3 w-3" />
                  Add Group
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setEditingItem(null); setAddToGroupId(null); setShowItemForm(true); }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Item
                </Button>
              </div>
            </CanDo>
          </div>

          {/* New group inline input */}
          {showNewGroupInput && (
            <div className="flex items-center gap-2 mb-2">
              <Input
                className="h-8 text-sm flex-1"
                placeholder="Group title (e.g. Shure ULXD Kit)"
                value={newGroupTitle}
                onChange={(e) => setNewGroupTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGroupTitle.trim()) {
                    createGroupMutation.mutate(newGroupTitle.trim());
                  }
                  if (e.key === "Escape") {
                    setShowNewGroupInput(false);
                    setNewGroupTitle("");
                  }
                }}
                autoFocus
              />
              <Button
                size="sm"
                disabled={!newGroupTitle.trim() || createGroupMutation.isPending}
                onClick={() => {
                  if (newGroupTitle.trim()) createGroupMutation.mutate(newGroupTitle.trim());
                }}
              >
                {createGroupMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowNewGroupInput(false); setNewGroupTitle(""); }}
              >
                Cancel
              </Button>
            </div>
          )}

          {allItems.length === 0 && groups.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-6 text-center">
              <p className="text-sm text-fg-3 mb-2">No items yet</p>
              <p className="text-xs text-fg-4 mb-3">Add items to track what you&apos;re sub-hiring, or create a group first.</p>
              <CanDo resource="subHire" action="update">
                <div className="flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowNewGroupInput(true)}
                  >
                    <FolderPlus className="mr-1 h-3 w-3" />
                    Create Group
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => { setEditingItem(null); setAddToGroupId(null); setShowItemForm(true); }}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Item
                  </Button>
                </div>
              </CanDo>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Groups */}
              {groups.map((group) => {
                const groupItems = (group.items || []) as Array<Record<string, unknown>>;
                const isGroupExpanded = expandedGroups.has(group.id);
                const groupCost = group.cost != null ? Number(group.cost) : null;
                const groupCharge = group.charge != null ? Number(group.charge) : null;
                const groupQty = Number(group.quantity) || 1;
                // Calculate suggested cost/charge from items
                const suggestedCost = groupItems.reduce((sum, item) => {
                  return sum + Number(item.unitCost) * Number(item.quantity) * Number(item.duration);
                }, 0);
                const suggestedCharge = groupItems.reduce((sum, item) => {
                  const charge = Number(item.unitCharge) * Number(item.quantity) * Number(item.duration) * (1 - Number(item.discount) / 100);
                  return sum + charge;
                }, 0);
                const effectiveCost = (groupCost ?? suggestedCost) * groupQty;
                const effectiveCharge = (groupCharge ?? suggestedCharge) * groupQty;
                const groupMargin = effectiveCharge - effectiveCost;
                return (
                  <div key={group.id} className="rounded-md border">
                    {/* Group header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-bg-inset/50">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })
                        }
                        className="text-fg-3 hover:text-fg"
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isGroupExpanded ? "" : "-rotate-90"}`} />
                      </button>
                      <FolderPlus className="h-3.5 w-3.5 text-primary/70" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{group.title}</span>
                          {groupQty > 1 && (
                            <span className="text-xs text-fg-4">×{groupQty}</span>
                          )}
                        </div>
                      </div>
                      {(group.targetGroup || group.targetCategory) && (
                        <span className="text-[10px] text-fg-4 flex items-center gap-0.5" title="Placement override">
                          <MapPin className="h-2.5 w-2.5" />
                          {group.targetGroup?.title || group.targetCategory?.name}
                        </span>
                      )}
                      {/* Pricing display */}
                      <div className="flex items-center gap-2 shrink-0">
                        {!isOrderTotal && (
                          <span className="text-xs tabular-nums text-fg-4" title={groupCost != null ? "Group cost (flat)" : "Cost (from items)"}>
                            {groupCost != null ? formatCurrency(effectiveCost) : suggestedCost > 0 ? `~${formatCurrency(suggestedCost * groupQty)}` : null}
                          </span>
                        )}
                        <span className={`text-sm tabular-nums font-medium ${groupCharge != null ? "text-fg-2" : "text-fg-4"}`} title={groupCharge != null ? "Group charge (flat)" : "Charge (from items)"}>
                          {groupCharge != null ? formatCurrency(effectiveCharge) : suggestedCharge > 0 ? `~${formatCurrency(suggestedCharge * groupQty)}` : null}
                        </span>
                        {!isOrderTotal && (effectiveCost > 0 || effectiveCharge > 0) && (
                          <span className={`text-xs tabular-nums ${groupMargin > 0 ? "text-success" : groupMargin < 0 ? "text-error" : "text-fg-4"}`}>
                            {groupMargin > 0 ? "+" : ""}{formatCurrency(groupMargin)}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-fg-4">{groupItems.length} item{groupItems.length !== 1 ? "s" : ""}</span>
                      <CanDo resource="subHire" action="update">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                            <MoreVertical className="h-3 w-3" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Group</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => {
                                setEditingGroup(group);
                              }}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit Group
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setEditingItem(null);
                                setAddToGroupId(group.id);
                                setShowItemForm(true);
                              }}>
                                <Plus className="mr-2 h-4 w-4" />
                                Add Item to Group
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  setConfirmAction({
                                    title: "Delete group",
                                    description: `Delete "${group.title}"? Items will be ungrouped, not deleted.`,
                                    confirmLabel: "Delete Group",
                                    variant: "destructive",
                                    onConfirm: () => deleteGroupMutation.mutate(group.id),
                                  });
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Group
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </CanDo>
                    </div>
                    {/* Group items */}
                    {isGroupExpanded && (
                      <div className="border-t border-border/50">
                        {groupItems.length === 0 ? (
                          <div className="px-3 py-3 text-center">
                            <p className="text-xs text-fg-4 mb-2">No items in this group</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setEditingItem(null);
                                setAddToGroupId(group.id);
                                setShowItemForm(true);
                              }}
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              Add Item
                            </Button>
                          </div>
                        ) : (
                          <Table>
                            <TableBody>
                              {groupItems.map((item) => (
                                <SubHireItemRow
                                  key={item.id as string}
                                  item={item}
                                  groups={groups}
                                  isOrderTotal={isOrderTotal}
                                  onEdit={() => { setEditingItem(item); setShowItemForm(true); }}
                                  onRemove={() => {
                                    setConfirmAction({
                                      title: "Remove item",
                                      description: `Remove "${item.description}" from this sub-hire?`,
                                      confirmLabel: "Remove",
                                      variant: "destructive",
                                      onConfirm: () => removeItemMutation.mutate(item.id as string),
                                    });
                                  }}
                                  onMoveToGroup={(gId) => moveItemMutation.mutate({ itemId: item.id as string, groupId: gId })}
                                />
                              ))}
                            </TableBody>
                          </Table>
                        )}
                        {/* Group placement */}
                        <div className="px-3 py-2 border-t border-border/50">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-fg-4 font-medium shrink-0">Placement:</span>
                            <div className="flex-1 max-w-[200px]">
                              <PlacementPicker
                                projectId={projectId}
                                value={{
                                  groupId: group.targetGroup?.id || group.targetGroupId,
                                  categoryId: group.targetCategory?.id || group.targetCategoryId,
                                }}
                                onChange={(p) => placementMutation.mutate({
                                  entityType: "group",
                                  entityId: group.id,
                                  targetGroupId: p.targetGroupId,
                                  targetCategoryId: p.targetCategoryId,
                                })}
                                size="xs"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Ungrouped items */}
              {ungroupedItems.length > 0 && (
                <div className="rounded-md border">
                  {groups.length > 0 && (
                    <div className="px-3 py-1.5 bg-bg-inset/30 border-b border-border/50">
                      <span className="text-xs text-fg-4 font-medium">Ungrouped</span>
                    </div>
                  )}
                  <Table>
                    <TableBody>
                      {ungroupedItems.map((item) => (
                        <Fragment key={item.id as string}>
                          <SubHireItemRow
                            item={item}
                            groups={groups}
                            isOrderTotal={isOrderTotal}
                            onEdit={() => { setEditingItem(item); setShowItemForm(true); }}
                            onRemove={() => {
                              setConfirmAction({
                                title: "Remove item",
                                description: `Remove "${item.description}" from this sub-hire?`,
                                confirmLabel: "Remove",
                                variant: "destructive",
                                onConfirm: () => removeItemMutation.mutate(item.id as string),
                              });
                            }}
                            onMoveToGroup={(gId) => moveItemMutation.mutate({ itemId: item.id as string, groupId: gId })}
                          />
                          {/* Per-item placement picker */}
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={isOrderTotal ? 4 : 6} className="py-1 px-3">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3 w-3 text-fg-4 shrink-0" />
                                <span className="text-[10px] text-fg-4 shrink-0">Placement:</span>
                                <div className="flex-1 max-w-[200px]">
                                  <PlacementPicker
                                    projectId={projectId}
                                    value={{
                                      groupId: item.targetGroup?.id || item.targetGroupId,
                                      categoryId: item.targetCategory?.id || item.targetCategoryId,
                                    }}
                                    onChange={(p) => placementMutation.mutate({
                                      entityType: "item",
                                      entityId: item.id as string,
                                      targetGroupId: p.targetGroupId,
                                      targetCategoryId: p.targetCategoryId,
                                    })}
                                    size="xs"
                                  />
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payment & Order Details */}
        <div className="rounded-md bg-bg-inset p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-fg-3 mb-0.5">Payment Status</div>
            </div>
            <CanDo
              resource="subHire"
              action="update"
              fallback={<span className="text-sm text-fg-2">{paymentStatusLabels[subHire.paymentStatus as SubHirePaymentStatus] || subHire.paymentStatus}</span>}
            >
              <Select
                value={subHire.paymentStatus}
                onValueChange={(v) => paymentStatusMutation.mutate(v as SubHirePaymentStatus)}
              >
                <SelectTrigger className="w-[160px] h-8 text-sm">
                  <SelectValue>{paymentStatusLabels[subHire.paymentStatus as SubHirePaymentStatus] || subHire.paymentStatus}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNPAID">Unpaid</SelectItem>
                  <SelectItem value="PARTIALLY_PAID">Partially Paid</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                </SelectContent>
              </Select>
            </CanDo>
          </div>

          {subHire.notes && (
            <div className="border-t border-border/50 pt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-fg-3 mb-1">Notes</div>
              <p className="text-sm text-fg-2">{subHire.notes}</p>
            </div>
          )}
        </div>

        {/* Attachments */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-fg-3">Attachments</div>
          <MediaUploader
            entityType="subHire"
            entityId={subHire.id}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
            existingMedia={(subHire.media || []) as MediaItem[]}
            mediaType="DOCUMENT"
            onUploadComplete={async (fileUpload) => {
              await addSubHireMedia({
                subHireId: subHire.id,
                fileId: fileUpload.id,
                type: "DOCUMENT",
              });
              invalidate();
            }}
            onRemove={async (mediaId) => {
              await removeSubHireMedia(mediaId);
              invalidate();
            }}
            queryKey={["sub-hire", subHire.id]}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>Done</Button>
      </DialogFooter>

      {/* Item add/edit sub-dialog */}
      <SubHireItemForm
        open={showItemForm}
        onOpenChange={(v) => { setShowItemForm(v); if (!v) { setEditingItem(null); setAddToGroupId(null); } }}
        subHireId={subHireId}
        supplierId={subHire.supplier?.id || ""}
        editingItem={editingItem}
        groupId={addToGroupId}
        isOrderTotal={isOrderTotal}
        onSuccess={() => {
          invalidate();
          setShowItemForm(false);
          setEditingItem(null);
          setAddToGroupId(null);
        }}
      />

      {/* Edit group dialog */}
      <SubHireGroupEditDialog
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onSave={(data) => {
          if (!editingGroup) return;
          updateGroupMutation.mutate({ groupId: editingGroup.id as string, data });
        }}
        isPending={updateGroupMutation.isPending}
      />

      {/* Confirmation dialog */}
      <ConfirmDialog
        action={confirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </>
  );
}

// ─── Group Edit Dialog ──────────────────────────────────────────────────────

function SubHireGroupEditDialog({
  group,
  onClose,
  onSave,
  isPending,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  group: Record<string, any> | null;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [cost, setCost] = useState("");
  const [charge, setCharge] = useState("");
  const [showOnQuote, setShowOnQuote] = useState(true);
  const [showOnDocs, setShowOnDocs] = useState(false);

  useEffect(() => {
    if (group) {
      setTitle(group.title || "");
      setQuantity(Number(group.quantity) || 1);
      setCost(group.cost != null ? String(Number(group.cost)) : "");
      setCharge(group.charge != null ? String(Number(group.charge)) : "");
      setShowOnQuote(group.showOnQuote ?? true);
      setShowOnDocs(group.showOnDocs ?? false);
    }
  }, [group]);

  if (!group) return null;

  // Calculate suggested cost/charge from items
  const items = (group.items || []) as Array<Record<string, unknown>>;
  const suggestedCost = items.reduce((sum, item) => {
    return sum + Number(item.unitCost) * Number(item.quantity) * Number(item.duration);
  }, 0);
  const suggestedCharge = items.reduce((sum, item) => {
    const ch = Number(item.unitCharge) * Number(item.quantity) * Number(item.duration) * (1 - Number(item.discount) / 100);
    return sum + ch;
  }, 0);

  const effectiveCost = cost ? Number(cost) : suggestedCost;
  const effectiveCharge = charge ? Number(charge) : suggestedCharge;
  const margin = effectiveCharge - effectiveCost;

  return (
    <Dialog open={!!group} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
          <DialogDescription>Update the group title, quantity, and pricing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group title" />
          </div>
          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="w-24" />
          </div>

          {/* Cost — what we pay the supplier for this group */}
          <div className="space-y-2">
            <Label>
              Group Cost ($)
              <span className="text-fg-4 font-normal ml-1">— what we pay</span>
            </Label>
            <div className="flex gap-1">
              <Input
                type="number"
                min={0}
                step={0.01}
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder={suggestedCost > 0 ? `Itemized (~${suggestedCost.toFixed(2)})` : "Itemized"}
              />
              {suggestedCost > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs h-9 px-2"
                  title={`Use suggested: ${formatCurrency(suggestedCost)}`}
                  onClick={() => setCost(String(Math.round(suggestedCost * 100) / 100))}
                >
                  ~{formatCurrency(suggestedCost)}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-fg-4">
              {cost ? "Flat supplier cost for this group (e.g. package deal)" : "Calculated from individual item costs"}
            </p>
          </div>

          {/* Charge — what the client pays */}
          <div className="space-y-2">
            <Label>
              Group Charge ($)
              <span className="text-fg-4 font-normal ml-1">— what client pays</span>
            </Label>
            <div className="flex gap-1">
              <Input
                type="number"
                min={0}
                step={0.01}
                value={charge}
                onChange={(e) => setCharge(e.target.value)}
                placeholder={suggestedCharge > 0 ? `Itemized (~${suggestedCharge.toFixed(2)})` : "Itemized"}
              />
              {suggestedCharge > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs h-9 px-2"
                  title={`Use suggested: ${formatCurrency(suggestedCharge)}`}
                  onClick={() => setCharge(String(Math.round(suggestedCharge * 100) / 100))}
                >
                  ~{formatCurrency(suggestedCharge)}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-fg-4">
              {charge ? "Flat charge to client for this group" : "Calculated from individual item charges"}
            </p>
          </div>

          {/* Margin preview */}
          {(effectiveCost > 0 || effectiveCharge > 0) && (
            <div className="rounded-md bg-bg-inset p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-3">Group margin</span>
                <span className={`tabular-nums font-medium ${margin > 0 ? "text-success" : margin < 0 ? "text-error" : "text-fg-4"}`}>
                  {margin > 0 ? "+" : ""}{formatCurrency(margin)}
                  {effectiveCharge > 0 && (
                    <span className="text-fg-4 font-normal ml-1.5 text-xs">
                      ({Math.round((margin / effectiveCharge) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Display toggles */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Show on quote</div>
                <div className="text-xs text-fg-3">Include this group on the client&apos;s quote and invoice</div>
              </div>
              <Switch checked={showOnQuote} onCheckedChange={setShowOnQuote} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Show as sub-hired</div>
                <div className="text-xs text-fg-3">Display a sub-hire indicator on client documents</div>
              </div>
              <Switch checked={showOnDocs} onCheckedChange={setShowOnDocs} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({
              title,
              quantity,
              cost: cost ? Number(cost) : null,
              charge: charge ? Number(charge) : null,
              showOnQuote,
              showOnDocs,
            })}
            disabled={!title.trim() || isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Item Row ────────────────────────────────────────────────────────────────

function SubHireItemRow({
  item,
  groups,
  isOrderTotal,
  onEdit,
  onRemove,
  onMoveToGroup,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groups: Array<Record<string, any>>;
  isOrderTotal: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMoveToGroup: (groupId: string | null) => void;
}) {
  const cost = Number(item.unitCost) * Number(item.quantity) * Number(item.duration);
  const charge = Number(item.unitCharge) * Number(item.quantity) * Number(item.duration) * (1 - Number(item.discount) / 100);
  const itemMargin = charge - cost;

  return (
    <TableRow className="group">
      <TableCell className="py-2">
        <div className="flex items-center gap-1.5">
          <div className="text-sm">{item.description}</div>
          {!item.showOnQuote && (
            <span className="text-[10px] text-fg-4 bg-surface-2 px-1.5 py-0.5 rounded">Hidden</span>
          )}
        </div>
        {item.model && (
          <div className="text-xs text-fg-4">{String((item.model as Record<string, unknown>)?.name ?? "")}</div>
        )}
      </TableCell>
      <TableCell className="py-2 text-right tabular-nums text-sm w-[50px]">
        {item.quantity}
      </TableCell>
      {isOrderTotal ? (
        <TableCell className="py-2 text-right tabular-nums text-sm text-fg-2 w-[80px]">
          {formatCurrency(Number(item.unitCharge))}
        </TableCell>
      ) : (
        <>
          <TableCell className="py-2 text-right tabular-nums text-sm text-fg-2 w-[80px]">
            {formatCurrency(Number(item.unitCost))}
          </TableCell>
          <TableCell className="py-2 text-right tabular-nums text-sm text-fg-2 w-[80px]">
            {formatCurrency(Number(item.unitCharge))}
          </TableCell>
          <TableCell className={`py-2 text-right tabular-nums text-sm w-[80px] ${itemMargin > 0 ? "text-success" : itemMargin < 0 ? "text-error" : "text-fg-4"}`}>
            {itemMargin > 0 ? "+" : ""}{formatCurrency(itemMargin)}
          </TableCell>
        </>
      )}
      <TableCell className="py-2 w-[40px]">
        <CanDo resource="subHire" action="update">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreVertical className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Item</DropdownMenuLabel>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {/* Move to group options */}
                {groups.length > 0 && (
                  <>
                    {item.groupId ? (
                      <DropdownMenuItem onClick={() => onMoveToGroup(null)}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Ungroup
                      </DropdownMenuItem>
                    ) : null}
                    {groups
                      .filter((g) => g.id !== item.groupId)
                      .map((g) => (
                        <DropdownMenuItem key={g.id} onClick={() => onMoveToGroup(g.id)}>
                          <FolderPlus className="mr-2 h-4 w-4" />
                          Move to {g.title}
                        </DropdownMenuItem>
                      ))}
                  </>
                )}
                <DropdownMenuItem className="text-destructive" onClick={onRemove}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CanDo>
      </TableCell>
    </TableRow>
  );
}

// ─── Item Form (nested dialog) ───────────────────────────────────────────────

function SubHireItemForm({
  open,
  onOpenChange,
  subHireId,
  supplierId,
  editingItem,
  groupId,
  isOrderTotal,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subHireId: string;
  supplierId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editingItem: any;
  groupId?: string | null;
  isOrderTotal?: boolean;
  onSuccess: () => void;
}) {
  const [modelId, setModelId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [unitCharge, setUnitCharge] = useState(0);
  const [pricingType, setPricingType] = useState("FLAT");
  const [duration, setDuration] = useState(1);
  const [discount, setDiscount] = useState(0);
  const [showOnQuote, setShowOnQuote] = useState(true);
  const [showOnDocs, setShowOnDocs] = useState(false);

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: modelsData } = useQuery({
    queryKey: ["models", orgId],
    queryFn: () => getModels({ pageSize: 500 }),
    enabled: open,
  });
  const modelOptions = ((modelsData as Record<string, unknown>)?.models as Array<Record<string, unknown>> || []).map((m) => ({
    value: m.id as string,
    label: m.name as string,
  }));

  const { data: supplierRate } = useQuery({
    queryKey: ["supplier-rate", supplierId, modelId],
    queryFn: () => getSupplierModelRate(supplierId, modelId),
    enabled: !!modelId && !!supplierId && open,
  });

  const { data: allRates } = useQuery({
    queryKey: ["model-rates", modelId],
    queryFn: () => getSupplierRateHistory(modelId),
    enabled: !!modelId && open,
  });

  const handleModelChange = (newModelId: string) => {
    setModelId(newModelId);
    if (newModelId) {
      const model = ((modelsData as Record<string, unknown>)?.models as Array<Record<string, unknown>> || []).find((m) => m.id === newModelId);
      if (model && !description) {
        setDescription(model.name as string);
      }
    }
  };

  // Pre-fill cost from supplier rate
  const lastRateRef = useState<string | null>(null);
  if (supplierRate && modelId && lastRateRef[0] !== modelId && !editingItem) {
    lastRateRef[1](modelId);
    setUnitCost(Number((supplierRate as Record<string, unknown>).lastUnitCost) || 0);
  }

  // Reset form when dialog opens
  useEffect(() => {
    if (open && editingItem) {
      setModelId((editingItem.model as Record<string, unknown>)?.id as string || editingItem.modelId || "");
      setDescription(editingItem.description || "");
      setQuantity(editingItem.quantity || 1);
      setUnitCost(Number(editingItem.unitCost) || 0);
      setUnitCharge(Number(editingItem.unitCharge) || 0);
      setPricingType(editingItem.pricingType || "FLAT");
      setDuration(editingItem.duration || 1);
      setDiscount(Number(editingItem.discount) || 0);
      setShowOnQuote(editingItem.showOnQuote ?? true);
      setShowOnDocs(editingItem.showOnDocs ?? false);
    } else if (open) {
      setModelId("");
      setDescription("");
      setQuantity(1);
      setUnitCost(0);
      setUnitCharge(0);
      setPricingType("FLAT");
      setDuration(1);
      setDiscount(0);
      setShowOnQuote(true);
      setShowOnDocs(false);
      lastRateRef[1](null);
    }
  }, [open, editingItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMutation = useMutation({
    mutationFn: () =>
      editingItem
        ? updateSubHireItem(editingItem.id, { modelId: modelId || undefined, description, quantity, unitCost, unitCharge, pricingType, duration, discount, showOnQuote, showOnDocs, groupId: editingItem.groupId || groupId || undefined })
        : addSubHireItem(subHireId, { modelId: modelId || undefined, description, quantity, unitCost, unitCharge, pricingType, duration, discount, showOnQuote, showOnDocs, groupId: groupId || undefined }),
    onSuccess: () => {
      toast.success(editingItem ? "Item updated" : "Item added");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rates = (allRates || []) as Array<Record<string, any>>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit Item" : "Add Item"}</DialogTitle>
          <DialogDescription>
            {editingItem ? "Update the item details below." : "Add an item to this sub-hire order."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Model (optional)</Label>
            <ComboboxPicker
              value={modelId}
              onChange={handleModelChange}
              options={modelOptions}
              placeholder="Select model..."
              searchPlaceholder="Search models..."
              emptyMessage="No models found."
              allowClear
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Item description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Pricing Type</Label>
              <Select value={pricingType} onValueChange={(v) => { if (v) setPricingType(v); }}>
                <SelectTrigger>
                  <SelectValue>
                    {pricingType === "FLAT" ? "Flat" : pricingType === "PER_DAY" ? "Per Day" : pricingType === "PER_WEEK" ? "Per Week" : "Per Hour"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FLAT">Flat</SelectItem>
                  <SelectItem value="PER_DAY">Per Day</SelectItem>
                  <SelectItem value="PER_WEEK">Per Week</SelectItem>
                  <SelectItem value="PER_HOUR">Per Hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isOrderTotal ? (
            <div className="space-y-2">
              <Label>Unit Charge ($)</Label>
              <Input type="number" min={0} step={0.01} value={unitCharge} onChange={(e) => setUnitCharge(Number(e.target.value))} />
              <p className="text-xs text-fg-4">Cost is set at the order level. This is what the client sees per item.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Unit Cost ($)</Label>
                <Input type="number" min={0} step={0.01} value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Unit Charge ($)</Label>
                <Input type="number" min={0} step={0.01} value={unitCharge} onChange={(e) => setUnitCharge(Number(e.target.value))} />
              </div>
            </div>
          )}

          {/* Rate comparison */}
          {modelId && (
            <div className="rounded-md bg-bg-inset p-3 animate-in fade-in duration-150">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-2">Supplier Rates</p>
              {rates.length === 0 ? (
                <div className="border-l-2 border-info px-3 py-2 text-xs text-fg-3">
                  Rates are saved automatically. Comparison data will appear here after your first order.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {rates.slice(0, 5).map((rate) => {
                    const isCurrentSupplier = rate.supplierId === supplierId;
                    const daysAgo = Math.floor((Date.now() - new Date(rate.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24));
                    const timeLabel = daysAgo === 0 ? "today" : daysAgo === 1 ? "1d ago" : `${daysAgo}d ago`;
                    return (
                      <button
                        key={rate.id}
                        type="button"
                        onClick={() => setUnitCost(Number(rate.lastUnitCost))}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-bg-elevated cursor-pointer ${isCurrentSupplier ? "border-l-2 border-primary" : ""}`}
                      >
                        <span className="flex-1 text-left truncate">{rate.supplier?.name}</span>
                        <span className="tabular-nums font-medium">{formatCurrency(Number(rate.lastUnitCost))}</span>
                        <span className="text-xs text-fg-3 w-12 text-right">{timeLabel}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Duration</Label>
              <Input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Discount (%)</Label>
              <Input type="number" min={0} max={100} step={0.01} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-3 pt-1 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Show on quote</div>
                <div className="text-xs text-fg-3">Include this item on the client&apos;s quote and invoice</div>
              </div>
              <Switch checked={showOnQuote} onCheckedChange={setShowOnQuote} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Show as sub-hired</div>
                <div className="text-xs text-fg-3">Display a sub-hire indicator on client documents</div>
              </div>
              <Switch checked={showOnDocs} onCheckedChange={setShowOnDocs} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!description || addMutation.isPending}
          >
            {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingItem ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
