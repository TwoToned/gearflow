"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { api } from "../../../convex/_generated/api";
import { toast } from "sonner";
import { Wrench, X } from "lucide-react";

import {
  maintenanceSchema,
  type MaintenanceFormValues,
} from "@/lib/validations/maintenance";
import { getMembers } from "@/server/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import { StatusIndicator } from "@/components/ui/status-indicator";
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
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField, SmartFormPreviewPill,
} from "@/components/ui/smart-form";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";

interface MaintenanceFormProps {
  initialData?: MaintenanceFormValues & { id: string };
}

const TYPE_ORDER = [
  "REPAIR",
  "PREVENTATIVE",
  "TEST_AND_TAG",
  "INSPECTION",
  "CLEANING",
  "FIRMWARE_UPDATE",
] as const;
const STATUS_ORDER = [
  "SCHEDULED",
  "AWAITING_PARTS",
  "IN_PROGRESS",
  "QA",
  "COMPLETED",
  "CANCELLED",
] as const;
const RESULT_ORDER = ["PASS", "FAIL", "CONDITIONAL"] as const;

export function MaintenanceForm({ initialData }: MaintenanceFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const assets = useAuthedQuery(
    api.maintenanceRecords.assetsForSelect,
    orgId ? { orgId } : "skip",
  );

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

  const v = form.watch();

  const writes = useMaintenanceWrites();

  const mutation = useServerMutation({
    mutationFn: (data: MaintenanceFormValues) =>
      isEdit
        ? writes.update(initialData!.id, data)
        : writes.create(data),
    onSuccess: () => {
      toast.success(isEdit ? "Record updated" : "Record created");
      router.push("/maintenance");
    },
    onError: (e) => toast.error(e.message),
  });

  const statusValue = v.status;
  const typeValue = v.type;
  const reportedByValue = v.reportedById;

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

  // ─── Live-preview derivations ──────────────────────────────────
  const previewTitle = (v.title || "New work order").trim();
  const typeLabel = maintenanceTypeLabels[typeValue || "REPAIR"] || "Repair";
  const statusLabel = maintenanceStatusLabels[statusValue || "SCHEDULED"] || "Scheduled";
  const targetCount = selectedAssetIds.length;
  const firstTarget = targetCount > 0
    ? (assetOptions.find((o: { value: string; label: string }) => o.value === selectedAssetIds[0])?.label || null)
    : null;
  const targetLine = targetCount === 0
    ? "No assets yet"
    : targetCount === 1
      ? firstTarget || "1 asset"
      : `${firstTarget || "1 asset"} + ${targetCount - 1} more`;

  const helperTip = targetCount === 0
    ? "Start with the assets — pick everything this work order covers."
    : !v.title
      ? "Give it a title so the workshop board reads at a glance."
      : "Looking good. Schedule, cost and outcome can be filled as the work progresses.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit(handleSubmit)}
      aside={
        <>
          <SmartFormRail eyebrow={isEdit ? "Editing" : "New work order"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                  <Wrench className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={cn("text-card-title font-semibold leading-tight", previewTitle === "New work order" ? "text-faint" : "text-ink")}>
                    {previewTitle}
                  </p>
                  <p className={cn("text-caption", targetCount > 0 ? "text-muted" : "text-faint")}>
                    {targetLine}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <StatusIndicator category="maintenance" value={statusValue || "SCHEDULED"} label={statusLabel} variant="pill" />
                    <SmartFormPreviewPill>{typeLabel}</SmartFormPreviewPill>
                  </div>
                </div>
              </div>
            </div>
          </SmartFormPreview>
        </>
      }
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="What's being worked on and why." divider={false}>
          <div className="space-y-5">
            {/* Assets — multi-select builder */}
            <SmartFormField label="Assets" required error={form.formState.errors.assetIds?.message}>
              <ComboboxPicker
                value=""
                onChange={(val) => addAsset(val)}
                options={availableOptions}
                placeholder="Search and select assets…"
                searchPlaceholder="Search by tag, model, or name…"
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
            </SmartFormField>

            <SmartFormField label="Title" required error={form.formState.errors.title?.message}>
              <Input
                {...form.register("title")}
                placeholder="Brief description"
                aria-invalid={!!form.formState.errors.title}
              />
            </SmartFormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <SmartFormField label="Type">
                <Controller control={form.control} name="type" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{maintenanceTypeLabels[field.value || "REPAIR"] || "Repair"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>{maintenanceTypeLabels[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </SmartFormField>
              <SmartFormField label="Status">
                <Controller control={form.control} name="status" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{maintenanceStatusLabels[field.value || "SCHEDULED"] || "Scheduled"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>{maintenanceStatusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </SmartFormField>
            </div>

            <SmartFormField label="Reported by">
              <Controller control={form.control} name="reportedById" render={({ field }) => (
                <Select
                  value={field.value || ""}
                  onValueChange={(val) => field.onChange(val || undefined)}
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
              )} />
            </SmartFormField>

            <SmartFormField label="Description">
              <Textarea
                {...form.register("description")}
                placeholder="Detailed notes about the work…"
                rows={3}
              />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Schedule */}
        <SmartFormSection title="Schedule" hint="When the work is planned and finished.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Scheduled date">
              <Input type="date" {...form.register("scheduledDate")} />
            </SmartFormField>
            <SmartFormField label="Completed date">
              <Input type="date" {...form.register("completedDate")} />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Outcome */}
        <SmartFormSection title="Outcome" hint="Cost, parts and the result once the work is done.">
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <SmartFormField label="Cost ($)">
                <Input type="number" step="0.01" {...form.register("cost")} placeholder="0.00" />
              </SmartFormField>
              <SmartFormField label="Parts used">
                <Input {...form.register("partsUsed")} placeholder="List parts…" />
              </SmartFormField>
            </div>
            {statusValue === "COMPLETED" && (
              <div className="grid gap-5 sm:grid-cols-2">
                <SmartFormField label="Result">
                  <Controller control={form.control} name="result" render={({ field }) => (
                    <Select
                      value={field.value || ""}
                      onValueChange={(val) => field.onChange((val || undefined) as MaintenanceFormValues["result"])}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select result…">
                          {maintenanceResultLabels[field.value || ""] || "Select result…"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {RESULT_ORDER.map((r) => (
                          <SelectItem key={r} value={r}>{maintenanceResultLabels[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </SmartFormField>
                <SmartFormField label="Next due date">
                  <Input type="date" {...form.register("nextDueDate")} />
                </SmartFormField>
              </div>
            )}
          </div>
        </SmartFormSection>

        {/* More details — progressive disclosure */}
        <section className="border-t border-line pt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="more" className="border-line">
              <AccordionTrigger>More details</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 pt-1">
                  <SmartFormField
                    label="Photos"
                    hint="Up to 20 photos. Phones use the rear camera; desktop opens a file picker. Thumbnails show on the workshop kanban card."
                  >
                    <PhotoGridInput
                      value={v.photos ?? []}
                      onChange={(urls) => form.setValue("photos", urls, { shouldDirty: true })}
                      onUploadingChange={setPhotosUploading}
                    />
                  </SmartFormField>
                  <SmartFormField label="Tags">
                    <Controller
                      name="tags"
                      control={form.control}
                      render={({ field }) => (
                        <TagInput
                          value={field.value ?? []}
                          onChange={field.onChange}
                          suggestions={orgTags}
                          placeholder="Add tags…"
                        />
                      )}
                    />
                  </SmartFormField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
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
            ? "Uploading photos…"
            : isEdit
              ? "Update record"
              : "Create record"}
        </Button>
      </div>
    </SmartFormLayout>
  );
}
