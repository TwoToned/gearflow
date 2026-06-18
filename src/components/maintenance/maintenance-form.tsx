"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import { X } from "lucide-react";

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
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import { FormSection, SectionHeader } from "@/components/layout/page-layouts";
import { cn, focusRing } from "@/lib/utils";
import {
  maintenanceTypeLabels,
  maintenanceStatusLabels,
  maintenanceResultLabels,
} from "@/lib/status-labels";
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

  const mutation = useServerMutation({
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

  function removeAsset(assetId: string) {
    const next = selectedAssetIds.filter((id) => id !== assetId);
    setSelectedAssetIds(next);
    form.setValue("assetIds", next);
  }

  function handleSubmit(data: MaintenanceFormValues) {
    mutation.mutate({ ...data, assetIds: selectedAssetIds });
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)}>
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-8">
          <SectionHeader label="Work order" />
          <FormSection>
            {/* Assets */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Assets *</Label>
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
              {selectedAssetIds.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {selectedAssetIds.map((id) => {
                    const opt = assetOptions.find((o: { value: string; label: string }) => o.value === id);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1 rounded-[var(--r)] border border-line bg-paper-2 py-1 pl-2.5 pr-1 text-ui-text text-ink"
                      >
                        <span className="min-w-0 break-words">{opt?.label || id}</span>
                        <button
                          type="button"
                          onClick={() => removeAsset(id)}
                          className={cn("shrink-0 rounded-full p-0.5 text-muted transition-colors hover:bg-elev hover:text-ink", focusRing)}
                          aria-label="Remove asset"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {form.formState.errors.assetIds && (
                <p className="text-caption text-t-out">
                  {form.formState.errors.assetIds.message}
                </p>
              )}
            </div>

            {/* Title */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" {...form.register("title")} placeholder="Brief description" aria-invalid={!!form.formState.errors.title} />
              {form.formState.errors.title && (
                <p className="text-caption text-t-out">
                  {form.formState.errors.title.message}
                </p>
              )}
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={typeValue}
                onValueChange={(v) => form.setValue("type", v as MaintenanceFormValues["type"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type">
                    {maintenanceTypeLabels[typeValue || ""] || typeValue}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REPAIR">{maintenanceTypeLabels.REPAIR}</SelectItem>
                  <SelectItem value="PREVENTATIVE">{maintenanceTypeLabels.PREVENTATIVE}</SelectItem>
                  <SelectItem value="TEST_AND_TAG">{maintenanceTypeLabels.TEST_AND_TAG}</SelectItem>
                  <SelectItem value="INSPECTION">{maintenanceTypeLabels.INSPECTION}</SelectItem>
                  <SelectItem value="CLEANING">{maintenanceTypeLabels.CLEANING}</SelectItem>
                  <SelectItem value="FIRMWARE_UPDATE">{maintenanceTypeLabels.FIRMWARE_UPDATE}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={statusValue}
                onValueChange={(v) => form.setValue("status", v as MaintenanceFormValues["status"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status">
                    {maintenanceStatusLabels[statusValue || ""] || statusValue}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHEDULED">{maintenanceStatusLabels.SCHEDULED}</SelectItem>
                  <SelectItem value="AWAITING_PARTS">{maintenanceStatusLabels.AWAITING_PARTS}</SelectItem>
                  <SelectItem value="IN_PROGRESS">{maintenanceStatusLabels.IN_PROGRESS}</SelectItem>
                  <SelectItem value="QA">{maintenanceStatusLabels.QA}</SelectItem>
                  <SelectItem value="COMPLETED">{maintenanceStatusLabels.COMPLETED}</SelectItem>
                  <SelectItem value="CANCELLED">{maintenanceStatusLabels.CANCELLED}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reported by */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Reported by</Label>
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...form.register("description")}
                placeholder="Detailed notes about the work..."
                rows={3}
              />
            </div>

            {/* Tags */}
            <div className="space-y-2 sm:col-span-2">
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
          </FormSection>

          <SectionHeader label="Schedule & cost" />
          <FormSection>
            {/* Dates row */}
            <div className="space-y-2">
              <Label htmlFor="scheduledDate">Scheduled date</Label>
              <Input id="scheduledDate" type="date" {...form.register("scheduledDate")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="completedDate">Completed date</Label>
              <Input id="completedDate" type="date" {...form.register("completedDate")} />
            </div>

            {/* Cost + Parts */}
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
              <Label htmlFor="partsUsed">Parts used</Label>
              <Input
                id="partsUsed"
                {...form.register("partsUsed")}
                placeholder="List parts..."
              />
            </div>
          </FormSection>

          <SectionHeader label="Photos" />
          <FormSection>
            {/* Photos — before/after evidence for the workshop card */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Photos</Label>
              <PhotoGridInput
                value={form.watch("photos") ?? []}
                onChange={(urls) => form.setValue("photos", urls, { shouldDirty: true })}
                onUploadingChange={setPhotosUploading}
              />
              <p className="text-badge text-faint">
                Up to 20 photos. Phones use the rear camera; desktop opens a file
                picker. Thumbnails show on the workshop kanban card.
              </p>
            </div>
          </FormSection>

          {/* Result + Next due */}
          {statusValue === "COMPLETED" && (
            <>
              <SectionHeader label="Outcome" />
              <FormSection>
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
                        {maintenanceResultLabels[form.watch("result") || ""] || "Select result..."}
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
                  <Label htmlFor="nextDueDate">Next due date</Label>
                  <Input id="nextDueDate" type="date" {...form.register("nextDueDate")} />
                </div>
              </FormSection>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          {photosUploading && (
            <span className="mr-auto text-caption text-faint">
              Wait for the photos to finish uploading before saving.
            </span>
          )}
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={photosUploading}>
            {photosUploading
              ? "Uploading photos..."
              : isEdit
                ? "Update record"
                : "Create record"}
          </Button>
        </div>
      </div>
    </form>
  );
}
