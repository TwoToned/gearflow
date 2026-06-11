"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { addLineItem } from "@/server/line-items";
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

interface AddServiceDialogProps {
  projectId: string;
  existingGroups?: string[];
  onGroupCreated?: (group: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddServiceDialog({
  projectId,
  existingGroups = [],
  onGroupCreated,
  open,
  onOpenChange,
}: AddServiceDialogProps) {

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: {
      type: "SERVICE",
      quantity: 1,
      pricingType: "FLAT",
      duration: 1,
      isOptional: false,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: LineItemFormValues) => addLineItem(projectId, data),
    onSuccess: (_result, variables) => {
      if (variables.groupName && onGroupCreated) {
        onGroupCreated(variables.groupName);
      }
      toast.success("Item added");
      refreshProjectDetail(projectId);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Service / Other</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          className="space-y-4 py-2"
        >
          <div className="space-y-2">
            <Label htmlFor="svc-type">Type</Label>
            <select
              id="svc-type"
              {...form.register("type")}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="SERVICE">Service</option>
              <option value="LABOUR">Labour</option>
              <option value="TRANSPORT">Transport</option>
              <option value="MISC">Misc</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="svc-description">Description *</Label>
            <Input
              id="svc-description"
              {...form.register("description")}
              placeholder="e.g. Sound Engineer - 8hrs"
            />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="svc-quantity">Quantity</Label>
              <Input
                id="svc-quantity"
                type="number"
                min={1}
                {...form.register("quantity")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-unitPrice">Unit Price ($)</Label>
              <Input
                id="svc-unitPrice"
                type="number"
                step="0.01"
                min={0}
                {...form.register("unitPrice")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="svc-pricingType">Pricing Type</Label>
              <select
                id="svc-pricingType"
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
              <Label htmlFor="svc-duration">Duration</Label>
              <Input
                id="svc-duration"
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
                  placeholder="e.g. Crew, Transport"
                  searchPlaceholder="Search or type new group..."
                  emptyMessage="Type to create a new group."
                  allowClear
                  creatable
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svc-notes">Notes</Label>
            <Textarea
              id="svc-notes"
              {...form.register("notes")}
              placeholder="Additional notes"
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="isOptional"
              render={({ field }) => (
                <Checkbox
                  id="svc-isOptional"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="svc-isOptional" className="text-sm font-normal">
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
  );
}
