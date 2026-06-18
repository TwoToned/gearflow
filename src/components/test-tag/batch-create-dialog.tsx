"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { batchCreateTestTagSchema, type BatchCreateTestTagFormValues } from "@/lib/validations/test-tag";
import { createTestTagAssetsFromBulk } from "@/server/test-tag-assets";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const equipmentClassOptions = [
  { value: "CLASS_I", label: "Class I" },
  { value: "CLASS_II", label: "Class II" },
  { value: "CLASS_II_DOUBLE_INSULATED", label: "Class II (double insulated)" },
  { value: "LEAD_CORD_ASSEMBLY", label: "Lead / cord assembly" },
];

const applianceTypeOptions = [
  { value: "APPLIANCE", label: "Appliance" },
  { value: "CORD_SET", label: "Cord set" },
  { value: "EXTENSION_LEAD", label: "Extension lead" },
  { value: "POWER_BOARD", label: "Power board" },
  { value: "RCD_PORTABLE", label: "RCD (portable)" },
  { value: "RCD_FIXED", label: "RCD (fixed)" },
  { value: "THREE_PHASE", label: "Three phase" },
  { value: "OTHER", label: "Other" },
];

interface BatchCreateDialogProps {
  bulkAssetId: string;
  bulkAssetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful batch create so the host can refresh its list. */
  onCreated?: () => void;
}

export function BatchCreateDialog({
  bulkAssetId,
  bulkAssetName,
  open,
  onOpenChange,
  onCreated,
}: BatchCreateDialogProps) {

  const form = useForm<BatchCreateTestTagFormValues>({
    resolver: zodResolver(batchCreateTestTagSchema),
    defaultValues: {
      bulkAssetId,
      count: 1,
      description: bulkAssetName,
      equipmentClass: "CLASS_I",
      applianceType: "APPLIANCE",
      testIntervalMonths: 3,
      make: "",
      modelName: "",
      location: "",
    },
  });

  // Reset form when dialog opens with new props
  useEffect(() => {
    if (open) {
      form.reset({
        bulkAssetId,
        count: 1,
        description: bulkAssetName,
        equipmentClass: "CLASS_I",
        applianceType: "APPLIANCE",
        testIntervalMonths: 3,
        make: "",
        modelName: "",
        location: "",
      });
    }
  }, [open, bulkAssetId, bulkAssetName, form]);

  const mutation = useServerMutation({
    mutationFn: (data: BatchCreateTestTagFormValues) =>
      createTestTagAssetsFromBulk({
        bulkAssetId: data.bulkAssetId,
        count: Number(data.count),
        description: data.description,
        equipmentClass: data.equipmentClass,
        applianceType: data.applianceType,
        testIntervalMonths: Number(data.testIntervalMonths),
        make: data.make || undefined,
        modelName: data.modelName || undefined,
        location: data.location || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Created ${result.count} test tag items`);
      onCreated?.();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Batch create test & tag items</DialogTitle>
          <DialogDescription>
            Create multiple test & tag items linked to {bulkAssetName}.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="count">Count *</Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={500}
                {...form.register("count")}
              aria-invalid={!!form.formState.errors.count}
              />
              {form.formState.errors.count && (
                <p className="text-caption text-t-out">
                  {form.formState.errors.count.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="testIntervalMonths">Test interval (months)</Label>
              <Input
                id="testIntervalMonths"
                type="number"
                min={1}
                max={120}
                {...form.register("testIntervalMonths")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-description">Description *</Label>
            <Input
              id="batch-description"
              {...form.register("description")}
              placeholder="Description for each item"
              aria-invalid={!!form.formState.errors.description}
            />
            {form.formState.errors.description && (
              <p className="text-caption text-t-out">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Equipment class</Label>
              <Select
                value={form.watch("equipmentClass")}
                onValueChange={(v) => v && form.setValue("equipmentClass", v as BatchCreateTestTagFormValues["equipmentClass"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {equipmentClassOptions.find((o) => o.value === form.watch("equipmentClass"))?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {equipmentClassOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Appliance type</Label>
              <Select
                value={form.watch("applianceType")}
                onValueChange={(v) => v && form.setValue("applianceType", v as BatchCreateTestTagFormValues["applianceType"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {applianceTypeOptions.find((o) => o.value === form.watch("applianceType"))?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {applianceTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Make</Label>
              <Input {...form.register("make")} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Input {...form.register("modelName")} placeholder="Optional" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-location">Location</Label>
            <Input
              id="batch-location"
              {...form.register("location")}
              placeholder="e.g. Warehouse A"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="line"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Create {Number(form.watch("count")) || 0} items
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
