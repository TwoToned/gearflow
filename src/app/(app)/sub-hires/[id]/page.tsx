"use client";

import { use, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Pencil, Trash2, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

import {
  getSubHire,
  updateSubHire,
  deleteSubHire,
  updateSubHireStatus,
  addSubHireItem,
  updateSubHireItem,
  removeSubHireItem,
  changeSubHireProject,
  duplicateSubHire,
  getSupplierModelRate,
  getSupplierRateHistory,
} from "@/server/sub-hires";
import { getModels } from "@/server/models";
import { formatCurrency } from "@/lib/formatters";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { NotesEditor } from "@/components/ui/notes-editor";
import { PageMeta } from "@/components/layout/page-meta";
import { subHireStatusLabels, formatLabel } from "@/lib/status-labels";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SubHireStatus } from "@/generated/prisma/client";

// ─── Status transitions ──────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, { forward?: { status: SubHireStatus; label: string }; cancel?: boolean }> = {
  DRAFT: { forward: { status: "CONFIRMED", label: "Confirm" }, cancel: true },
  CONFIRMED: { forward: { status: "ON_HIRE", label: "Mark On Hire" }, cancel: true },
  ON_HIRE: { forward: { status: "RETURNED", label: "Mark Returned" }, cancel: true },
  RETURNED: {},
  CANCELLED: {},
};

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function SubHireDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<DetailPageSkeleton />}>
      <SubHireDetailContent params={params} />
    </Suspense>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SubHireDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [showItemDialog, setShowItemDialog] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingItem, setEditingItem] = useState<any>(null);

  const { data: subHire, isLoading } = useQuery({
    queryKey: ["sub-hire", orgId, id],
    queryFn: () => getSubHire(id),
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: SubHireStatus) => updateSubHireStatus(id, newStatus),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["sub-hire", orgId, id] });
      queryClient.invalidateQueries({ queryKey: ["sub-hires"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateSubHire(id),
    onSuccess: (result: Record<string, unknown>) => {
      toast.success("Sub-hire duplicated");
      router.push(`/sub-hires/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSubHire(id),
    onSuccess: () => {
      toast.success("Sub-hire deleted");
      router.push("/sub-hires");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateSubHire(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sub-hire", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeSubHireItem(itemId),
    onSuccess: () => {
      toast.success("Item removed");
      queryClient.invalidateQueries({ queryKey: ["sub-hire", orgId, id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <DetailPageSkeleton />;
  if (!subHire) return <div className="py-20 text-center text-fg-3">Sub-hire not found.</div>;

  const transitions = VALID_TRANSITIONS[subHire.status] || {};
  const margin = Number(subHire.totalCharge) - Number(subHire.totalCost);
  const isOverdue = subHire.status === "ON_HIRE" && subHire.hireEnd && new Date(subHire.hireEnd) < new Date();
  const canConfirm = !!subHire.projectId;

  return (
    <RequirePermission resource="subHire" action="read">
      <PageMeta title={`${subHire.orderNumber} — ${subHire.supplier?.name}`} />
      <FadeIn>
        <div className="space-y-6">
          {/* Header */}
          <div>
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/sub-hires" className="hover:text-fg transition-colors">Sub-Hires</Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-mono text-fg-2">{subHire.orderNumber}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="t-title text-fg">{subHire.orderNumber}</h1>
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
                <p className="mt-1 text-sm text-fg-3">{subHire.supplier?.name}</p>
              </div>

              <CanDo resource="subHire" action="update">
                <div className="flex flex-wrap gap-2">
                  {transitions.forward && (
                    <Button
                      onClick={() => statusMutation.mutate(transitions.forward!.status)}
                      disabled={
                        statusMutation.isPending ||
                        (transitions.forward!.status === "CONFIRMED" && !canConfirm)
                      }
                      title={
                        transitions.forward!.status === "CONFIRMED" && !canConfirm
                          ? "Assign a project before confirming"
                          : undefined
                      }
                    >
                      {statusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {transitions.forward!.label}
                    </Button>
                  )}
                  {transitions.cancel && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Cancel this sub-hire?")) statusMutation.mutate("CANCELLED");
                      }}
                      disabled={statusMutation.isPending}
                    >
                      Cancel
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
                      <span className="sr-only">Actions</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => duplicateMutation.mutate()}
                          disabled={duplicateMutation.isPending}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          {duplicateMutation.isPending ? "Duplicating..." : "Duplicate"}
                        </DropdownMenuItem>
                        <CanDo resource="subHire" action="delete">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              if (confirm("Delete this sub-hire? This cannot be undone.")) {
                                deleteMutation.mutate();
                              }
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </CanDo>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CanDo>
            </div>
          </div>

          {/* 2-Column Layout */}
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Main Content */}
            <div className="min-w-0 flex-1 space-y-6">
              {/* Items Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="t-heading text-fg">Items</h3>
                  <CanDo resource="subHire" action="update">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditingItem(null); setShowItemDialog(true); }}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add Item
                    </Button>
                  </CanDo>
                </div>

                {subHire.items.length === 0 ? (
                  <div className="rounded-md border p-8 text-center text-fg-3 text-sm">
                    No items yet. Add items to track costs and charges.
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[100px]">Model</TableHead>
                          <TableHead className="w-[60px] text-right">Qty</TableHead>
                          <TableHead className="w-[90px] text-right">Unit Cost</TableHead>
                          <TableHead className="w-[90px] text-right">Unit Charge</TableHead>
                          <TableHead className="w-[90px] text-right">Margin</TableHead>
                          <TableHead className="w-[48px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subHire.items.map((item: Record<string, unknown>) => {
                          const itemMargin = Number(item.unitCharge) - Number(item.unitCost);
                          return (
                            <TableRow key={item.id as string}>
                              <TableCell className="text-sm font-medium">{item.description as string}</TableCell>
                              <TableCell className="text-sm text-fg-3">
                                {(item.model as Record<string, unknown>)?.name as string || "\u2014"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{item.quantity as number}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(Number(item.unitCost))}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(Number(item.unitCharge))}</TableCell>
                              <TableCell className={`text-right tabular-nums ${itemMargin > 0 ? "text-success" : itemMargin < 0 ? "text-error" : "text-fg-3"}`}>
                                {formatCurrency(itemMargin)}
                              </TableCell>
                              <TableCell>
                                <CanDo resource="subHire" action="update">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuGroup>
                                        <DropdownMenuLabel>Item</DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => { setEditingItem(item); setShowItemDialog(true); }}>
                                          <Pencil className="mr-2 h-4 w-4" />
                                          Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={() => {
                                            if (confirm("Remove this item?")) removeItemMutation.mutate(item.id as string);
                                          }}
                                        >
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
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
              <div className="lg:sticky lg:top-4 space-y-4">
                {/* Gross Margin */}
                <div className="border-b border-border pb-4">
                  <SectionHeader label="Gross Margin" />
                  <div className="rounded-md bg-bg-inset p-4">
                    <div className={`text-xl font-bold tabular-nums ${margin > 0 ? "text-success" : margin < 0 ? "text-error" : "text-fg-3"}`}>
                      {margin > 0 ? "+" : ""}{formatCurrency(margin)}
                    </div>
                    <div className="mt-2 space-y-0.5 text-sm text-fg-2">
                      <div>Cost: {formatCurrency(Number(subHire.totalCost))}</div>
                      <div>Charge: {formatCurrency(Number(subHire.totalCharge))}</div>
                    </div>
                  </div>
                </div>

                {/* Supplier */}
                <div className="border-b border-border pb-4">
                  <SectionHeader label="Supplier" />
                  <div className="text-sm">
                    <Link href={`/suppliers/${subHire.supplier?.id}`} className="font-medium hover:underline">
                      {subHire.supplier?.name}
                    </Link>
                    {subHire.supplier?.contactEmail && (
                      <p className="text-fg-3">{subHire.supplier.contactEmail}</p>
                    )}
                    {subHire.supplier?.contactPhone && (
                      <p className="text-fg-3">{subHire.supplier.contactPhone}</p>
                    )}
                  </div>
                </div>

                {/* Dates */}
                <div className="border-b border-border pb-4">
                  <SectionHeader label="Dates" />
                  {isOverdue && (
                    <div className="mb-2 rounded-md border-l-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
                      Return overdue since {formatDate(subHire.hireEnd)}
                    </div>
                  )}
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Start</span>
                      <span>{formatDate(subHire.hireStart)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">End</span>
                      <span>{formatDate(subHire.hireEnd)}</span>
                    </div>
                  </div>
                </div>

                {/* Project */}
                <div className="border-b border-border pb-4">
                  <SectionHeader label="Project" />
                  {subHire.project ? (
                    <div className="text-sm">
                      <Link href={`/projects/${subHire.project.id}`} className="font-medium hover:underline">
                        {subHire.project.projectNumber} - {subHire.project.name}
                      </Link>
                    </div>
                  ) : (
                    <p className="text-sm text-fg-4">Unassigned</p>
                  )}
                </div>

                {/* Order */}
                <div className="border-b border-border pb-4">
                  <SectionHeader label="Order" />
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Order Number</span>
                      <span className="font-mono">{subHire.orderNumber}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-fg-3">Show on client documents</div>
                        <div className="text-xs text-fg-4">Sub-hired items appear on quotes, invoices, and packing lists</div>
                      </div>
                      <CanDo
                        resource="subHire"
                        action="update"
                        fallback={<span className="text-fg-3">{subHire.showOnDocs ? "Yes" : "No"}</span>}
                      >
                        <Switch
                          checked={subHire.showOnDocs}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({
                              supplierId: subHire.supplier?.id,
                              showOnDocs: checked,
                            })
                          }
                        />
                      </CanDo>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="border-b border-border pb-4">
                  <SectionHeader label="Notes" />
                  <NotesEditor
                    initialNotes={subHire.notes || ""}
                    queryKey={["sub-hire", orgId, id]}
                    onSave={(notes) =>
                      updateSubHire(id, {
                        supplierId: subHire.supplier?.id,
                        notes,
                      })
                    }
                    placeholder="Add notes..."
                  />
                </div>

                {/* Activity */}
                <div>
                  <SectionHeader label="Activity" />
                  <ActivityTimeline entityType="subHire" entityId={id} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Item Dialog */}
      <SubHireItemDialog
        open={showItemDialog}
        onOpenChange={(open) => { setShowItemDialog(open); if (!open) setEditingItem(null); }}
        subHireId={id}
        supplierId={subHire.supplier?.id || ""}
        editingItem={editingItem}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["sub-hire", orgId, id] });
          setShowItemDialog(false);
          setEditingItem(null);
        }}
      />
    </RequirePermission>
  );
}

// ─── Item Dialog ─────────────────────────────────────────────────────────────

function SubHireItemDialog({
  open,
  onOpenChange,
  subHireId,
  supplierId,
  editingItem,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subHireId: string;
  supplierId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editingItem: any;
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

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Fetch models for picker
  const { data: modelsData } = useQuery({
    queryKey: ["models", orgId],
    queryFn: () => getModels({ pageSize: 500 }),
    enabled: open,
  });
  const modelOptions = ((modelsData as Record<string, unknown>)?.models as Array<Record<string, unknown>> || []).map((m) => ({
    value: m.id as string,
    label: m.name as string,
  }));

  // Fetch supplier rate for pre-fill when model selected
  const { data: supplierRate } = useQuery({
    queryKey: ["supplier-rate", supplierId, modelId],
    queryFn: () => getSupplierModelRate(supplierId, modelId),
    enabled: !!modelId && !!supplierId && open,
  });

  // Fetch all supplier rates for comparison panel
  const { data: allRates } = useQuery({
    queryKey: ["model-rates", modelId],
    queryFn: () => getSupplierRateHistory(modelId),
    enabled: !!modelId && open,
  });

  // Pre-fill when model selected
  const handleModelChange = (newModelId: string) => {
    setModelId(newModelId);
    if (newModelId) {
      const model = ((modelsData as Record<string, unknown>)?.models as Array<Record<string, unknown>> || []).find((m) => m.id === newModelId);
      if (model && !description) {
        setDescription(model.name as string);
      }
    }
  };

  // Pre-fill cost from supplier rate when it loads
  const lastRateRef = useState<string | null>(null);
  if (supplierRate && modelId && lastRateRef[0] !== modelId && !editingItem) {
    lastRateRef[1](modelId);
    setUnitCost(Number((supplierRate as Record<string, unknown>).lastUnitCost) || 0);
  }

  // Reset form when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v && editingItem) {
      setModelId((editingItem.model as Record<string, unknown>)?.id as string || editingItem.modelId || "");
      setDescription(editingItem.description || "");
      setQuantity(editingItem.quantity || 1);
      setUnitCost(Number(editingItem.unitCost) || 0);
      setUnitCharge(Number(editingItem.unitCharge) || 0);
      setPricingType(editingItem.pricingType || "FLAT");
      setDuration(editingItem.duration || 1);
      setDiscount(Number(editingItem.discount) || 0);
    } else if (v) {
      setModelId("");
      setDescription("");
      setQuantity(1);
      setUnitCost(0);
      setUnitCharge(0);
      setPricingType("FLAT");
      setDuration(1);
      setDiscount(0);
      lastRateRef[1](null);
    }
    onOpenChange(v);
  };

  const addMutation = useMutation({
    mutationFn: () =>
      editingItem
        ? updateSubHireItem(editingItem.id, { modelId: modelId || undefined, description, quantity, unitCost, unitCharge, pricingType, duration, discount })
        : addSubHireItem(subHireId, { modelId: modelId || undefined, description, quantity, unitCost, unitCharge, pricingType, duration, discount }),
    onSuccess: () => {
      toast.success(editingItem ? "Item updated" : "Item added");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rates = (allRates || []) as Array<Record<string, any>>;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit Item" : "Add Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Model picker */}
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
              <Select value={pricingType} onValueChange={setPricingType}>
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

          {/* Rate comparison panel */}
          {modelId && (
            <div className="rounded-md bg-bg-inset p-3 animate-in fade-in duration-150">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-2">Supplier Rates</p>
              {rates.length === 0 ? (
                <div className="border-l-2 border-info px-3 py-2 text-xs text-fg-3">
                  Rates are saved automatically as you create sub-hires. Comparison data will appear here after your first order.
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
