"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Controller } from "react-hook-form";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import { createAsset, createAssets, updateAsset } from "@/server/assets";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { useModels } from "@/hooks/use-models";
import { useLocations } from "@/hooks/use-locations";
import { useSuppliers } from "@/hooks/use-suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, SectionHeader } from "@/components/layout/page-layouts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateLocation } from "./quick-create-location";
import { QuickCreateSupplier } from "./quick-create-supplier";
import { CustomFieldsInput } from "@/components/custom-fields/custom-fields-input";
import { useActiveOrganization } from "@/lib/auth-client";

interface AssetFormProps {
  initialData?: AssetFormValues & { id: string };
  preselectedModelId?: string;
}

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

  const mutation = useServerMutation({
    mutationFn: async (data: AssetFormValues) => {
      if (isEditing) {
        return updateAsset(initialData.id, data);
      }
      if (extraAssets.length > 0) {
        const allAssets = [
          { tag: data.assetTag, serialNumber: data.serialNumber || "" },
          ...extraAssets,
        ].filter((a) => a.tag);
        return createAssets(data, allAssets);
      }
      return createAsset(data);
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

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-8">
      <SectionHeader label="Asset details" />
      <FormSection>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Equipment model *</Label>
            <ComboboxPicker
              value={form.watch("modelId")}
              onChange={(v) => form.setValue("modelId", v, { shouldValidate: true })}
              options={models.map((m) => ({
                value: m.id,
                label: `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.name}`,
                description: m.modelNumber || undefined,
              }))}
              placeholder="Select a model"
              searchPlaceholder="Search models..."
            />
            {form.formState.errors.modelId && (
              <p className="text-caption text-t-out">{form.formState.errors.modelId.message}</p>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Label className="flex-none">Asset tag *</Label>
              <Label className="flex-none text-muted">/ Serial number</Label>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <AssetTagInput {...form.register("assetTag")} onScan={(v) => form.setValue("assetTag", v)} placeholder="Asset tag" className="flex-1" />
                <Input {...form.register("serialNumber")} placeholder="Serial number" className="flex-1" />
                {!isEditing && (
                  <Button type="button" variant="line" size="icon" className="shrink-0" onClick={addExtraAsset} title="Add another asset">
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {form.formState.errors.assetTag && (
                <p className="text-caption text-t-out">{form.formState.errors.assetTag.message}</p>
              )}
              {extraAssets.map((asset, i) => (
                <div key={i} className="flex gap-2">
                  <AssetTagInput
                    value={asset.tag}
                    onChange={(e) => updateExtraAsset(i, "tag", e.target.value)}
                    onScan={(v) => updateExtraAsset(i, "tag", v)}
                    placeholder="Asset tag"
                    className="flex-1"
                  />
                  <Input
                    value={asset.serialNumber}
                    onChange={(e) => updateExtraAsset(i, "serialNumber", e.target.value)}
                    placeholder="Serial number"
                    className="flex-1"
                  />
                  <Button type="button" variant="line" size="icon" className="shrink-0" onClick={() => removeExtraAsset(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {extraAssets.length > 0 && (
                <p className="text-caption text-muted">
                  Creating {totalCount} assets with the same details
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customName">Custom name</Label>
            <Input id="customName" {...form.register("customName")} placeholder="e.g. FOH Console 1" />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <ComboboxPicker
              value={form.watch("locationId") || ""}
              onChange={(v) => form.setValue("locationId", v)}
              options={locations.map((loc) => ({
                value: loc.id,
                label: loc.parent ? `${loc.parent.name} → ${loc.name}` : loc.name,
                description: loc.type,
              }))}
              placeholder="No location"
              searchPlaceholder="Search locations..."
              onCreateNew={() => setShowCreateLocation(true)}
              createNewLabel="New location"
              allowClear
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              {...form.register("status")}
              className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="AVAILABLE">Available</option>
              <option value="CHECKED_OUT">Deployed</option>
              <option value="IN_MAINTENANCE">In maintenance</option>
              <option value="RESERVED">Reserved</option>
              <option value="RETIRED">Retired</option>
              <option value="LOST">Lost</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="condition">Condition</Label>
            <select
              id="condition"
              {...form.register("condition")}
              className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="NEW">New</option>
              <option value="GOOD">Good</option>
              <option value="FAIR">Fair</option>
              <option value="POOR">Poor</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </div>
        </div>
      </FormSection>

      <SectionHeader label="Purchase information" />
      <FormSection>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="purchaseDate">Purchase date</Label>
            <Input id="purchaseDate" type="date" {...form.register("purchaseDate")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purchasePrice">Purchase price ($)</Label>
            <Input id="purchasePrice" type="number" step="0.01" {...form.register("purchasePrice")} />
          </div>
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
              placeholder="No supplier"
              searchPlaceholder="Search suppliers..."
              onCreateNew={() => setShowCreateSupplier(true)}
              createNewLabel="New supplier"
              allowClear
            />
          </div>
          {form.watch("supplierId") && (
            <div className="space-y-2">
              <Label htmlFor="purchaseOrderNumber">Purchase order #</Label>
              <Input id="purchaseOrderNumber" {...form.register("purchaseOrderNumber")} placeholder="e.g. PO-2024-001" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="warrantyExpiry">Warranty expiry</Label>
            <Input id="warrantyExpiry" type="date" {...form.register("warrantyExpiry")} />
          </div>
        </div>
      </FormSection>

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

      <SectionHeader label="Notes" />
      <FormSection>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" {...form.register("notes")} placeholder="Any additional notes" rows={3} className="mt-2" />
      </FormSection>

      <SectionHeader label="Tags" />
      <FormSection>
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
      </FormSection>

        </div>
        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? "Update asset" : totalCount > 1 ? `Create ${totalCount} assets` : "Create asset"}
          </Button>
        </div>
      </div>

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
