"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, ArrowLeft } from "lucide-react";
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
} from "@/server/sub-hires";
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
import { useActiveOrganization } from "@/lib/auth-client";
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
}: {
  projectId: string;
  orgId?: string;
  onCreateNew: () => void;
  onManage: (id: string) => void;
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
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-fg-3 mb-3">No sub-hire orders yet</p>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
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

  // Helper to close (needs to be accessible)
  function onOpenChange(v: boolean) {
    // This is a noop - parent controls open state
  }
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
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Show on client documents</div>
            <div className="text-xs text-fg-3">Sub-hired items appear on quotes, invoices, and packing lists</div>
          </div>
          <Switch checked={showOnDocs} onCheckedChange={setShowOnDocs} />
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

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeSubHireItem(itemId),
    onSuccess: () => {
      toast.success("Item removed");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["sub-hire", orgId, subHireId] });
    queryClient.invalidateQueries({ queryKey: ["project-sub-hires"] });
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
  }

  if (isLoading) {
    return (
      <>
        <DialogHeader><DialogTitle>Loading...</DialogTitle></DialogHeader>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
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
  const items = (subHire.items || []) as Array<Record<string, unknown>>;

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

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-fg">Items</h4>
            <CanDo resource="subHire" action="update">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditingItem(null); setShowItemForm(true); }}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Item
              </Button>
            </CanDo>
          </div>

          {items.length === 0 ? (
            <div className="rounded-md border p-6 text-center text-fg-3 text-sm">
              No items yet. Add items to track costs and charges.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[60px] text-right">Qty</TableHead>
                    <TableHead className="w-[90px] text-right">Cost</TableHead>
                    <TableHead className="w-[90px] text-right">Charge</TableHead>
                    <TableHead className="w-[80px] text-right">Margin</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const itemMargin = Number(item.unitCharge) - Number(item.unitCost);
                    return (
                      <TableRow key={item.id as string}>
                        <TableCell>
                          <div className="text-sm font-medium">{item.description as string}</div>
                          {(item.model as Record<string, string>)?.name && (
                            <div className="text-xs text-fg-4">{(item.model as Record<string, string>).name}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{item.quantity as number}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{formatCurrency(Number(item.unitCost))}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{formatCurrency(Number(item.unitCharge))}</TableCell>
                        <TableCell className={`text-right tabular-nums text-sm ${itemMargin > 0 ? "text-success" : itemMargin < 0 ? "text-error" : "text-fg-3"}`}>
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
                                  <DropdownMenuItem onClick={() => { setEditingItem(item); setShowItemForm(true); }}>
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

        {/* Settings (collapsible) */}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg-2 hover:text-fg transition-colors select-none">
            <svg className="h-3 w-3 transition-transform group-open:rotate-90" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            Order Settings
          </summary>
          <div className="mt-3 space-y-3 rounded-md bg-bg-inset p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Show on client documents</div>
                <div className="text-xs text-fg-4">Items appear on quotes, invoices, and packing lists</div>
              </div>
              <CanDo
                resource="subHire"
                action="update"
                fallback={<span className="text-sm text-fg-3">{subHire.showOnDocs ? "Yes" : "No"}</span>}
              >
                <Switch
                  checked={subHire.showOnDocs}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ supplierId: subHire.supplier?.id, showOnDocs: checked })
                  }
                />
              </CanDo>
            </div>
            {subHire.notes && (
              <div>
                <div className="text-xs font-medium text-fg-3 mb-1">Notes</div>
                <p className="text-sm text-fg-2">{subHire.notes}</p>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Footer with status actions */}
      <DialogFooter className="flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1">
          <CanDo resource="subHire" action="update">
            {transitions.forward && (
              <Button
                size="sm"
                onClick={() => statusMutation.mutate(transitions.forward!.status)}
                disabled={statusMutation.isPending}
              >
                {statusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {transitions.forward!.label}
              </Button>
            )}
            {transitions.cancel && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Cancel this sub-hire?")) statusMutation.mutate("CANCELLED");
                }}
                disabled={statusMutation.isPending}
              >
                Cancel Order
              </Button>
            )}
          </CanDo>
          <CanDo resource="subHire" action="delete">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm("Delete this sub-hire? This cannot be undone.")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
          </CanDo>
        </div>
        <Button variant="outline" onClick={onBack}>Done</Button>
      </DialogFooter>

      {/* Item add/edit sub-dialog */}
      <SubHireItemForm
        open={showItemForm}
        onOpenChange={(v) => { setShowItemForm(v); if (!v) setEditingItem(null); }}
        subHireId={subHireId}
        supplierId={subHire.supplier?.id || ""}
        editingItem={editingItem}
        onSuccess={() => {
          invalidate();
          setShowItemForm(false);
          setEditingItem(null);
        }}
      />
    </>
  );
}

// ─── Item Form (nested dialog) ───────────────────────────────────────────────

function SubHireItemForm({
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
    } else if (open) {
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
  }, [open, editingItem]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit Item" : "Add Item"}</DialogTitle>
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
