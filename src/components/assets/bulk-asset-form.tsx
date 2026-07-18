"use client";

import { useState, useEffect, useMemo } from "react";
import { AppImage } from "@/components/ui/app-image";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";
import { useBulkAssetWrites } from "@/hooks/use-bulk-asset-writes";
import { bulkAssetStatusLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { useModels } from "@/hooks/use-models";
import { useLocations } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField,
} from "@/components/ui/smart-form";
import { QuickCreateLocation } from "./quick-create-location";
import { useActiveOrganization } from "@/lib/auth-client";

interface BulkAssetFormProps {
  initialData?: BulkAssetFormValues & { id: string };
  preselectedModelId?: string;
}

const STATUS_ORDER = ["ACTIVE", "LOW_STOCK", "OUT_OF_STOCK", "RETIRED"] as const;

export function BulkAssetForm({ initialData, preselectedModelId }: BulkAssetFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive models (Convex). Org-scoped list returns all models; re-apply
  // getModels's default filter (active, bulk) and name sort client-side.
  const modelDocs = useModels(orgId);
  const models = useMemo(
    () =>
      [...(modelDocs ?? [])]
        .filter((m) => m.isActive === true && m.assetType === "BULK")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelDocs],
  );

  // Reactive location list from Convex; parent.name resolved from the flat list.
  const rawLocations = useLocations(orgId) ?? [];
  const locNameById = new Map(rawLocations.map((l) => [l.id, l.name]));
  const locations = rawLocations.map((l) => ({
    ...l,
    parent: l.parentId ? { name: locNameById.get(l.parentId) ?? "" } : null,
  }));

  const orgTags = useOrgTags(orgId);

  const form = useForm<BulkAssetFormValues>({
    resolver: zodResolver(bulkAssetSchema),
    defaultValues: initialData || {
      modelId: preselectedModelId || "",
      assetTag: "",
      totalQuantity: 0,
      status: "ACTIVE",
      notes: "",
      locationId: "",
      isActive: true,
    },
  });

  const v = form.watch();

  // Auto-populate asset tag for new bulk assets
  useEffect(() => {
    if (!isEditing && !form.getValues("assetTag")) {
      peekNextAssetTags(1).then(([tag]) => {
        form.setValue("assetTag", tag);
      }).catch(() => {
        // ignore — user can still type manually
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bulkWrites = useBulkAssetWrites();

  const mutation = useServerMutation({
    mutationFn: (data: BulkAssetFormValues) =>
      isEditing ? bulkWrites.update(initialData.id, data) : bulkWrites.create(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Bulk asset updated" : "Bulk asset created");
      router.push(`/assets/registry/${result.id}?type=bulk`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Live-preview derivations ──────────────────────────────────
  const selectedModel = models.find((m) => m.id === v.modelId);
  const modelLabel = selectedModel
    ? `${selectedModel.manufacturer ? `${selectedModel.manufacturer} ` : ""}${selectedModel.name}`
    : null;
  const modelImage = selectedModel?.image || selectedModel?.images?.[0] || null;
  const previewName = (modelLabel || "New bulk stock").trim();
  const quantity = Number(v.totalQuantity) || 0;
  const statusLabel = bulkAssetStatusLabels[v.status ?? "ACTIVE"] ?? "Active";

  const helperTip = !v.modelId
    ? "Start with the model — bulk stock is tracked by quantity against it."
    : quantity <= 0
      ? "Set the quantity on hand so checkout knows what's available."
      : "Looking good. Price, location and notes are optional — fill what you know.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New bulk stock"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)]">
              <div className="relative flex aspect-[5/3] items-center justify-center overflow-hidden bg-paper-2">
                {modelImage ? (
                  <AppImage src={modelImage} alt={modelLabel ?? "Bulk stock"} fill sizes="(max-width: 768px) 100vw, 400px" className="object-cover" />
                ) : (
                  <Layers className="h-8 w-8 text-faint" strokeWidth={1.5} />
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn("text-card-title font-semibold leading-tight", previewName === "New bulk stock" ? "text-faint" : "text-ink")}>
                    {previewName}
                  </p>
                  <span className={cn("shrink-0 t-mono text-caption", quantity > 0 ? "text-ink-2" : "text-faint")}>
                    ×{quantity}
                  </span>
                </div>
                <div className="pt-0.5">
                  <StatusIndicator category="bulkAsset" value={v.status ?? "ACTIVE"} label={statusLabel} variant="pill" />
                </div>
              </div>
            </div>
          </SmartFormPreview>
        </>
      }
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="The model and how much is on hand." divider={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Equipment model" required error={form.formState.errors.modelId?.message}>
                <Controller control={form.control} name="modelId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={(val) => field.onChange(val)}
                    options={models.map((m) => ({
                      value: m.id,
                      label: `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.name}`,
                      description: m.modelNumber || undefined,
                    }))}
                    placeholder="Select a model…"
                    searchPlaceholder="Search models…"
                    emptyMessage="No models found."
                    onCreateNew={() => router.push("/assets/models/new")}
                    createNewLabel="New model"
                  />
                )} />
              </SmartFormField>
            </div>
            <SmartFormField
              label="Asset tag"
              required
              hint={!isEditing ? "Pre-filled from your next sequence — edit it or scan a label." : undefined}
              error={form.formState.errors.assetTag?.message}
            >
              <AssetTagInput
                {...form.register("assetTag")}
                aria-invalid={!!form.formState.errors.assetTag}
                onScan={(val) => form.setValue("assetTag", val)}
                placeholder="e.g. AV-SM57"
                className="font-mono"
              />
            </SmartFormField>
            <SmartFormField label="Total quantity" required error={form.formState.errors.totalQuantity?.message}>
              <Input type="number" {...form.register("totalQuantity")} aria-invalid={!!form.formState.errors.totalQuantity} />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Status & location */}
        <SmartFormSection title="Status & location" hint="Where it lives and its stock state.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Status">
              <Controller control={form.control} name="status" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue>{bulkAssetStatusLabels[field.value ?? "ACTIVE"] ?? "Active"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{bulkAssetStatusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </SmartFormField>
            <SmartFormField label="Location">
              <Controller control={form.control} name="locationId" render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={locations.map((loc) => ({
                    value: loc.id,
                    label: loc.parent ? `${loc.parent.name} → ${loc.name}` : loc.name,
                    description: loc.type,
                  }))}
                  placeholder="No location"
                  searchPlaceholder="Search locations…"
                  emptyMessage="No locations found."
                  onCreateNew={() => setShowCreateLocation(true)}
                  createNewLabel="New location"
                  allowClear
                />
              )} />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* More details — progressive disclosure */}
        <section className="border-t border-line pt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="more" className="border-line">
              <AccordionTrigger>More details</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 pt-1">
                  <SmartFormField label="Price per unit ($)" hint="Optional — handy for valuation reports.">
                    <Input type="number" step="0.01" {...form.register("purchasePricePerUnit")} placeholder="0.00" />
                  </SmartFormField>
                  <SmartFormField label="Notes">
                    <Textarea {...form.register("notes")} placeholder="Any additional notes" rows={3} />
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

      <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
        <Button type="button" variant="line" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEditing ? "Update bulk asset" : "Create bulk asset"}
        </Button>
      </div>

      <QuickCreateLocation
        open={showCreateLocation}
        onOpenChange={setShowCreateLocation}
        onCreated={(id) => form.setValue("locationId", id)}
      />
    </SmartFormLayout>
  );
}
