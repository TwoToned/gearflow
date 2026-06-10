"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import { X, Camera } from "lucide-react";

import {
  maintenanceSchema,
  type MaintenanceFormValues,
} from "@/lib/validations/maintenance";
import {
  createMaintenanceRecord,
  updateMaintenanceRecord,
  getAssetsForMaintenanceSelect,
} from "@/server/maintenance";
import { getMembers } from "@/server/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { BarcodeScanner } from "@/components/ui/barcode-scanner";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";

const typeLabels: Record<string, string> = {
  REPAIR: "Repair",
  PREVENTATIVE: "Preventative",
  INSPECTION: "Inspection",
  CLEANING: "Cleaning",
  FIRMWARE_UPDATE: "Firmware Update",
};

const statusLabels: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

interface MaintenanceFormProps {
  initialData?: MaintenanceFormValues & { id: string };
}

export function MaintenanceForm({ initialData }: MaintenanceFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: assets } = useServerQuery({
    queryKey: ["maintenance-assets", orgId],
    queryFn: getAssetsForMaintenanceSelect,
  });

  const { data: members } = useServerQuery({
    queryKey: ["members", orgId],
    queryFn: getMembers,
  });

  const orgTags = useOrgTags(orgId);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(
    initialData?.assetIds?.length
      ? initialData.assetIds
      : initialData?.assetId
        ? [initialData.assetId]
        : []
  );

  const form = useForm<MaintenanceFormValues>({
    resolver: zodResolver(maintenanceSchema),
    defaultValues: initialData || {
      assetIds: [],
      reportedById: undefined,
      type: "REPAIR",
      status: "SCHEDULED",
      title: "",
      description: "",
      scheduledDate: "",
      completedDate: "",
      cost: undefined,
      partsUsed: "",
      photos: [],
      result: undefined,
      nextDueDate: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: MaintenanceFormValues) =>
      isEdit
        ? updateMaintenanceRecord(initialData!.id, data)
        : createMaintenanceRecord(data),
    onSuccess: () => {
      toast.success(isEdit ? "Record updated" : "Record created");
      router.push("/maintenance");
    },
    onError: (e) => toast.error(e.message),
  });

  const statusValue = form.watch("status");
  const typeValue = form.watch("type");
  const reportedByValue = form.watch("reportedById");

  const memberOptions = (members || []).map((m: Record<string, unknown>) => {
    const user = m.user as Record<string, unknown>;
    return { value: user.id as string, label: (user.name as string) || (user.email as string) };
  });

  const assetOptions = (assets || []).map((a: { id: string; label: string }) => ({
    value: a.id,
    label: a.label,
  }));

  // Filter out already-selected assets from combobox options
  const availableOptions = assetOptions.filter(
    (opt: { value: string }) => !selectedAssetIds.includes(opt.value)
  );

  function addAsset(assetId: string) {
    if (!assetId || selectedAssetIds.includes(assetId)) return;
    const next = [...selectedAssetIds, assetId];
    setSelectedAssetIds(next);
    form.setValue("assetIds", next);
    form.clearErrors("assetIds");
  }

  function handleScan(value: string) {
    const lower = value.toLowerCase();
    // Match by asset tag (label format: "TAG — Model Name")
    const match = assetOptions.find((opt: { value: string; label: string }) => {
      const tag = opt.label.split(" — ")[0];
      return tag?.toLowerCase() === lower;
    });
    if (match) {
      if (selectedAssetIds.includes(match.value)) {
        toast.info("Asset already selected");
      } else {
        addAsset(match.value);
        toast.success(`Added ${match.label}`);
      }
    } else {
      toast.error(`No asset found for "${value}"`);
    }
  }

  function removeAsset(assetId: string) {
    const next = selectedAssetIds.filter((id) => id !== assetId);
    setSelectedAssetIds(next);
    form.setValue("assetIds", next);
  }

  function handleSubmit(data: MaintenanceFormValues) {
    mutation.mutate({ ...data, assetIds: selectedAssetIds });
  }

  return (
    <form
      onSubmit={form.handleSubmit(handleSubmit)}
      className="space-y-6 max-w-2xl"
    >
      {/* Assets */}
      <div className="space-y-2">
        <Label>Assets *</Label>
        <div className="flex gap-2">
          <div className="flex-1">
            <ComboboxPicker
              value=""
              onChange={(v) => {
                addAsset(v);
              }}
              options={availableOptions}
              placeholder="Search and select assets..."
              searchPlaceholder="Search by tag, model, or name..."
              emptyMessage={
                selectedAssetIds.length > 0 && availableOptions.length === 0
                  ? "All matching assets already selected."
                  : "No assets found."
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setCameraOpen((v) => !v)}
            className={cameraOpen ? "text-primary bg-primary/10 border-primary/30" : ""}
          >
            <Camera className="h-4 w-4" />
          </Button>
        </div>
        {cameraOpen && (
          <BarcodeScanner
            open={cameraOpen}
            onScan={handleScan}
            onClose={() => setCameraOpen(false)}
            title="Scan asset barcode"
            continuous
          />
        )}
        {selectedAssetIds.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {selectedAssetIds.map((id) => {
              const opt = assetOptions.find((o: { value: string; label: string }) => o.value === id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-1 rounded-md border bg-secondary text-secondary-foreground text-sm py-1 pl-2.5 pr-1"
                >
                  <span className="break-words min-w-0">{opt?.label || id}</span>
                  <button
                    type="button"
                    onClick={() => removeAsset(id)}
                    className="shrink-0 rounded-full p-0.5 hover:bg-foreground/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {form.formState.errors.assetIds && (
          <p className="text-sm text-destructive">
            {form.formState.errors.assetIds.message}
          </p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input id="title" {...form.register("title")} placeholder="Brief description" />
        {form.formState.errors.title && (
          <p className="text-sm text-destructive">
            {form.formState.errors.title.message}
          </p>
        )}
      </div>

      {/* Type + Status row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={typeValue}
            onValueChange={(v) => form.setValue("type", v as MaintenanceFormValues["type"])}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type">
                {typeLabels[typeValue || ""] || typeValue}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REPAIR">Repair</SelectItem>
              <SelectItem value="PREVENTATIVE">Preventative</SelectItem>
              <SelectItem value="INSPECTION">Inspection</SelectItem>
              <SelectItem value="CLEANING">Cleaning</SelectItem>
              <SelectItem value="FIRMWARE_UPDATE">Firmware Update</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={statusValue}
            onValueChange={(v) => form.setValue("status", v as MaintenanceFormValues["status"])}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status">
                {statusLabels[statusValue || ""] || statusValue}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
              <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Reported By */}
      <div className="space-y-2">
        <Label>Reported By</Label>
        <Select
          value={reportedByValue || ""}
          onValueChange={(v) => form.setValue("reportedById", v || undefined)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select user">
              {memberOptions.find((o: { value: string }) => o.value === reportedByValue)?.label || "Select user"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {memberOptions.map((m: { value: string; label: string }) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          {...form.register("description")}
          placeholder="Detailed notes about the work..."
          rows={3}
        />
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <Label>Tags</Label>
        <Controller
          name="tags"
          control={form.control}
          render={({ field }) => (
            <TagInput
              value={field.value ?? []}
              onChange={field.onChange}
              suggestions={orgTags}
              placeholder="Add tags..."
            />
          )}
        />
      </div>

      {/* Dates row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="scheduledDate">Scheduled Date</Label>
          <Input id="scheduledDate" type="date" {...form.register("scheduledDate")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="completedDate">Completed Date</Label>
          <Input id="completedDate" type="date" {...form.register("completedDate")} />
        </div>
      </div>

      {/* Cost + Parts */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cost">Cost ($)</Label>
          <Input
            id="cost"
            type="number"
            step="0.01"
            {...form.register("cost")}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="partsUsed">Parts Used</Label>
          <Input
            id="partsUsed"
            {...form.register("partsUsed")}
            placeholder="List parts..."
          />
        </div>
      </div>

      {/* Photos — before/after evidence for the workshop card */}
      <div className="space-y-2">
        <Label>Photos</Label>
        <PhotoGridInput
          value={form.watch("photos") ?? []}
          onChange={(urls) => form.setValue("photos", urls, { shouldDirty: true })}
          onUploadingChange={setPhotosUploading}
        />
        <p className="text-[11px] text-fg-4">
          Up to 20 photos. Phones use the rear camera; desktop opens a file
          picker. Thumbnails show on the workshop kanban card.
        </p>
      </div>

      {/* Result + Next Due */}
      {statusValue === "COMPLETED" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Result</Label>
            <Select
              value={form.watch("result") || ""}
              onValueChange={(v) =>
                form.setValue("result", (v || undefined) as MaintenanceFormValues["result"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select result...">
                  {({ PASS: "Pass", FAIL: "Fail", CONDITIONAL: "Conditional" } as Record<string, string>)[form.watch("result") || ""] || "Select result..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PASS">Pass</SelectItem>
                <SelectItem value="FAIL">Fail</SelectItem>
                <SelectItem value="CONDITIONAL">Conditional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nextDueDate">Next Due Date</Label>
            <Input id="nextDueDate" type="date" {...form.register("nextDueDate")} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={mutation.isPending || photosUploading}>
          {mutation.isPending
            ? "Saving..."
            : photosUploading
              ? "Uploading photos..."
              : isEdit
                ? "Update Record"
                : "Create Record"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {photosUploading && (
          <span className="text-xs text-fg-4">
            Wait for the photos to finish uploading before saving.
          </span>
        )}
      </div>
    </form>
  );
}
