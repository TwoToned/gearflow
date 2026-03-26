"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { addLineItem } from "@/server/line-items";
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

interface AddSubhireDialogProps {
  projectId: string;
  existingGroups?: string[];
  onGroupCreated?: (group: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-set category for the line item */
  categoryId?: string;
  /** Pre-set group for the line item */
  groupId?: string;
}

export function AddSubhireDialog({
  projectId,
  existingGroups = [],
  onGroupCreated,
  open,
  onOpenChange,
  categoryId,
  groupId,
}: AddSubhireDialogProps) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: () => getSuppliers(),
    enabled: open,
  });

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: {
      type: "EQUIPMENT",
      quantity: 1,
      pricingType: "PER_DAY",
      duration: 1,
      isOptional: false,
      isSubhire: true,
      showSubhireOnDocs: false,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: LineItemFormValues) => addLineItem(projectId, { ...data, categoryId, groupId }),
    onSuccess: (_result, variables) => {
      if (variables.groupName && onGroupCreated) {
        onGroupCreated(variables.groupName);
      }
      toast.success("Subhire item added");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-categories", projectId] });
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      form.reset();
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Subhire</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
            className="space-y-4 py-2"
          >
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

            {form.watch("supplierId") && (
              <div className="space-y-2">
                <Label htmlFor="sub-orderNumber">Subhire Order #</Label>
                <Input
                  id="sub-orderNumber"
                  {...form.register("subhireOrderNumber")}
                  placeholder="e.g. PO-2024-001"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sub-description">Description *</Label>
              <Input
                id="sub-description"
                {...form.register("description")}
                placeholder="e.g. 4x Shure SM58"
              />
              {form.formState.errors.description && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.description.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sub-quantity">Quantity</Label>
                <Input
                  id="sub-quantity"
                  type="number"
                  min={1}
                  {...form.register("quantity")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-unitPrice">Unit Price ($)</Label>
                <Input
                  id="sub-unitPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  {...form.register("unitPrice")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sub-pricingType">Pricing Type</Label>
                <select
                  id="sub-pricingType"
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
                <Label htmlFor="sub-duration">Duration</Label>
                <Input
                  id="sub-duration"
                  type="number"
                  min={1}
                  {...form.register("duration")}
                />
              </div>
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
                    placeholder="e.g. Subhires, Audio"
                    searchPlaceholder="Search or type new group..."
                    emptyMessage="Type to create a new group."
                    allowClear
                    creatable
                  />
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sub-notes">Notes</Label>
              <Textarea
                id="sub-notes"
                {...form.register("notes")}
                placeholder="e.g. PO number, special instructions"
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="showSubhireOnDocs"
                render={({ field }) => (
                  <Checkbox
                    id="sub-showSubhireOnDocs"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="sub-showSubhireOnDocs" className="text-sm font-normal">
                Show as &quot;Subhire&quot; on quotes, invoices &amp; delivery dockets
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="isOptional"
                render={({ field }) => (
                  <Checkbox
                    id="sub-isOptional"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="sub-isOptional" className="text-sm font-normal">
                Optional item (excluded from totals)
              </Label>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <QuickCreateSupplier
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        onCreated={(id) => form.setValue("supplierId", id)}
      />
    </>
  );
}
