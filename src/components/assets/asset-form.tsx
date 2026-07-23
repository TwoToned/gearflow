"use client";

import { useState, useEffect, useMemo } from "react";
import { AppImage } from "@/components/ui/app-image";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Plus, X, Package } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { peekNextAssetTags } from "@/server/settings";
import { assetStatusLabels, conditionLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useModels } from "@/hooks/use-models";
import { useLocations } from "@/hooks/use-locations";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useActiveOrganization } from "@/lib/auth-client";
import { TagInput } from "@/components/ui/tag-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { SmartFormActions } from "@/components/ui/smart-form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { QuickCreateLocation } from "./quick-create-location";
import { QuickCreateSupplier } from "./quick-create-supplier";
import { CustomFieldsInput } from "@/components/custom-fields/custom-fields-input";

interface AssetFormProps {
  initialData?: AssetFormValues & { id: string };
  preselectedModelId?: string;
}

const STATUS_ORDER = ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RESERVED", "RETIRED", "LOST"] as const;
const CONDITION_ORDER = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

export function AssetForm({ initialData, preselectedModelId }: AssetFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [extraAssets, setExtraAssets] = useState<{ tag: string; serialNumber: string }[]>([]);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive models (Convex). Org-scoped list returns all models; re-apply
  // getModels's default filter (active, serialized) and name sort client-side.
  const modelDocs = useModels(orgId);
  const models = useMemo(
    () =>
      [...(modelDocs ?? [])]
        .filter((m) => m.isActive === true && m.assetType === "SERIALIZED")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelDocs],
  );

  // Reactive location list from Convex; a location added via quick-create now
  // appears in the dropdown instantly. parent.name resolved from the flat list
  // (the Convex doc carries parentId, not a parent relation).
  const rawLocations = useLocations(orgId) ?? [];
  const locNameById = new Map(rawLocations.map((l) => [l.id, l.name]));
  const locations = rawLocations.map((l) => ({
    ...l,
    parent: l.parentId ? { name: locNameById.get(l.parentId) ?? "" } : null,
  }));

  // Reactive supplier list from Convex; a supplier added via the quick-create
  // dialog now appears in the dropdown instantly. Active-only (matches the old
  // getSuppliers where: isActive).
  const allSuppliers = useSuppliers(orgId);
  const suppliers = (allSuppliers ?? []).filter((s) => s.isActive ?? true);

  const orgTags = useOrgTags(orgId);

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: initialData || {
      modelId: preselectedModelId || "",
      assetTag: "",
      serialNumber: "",
      customName: "",
      status: "AVAILABLE",
      condition: "NEW",
      notes: "",
      locationId: "",
      isActive: true,
      images: [],
    },
  });

  const v = form.watch();

  // Auto-populate asset tag for new assets (preview only, no counter increment)
  useEffect(() => {
    if (!isEditing && !form.getValues("assetTag")) {
      peekNextAssetTags(1).then(([tag]) => {
        form.setValue("assetTag", tag);
      }).catch(() => {
        // ignore — user can still type manually
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addExtraAsset = async () => {
    try {
      // Peek at the next N+1 tags (current count + 1) and use the last one
      const totalNeeded = 1 + extraAssets.length + 1;
      const tags = await peekNextAssetTags(totalNeeded);
      setExtraAssets((prev) => [...prev, { tag: tags[tags.length - 1], serialNumber: "" }]);
    } catch {
      setExtraAssets((prev) => [...prev, { tag: "", serialNumber: "" }]);
    }
  };

  const removeExtraAsset = (index: number) => {
    setExtraAssets((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExtraAsset = (index: number, field: "tag" | "serialNumber", value: string) => {
    setExtraAssets((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  const assetWrites = useAssetWrites();

  const mutation = useServerMutation({
    mutationFn: async (data: AssetFormValues) => {
      if (isEditing) {
        return assetWrites.update(initialData.id, data);
      }
      if (extraAssets.length > 0) {
        const allAssets = [
          { tag: data.assetTag, serialNumber: data.serialNumber || "" },
          ...extraAssets,
        ].filter((a) => a.tag);
        return assetWrites.createMany(data, allAssets);
      }
      return assetWrites.create(data);
    },
    onSuccess: (result) => {
      if (isEditing) {
        toast.success("Asset updated");
        router.push(`/assets/registry/${(result as { id: string }).id}`);
      } else if (extraAssets.length > 0) {
        toast.success(`${extraAssets.length + 1} assets created`);
        router.push("/assets/registry");
      } else {
        toast.success("Asset created");
        router.push(`/assets/registry/${(result as { id: string }).id}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const totalCount = 1 + extraAssets.length;

  // ─── Live-preview derivations ──────────────────────────────────
  const selectedModel = models.find((m) => m.id === v.modelId);
  const modelLabel = selectedModel
    ? `${selectedModel.manufacturer ? `${selectedModel.manufacturer} ` : ""}${selectedModel.name}`
    : null;
  const modelImage = selectedModel?.image || selectedModel?.images?.[0] || null;
  const previewName = (v.customName || modelLabel || "New asset").trim();
  const previewTag = (v.assetTag || "").trim();
  const statusLabel = assetStatusLabels[v.status ?? "AVAILABLE"] ?? "Available";

  const helperTip = !v.modelId
    ? "Pick the model first — the unit inherits its rates, specs and category from it. We've already grabbed the next tag."
    : !previewTag
      ? "An asset tag is how the warehouse finds this on a shelf. We pre-filled the next one."
      : "Looking good. Status, location and purchase details are all optional — fill what you know.";

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="grid gap-6 lg:grid-cols-[1fr_280px]">
      {/* ─── Main form column ─────────────────────────────────── */}
      <div className="rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-8">
          {/* Identity */}
          <section className="space-y-5">
            <SectionTitle title="Identity" hint="What it is and how you'll find it." />
            <Field label="Equipment model" required error={form.formState.errors.modelId?.message}>
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
            </Field>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="flex-none">Asset tag<span className="text-red"> *</span></Label>
                <Label className="flex-none text-muted">/ Serial number</Label>
              </div>
              <div className="flex gap-2">
                <AssetTagInput {...form.register("assetTag")} onScan={(val) => form.setValue("assetTag", val)} placeholder="Asset tag" className="flex-1 font-mono" />
                <Input {...form.register("serialNumber")} placeholder="Serial number" className="flex-1" />
                {!isEditing && (
                  <Button type="button" variant="line" size="icon" className="shrink-0" onClick={addExtraAsset} title="Add another asset">
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {form.formState.errors.assetTag && (
                <p className="t-micro text-t-out">{form.formState.errors.assetTag.message}</p>
              )}
              {!isEditing && !form.formState.errors.assetTag && (
                <p className="t-micro text-muted">Pre-filled from your next sequence — edit it or scan a label.</p>
              )}
              {extraAssets.map((asset, i) => (
                <div key={i} className="flex gap-2">
                  <AssetTagInput
                    value={asset.tag}
                    onChange={(e) => updateExtraAsset(i, "tag", e.target.value)}
                    onScan={(val) => updateExtraAsset(i, "tag", val)}
                    placeholder="Asset tag"
                    className="flex-1 font-mono"
                  />
                  <Input
                    value={asset.serialNumber}
                    onChange={(e) => updateExtraAsset(i, "serialNumber", e.target.value)}
                    placeholder="Serial number"
                    className="flex-1"
                  />
                  <Button type="button" variant="line" size="icon" className="shrink-0" onClick={() => removeExtraAsset(i)} title="Remove">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {extraAssets.length > 0 && (
                <p className="t-micro text-muted">
                  Creating {totalCount} assets with the same model & details.
                </p>
              )}
            </div>

            <Field label="Custom name" hint="An optional friendly name, e.g. FOH Console 1.">
              <Input {...form.register("customName")} placeholder="e.g. FOH Console 1" />
            </Field>
          </section>

          {/* Condition & location */}
          <section className="space-y-5 border-t border-line pt-6">
            <SectionTitle title="Condition & location" hint="Where it lives and what shape it's in." />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Status">
                <Controller control={form.control} name="status" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{assetStatusLabels[field.value ?? "AVAILABLE"] ?? "Available"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>{assetStatusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Condition">
                <Controller control={form.control} name="condition" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{conditionLabels[field.value ?? "NEW"] ?? "New"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_ORDER.map((c) => (
                        <SelectItem key={c} value={c}>{conditionLabels[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Location">
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
                </Field>
              </div>
            </div>
          </section>

          {/* Purchase */}
          <section className="space-y-5 border-t border-line pt-6">
            <SectionTitle title="Purchase" hint="Optional — handy for warranty & depreciation." />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Purchase date">
                <Input type="date" {...form.register("purchaseDate")} />
              </Field>
              <Field label="Purchase price ($)">
                <Input type="number" step="0.01" {...form.register("purchasePrice")} placeholder="0.00" />
              </Field>
              <Field label="Supplier">
                <Controller control={form.control} name="supplierId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={(suppliers as Array<{ id: string; name: string; contactName?: string | null }>).map((s) => ({
                      value: s.id,
                      label: s.name,
                      description: s.contactName || undefined,
                    }))}
                    placeholder="No supplier"
                    searchPlaceholder="Search suppliers…"
                    emptyMessage="No suppliers found."
                    onCreateNew={() => setShowCreateSupplier(true)}
                    createNewLabel="New supplier"
                    allowClear
                  />
                )} />
              </Field>
              {v.supplierId && (
                <Field label="Purchase order #">
                  <Input {...form.register("purchaseOrderNumber")} placeholder="e.g. PO-2024-001" />
                </Field>
              )}
              <Field label="Warranty expiry">
                <Input type="date" {...form.register("warrantyExpiry")} />
              </Field>
            </div>
          </section>

          {/* More details — progressive disclosure */}
          <section className="border-t border-line pt-6">
            <Accordion type="single" collapsible>
              <AccordionItem value="more" className="border-line">
                <AccordionTrigger>More details</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-5 pt-1">
                    {/* Operator-defined custom fields — renders nothing if none configured */}
                    <Controller
                      name="customFieldValues"
                      control={form.control}
                      render={({ field }) => (
                        <CustomFieldsInput
                          entityType="ASSET"
                          values={(field.value as Record<string, string>) ?? {}}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <Field label="Notes">
                      <Textarea {...form.register("notes")} placeholder="Any additional notes" rows={3} />
                    </Field>
                    <Field label="Tags">
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
                    </Field>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>
        </div>

        <SmartFormActions>
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? "Update asset" : totalCount > 1 ? `Create ${totalCount} assets` : "Create asset"}
          </Button>
        </SmartFormActions>
      </div>

      {/* ─── Helper rail ──────────────────────────────────────── */}
      <aside className="hidden lg:block">
        <div className="sticky top-4 space-y-4 rounded-[var(--r-lg)] border border-line bg-paper-2/50 p-4">
          <div>
            <p className="t-overline text-faint">{isEditing ? "Editing" : "New asset"}</p>
            <p className="mt-1 font-hand text-[15px] text-t-out">{helperTip}</p>
          </div>

          {/* Live preview — a mini gear card that fills in as you type */}
          <div className="space-y-2 border-t border-line pt-3">
            <p className="t-overline text-faint">Preview</p>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)]">
              <div className="relative flex aspect-[5/3] items-center justify-center overflow-hidden bg-paper-2">
                {modelImage ? (
                  <AppImage src={modelImage} alt={modelLabel ?? "Asset"} fill sizes="(max-width: 768px) 100vw, 400px" className="object-cover" />
                ) : (
                  <Package className="h-8 w-8 text-faint" strokeWidth={1.5} />
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <p className={cn("text-card-title font-semibold leading-tight", previewName === "New asset" ? "text-faint" : "text-ink")}>
                  {previewName}
                </p>
                <p className={cn("t-mono text-caption", previewTag ? "text-muted" : "text-faint")}>
                  {previewTag || "No tag yet"}
                </p>
                <div className="pt-0.5">
                  <StatusIndicator category="asset" value={v.status ?? "AVAILABLE"} label={statusLabel} variant="pill" />
                </div>
              </div>
            </div>
            {extraAssets.length > 0 && (
              <p className="t-micro text-muted">+ {extraAssets.length} more with the same details.</p>
            )}
          </div>
        </div>
      </aside>

      <QuickCreateLocation
        open={showCreateLocation}
        onOpenChange={setShowCreateLocation}
        onCreated={(id) => form.setValue("locationId", id)}
      />
      <QuickCreateSupplier
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        onCreated={(id) => form.setValue("supplierId", id)}
      />
    </form>
  );
}

// ─── Local helpers ───────────────────────────────────────────────

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-card-title font-bold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 t-micro text-muted">{hint}</p>}
    </div>
  );
}

function Field({
  label, required, hint, error, children,
}: {
  label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-red"> *</span>}</Label>
      {children}
      {hint && !error && <p className="t-micro text-muted">{hint}</p>}
      {error && <p className="t-micro text-t-out">{error}</p>}
    </div>
  );
}
