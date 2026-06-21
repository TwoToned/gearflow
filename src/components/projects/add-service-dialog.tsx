"use client";

import { useForm, Controller } from "react-hook-form";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { zodResolver } from "@hookform/resolvers/zod";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  SERVICE: "Service",
  LABOUR: "Labour",
  TRANSPORT: "Transport",
  MISC: "Misc",
};
const SERVICE_TYPE_ORDER = ["SERVICE", "LABOUR", "TRANSPORT", "MISC"] as const;

const PRICING_TYPE_LABELS: Record<string, string> = {
  PER_DAY: "Per day",
  PER_WEEK: "Per week",
  FLAT: "Flat",
  PER_HOUR: "Per hour",
};
const PRICING_TYPE_ORDER = ["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR"] as const;

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

  const mutation = useServerMutation({
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
          <DialogTitle>Add service or other</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          className="space-y-4 py-2"
        >
          <div className="space-y-2">
            <Label htmlFor="svc-type">Type</Label>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="svc-type">
                    <SelectValue>{SERVICE_TYPE_LABELS[field.value ?? "SERVICE"] ?? "Service"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPE_ORDER.map((t) => (
                      <SelectItem key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svc-description">Description <span className="text-red">*</span></Label>
            <Input
              id="svc-description"
              {...form.register("description")}
              placeholder="e.g. Sound engineer — 8 hrs"
              aria-invalid={!!form.formState.errors.description}
            />
            {form.formState.errors.description && (
              <p className="t-micro text-t-out">
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
              <Label htmlFor="svc-unitPrice">Unit price ($)</Label>
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
              <Label htmlFor="svc-pricingType">Pricing type</Label>
              <Controller
                control={form.control}
                name="pricingType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="svc-pricingType">
                      <SelectValue>{PRICING_TYPE_LABELS[field.value ?? "FLAT"] ?? "Flat"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PRICING_TYPE_ORDER.map((p) => (
                        <SelectItem key={p} value={p}>{PRICING_TYPE_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
            <Label>Group name</Label>
            <Controller
              control={form.control}
              name="groupName"
              render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={existingGroups.map((g) => ({ value: g, label: g }))}
                  placeholder="e.g. Crew, Transport"
                  searchPlaceholder="Search or type new group…"
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
            <Button type="button" variant="line" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
