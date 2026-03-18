"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { updateLineItem, checkAvailability } from "@/server/line-items";
import { getSuppliers } from "@/server/suppliers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateSupplier } from "@/components/assets/quick-create-supplier";
import { useActiveOrganization } from "@/lib/auth-client";

interface EditLineItemDialogProps {
  projectId: string;
  existingGroups?: string[];
  onGroupCreated?: (group: string) => void;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  lineItem: {
    id: string;
    type: string;
    modelId: string | null;
    assetId: string | null;
    bulkAssetId: string | null;
    kitId?: string | null;
    description: string | null;
    quantity: number;
    unitPrice: unknown;
    pricingType: string;
    duration: number;
    discount: unknown;
    groupName: string | null;
    notes: string | null;
    isOptional: boolean;
    isSubhire?: boolean;
    showSubhireOnDocs?: boolean;
    supplierId?: string | null;
    model?: { name: string; modelNumber?: string | null } | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditLineItemDialog({
  projectId,
  existingGroups = [],
  onGroupCreated,
  rentalStartDate,
  rentalEndDate,
  lineItem,
  open,
  onOpenChange,
}: EditLineItemDialogProps) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: () => getSuppliers(),
    enabled: open && !!lineItem?.isSubhire,
  });

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
  });

  // Populate form when lineItem changes
  useEffect(() => {
    if (lineItem && open) {
      form.reset({
        type: lineItem.type as LineItemFormValues["type"],
        modelId: lineItem.modelId || undefined,
        assetId: lineItem.assetId || undefined,
        bulkAssetId: lineItem.bulkAssetId || undefined,
        description: lineItem.description || undefined,
        quantity: lineItem.quantity,
        unitPrice: lineItem.unitPrice != null ? Number(lineItem.unitPrice) : undefined,
        pricingType: lineItem.pricingType as LineItemFormValues["pricingType"],
        duration: lineItem.duration,
        discount: lineItem.discount != null ? Number(lineItem.discount) : undefined,
        groupName: lineItem.groupName || undefined,
        notes: lineItem.notes || undefined,
        isOptional: lineItem.isOptional,
        isSubhire: lineItem.isSubhire ?? false,
        showSubhireOnDocs: lineItem.showSubhireOnDocs ?? false,
        supplierId: lineItem.supplierId || undefined,
      });
    }
  }, [lineItem, open, form]);

  const [overbookConfirmed, setOverbookConfirmed] = useState(false);
  const requestedQty = Number(form.watch("quantity")) || 1;

  // Availability check for equipment items with a model (works with or without dates)
  const { data: availability } = useQuery({
    queryKey: [
      "availability",
      orgId,
      lineItem?.modelId,
      rentalStartDate?.toISOString(),
      rentalEndDate?.toISOString(),
      projectId,
    ],
    queryFn: () =>
      checkAvailability(
        lineItem!.modelId!,
        rentalStartDate ?? null,
        rentalEndDate ?? null,
        projectId,
      ),
    enabled: open && !!lineItem?.modelId,
  });

  // Available for this edit = total stock minus all other bookings (excluding this item's current qty)
  const availableForEdit = availability
    ? availability.totalStock - (availability.booked - lineItem!.quantity)
    : null;
  const isOverbooked = availableForEdit != null && requestedQty > availableForEdit;

  // Reset overbook confirmation when quantity changes
  useEffect(() => {
    setOverbookConfirmed(false);
  }, [requestedQty]);

  const mutation = useMutation({
    mutationFn: (data: LineItemFormValues) =>
      updateLineItem(lineItem!.id, data, overbookConfirmed),
    onSuccess: (_result, variables) => {
      if (variables.groupName && onGroupCreated) {
        onGroupCreated(variables.groupName);
      }
      toast.success("Line item updated");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      onOpenChange(false);
      setOverbookConfirmed(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const isEquipment = lineItem?.type === "EQUIPMENT";
  const isSubhire = lineItem?.isSubhire ?? false;
  const itemName = isEquipment
    ? [lineItem?.model?.name, lineItem?.model?.modelNumber]
        .filter(Boolean)
        .join(" - ") || lineItem?.description || "Equipment"
    : lineItem?.description || "Item";

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit: {itemName}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          className="space-y-4 py-2"
        >
          {!isEquipment && (
            <div className="space-y-2">
              <Label htmlFor="edit-type">Type</Label>
              <select
                id="edit-type"
                {...form.register("type")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="SERVICE">Service</option>
                <option value="LABOUR">Labour</option>
                <option value="TRANSPORT">Transport</option>
                <option value="MISC">Misc</option>
              </select>
            </div>
          )}

          {(!isEquipment || isSubhire) && (
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                {...form.register("description")}
                placeholder={isSubhire ? "e.g. 4x Shure SM58" : "e.g. Sound Engineer - 8hrs"}
              />
            </div>
          )}

          {isSubhire && (
            <div className="space-y-2">
              <Label>Supplier</Label>
              <ComboboxPicker
                value={form.watch("supplierId") || ""}
                onChange={(v) => form.setValue("supplierId", v)}
                options={(suppliers as Array<{ id: string; name: string; contactName?: string | null }>).map((s) => ({
                  value: s.id,
                  label: s.name,
                  description: s.contactName || undefined,
                }))}
                placeholder="Select supplier"
                searchPlaceholder="Search suppliers..."
                onCreateNew={() => setShowCreateSupplier(true)}
                createNewLabel="New supplier"
                allowClear
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-quantity">Quantity</Label>
              <Input
                id="edit-quantity"
                type="number"
                min={1}
                {...form.register("quantity")}
                disabled={!!lineItem?.assetId || !!lineItem?.kitId}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-unitPrice">Unit Price ($)</Label>
              <Input
                id="edit-unitPrice"
                type="number"
                step="0.01"
                min={0}
                {...form.register("unitPrice")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-pricingType">Pricing Type</Label>
              <select
                id="edit-pricingType"
                {...form.register("pricingType")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="PER_DAY">Per Day</option>
                <option value="PER_WEEK">Per Week</option>
                <option value="FLAT">Flat</option>
                <option value="PER_HOUR">Per Hour</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-duration">Duration</Label>
              <Input
                id="edit-duration"
                type="number"
                min={1}
                {...form.register("duration")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-discount">Discount ($)</Label>
            <Input
              id="edit-discount"
              type="number"
              step="0.01"
              min={0}
              {...form.register("discount")}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label>Group Name</Label>
            <Controller
              control={form.control}
              name="groupName"
              render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={existingGroups.map((g) => ({ value: g, label: g }))}
                  placeholder="e.g. Audio, Lighting"
                  searchPlaceholder="Search or type new group..."
                  emptyMessage="Type to create a new group."
                  allowClear
                  creatable
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              {...form.register("notes")}
              placeholder="Additional notes"
              rows={2}
            />
          </div>

          {isSubhire && (
            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="showSubhireOnDocs"
                render={({ field }) => (
                  <Checkbox
                    id="edit-showSubhireOnDocs"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="edit-showSubhireOnDocs" className="text-sm font-normal">
                Show as &quot;Subhire&quot; on quotes, invoices &amp; delivery dockets
              </Label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="isOptional"
              render={({ field }) => (
                <Checkbox
                  id="edit-isOptional"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="edit-isOptional" className="text-sm font-normal">
              Optional item (excluded from totals)
            </Label>
          </div>

          {isOverbooked && (
            <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 space-y-2">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="inline-block mr-1.5 h-3.5 w-3.5" />
                This will overbook {requestedQty} units with only {availableForEdit ?? 0} available
              </p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={overbookConfirmed}
                  onChange={(e) => setOverbookConfirmed(e.target.checked)}
                  className="accent-red-500"
                />
                <span className="text-red-600 dark:text-red-400">I understand, overbook anyway</span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || (isOverbooked && !overbookConfirmed)}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {isSubhire && (
      <QuickCreateSupplier
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        onCreated={(id) => form.setValue("supplierId", id)}
      />
    )}
    </>
  );
}
