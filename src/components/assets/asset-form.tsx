"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Controller } from "react-hook-form";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import { createAsset, createAssets, updateAsset } from "@/server/assets";
import { getOrgTags } from "@/server/tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { getModels } from "@/server/models";
import { useLocations } from "@/hooks/use-locations";
import { useSuppliers } from "@/hooks/use-suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
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

  const { data: modelsData } = useQuery({
    queryKey: ["models", orgId, { isActive: true, assetType: "SERIALIZED", pageSize: 200 }],
    queryFn: () => getModels({ assetType: "SERIALIZED", pageSize: 200 }),
  });

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

  const { data: orgTags } = useQuery({
    queryKey: ["org-tags", orgId],
    queryFn: () => getOrgTags(),
  });

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

  const mutation = useMutation({
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

  const models = modelsData?.models || [];
  const totalCount = 1 + extraAssets.length;

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-8">
      <SectionHeader label="Asset Details" />
      <FormSection>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Equipment Model *</Label>
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
              <p className="text-xs text-destructive">{form.formState.errors.modelId.message}</p>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Label className="flex-none">Asset Tag *</Label>
              <Label className="flex-none text-fg-3">/ Serial Number</Label>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <ScanInput {...form.register("assetTag")} onScan={(v) => form.setValue("assetTag", v)} scannerTitle="Scan asset tag" placeholder="Asset tag" className="flex-1" />
                <Input {...form.register("serialNumber")} placeholder="Serial number" className="flex-1" />
                {!isEditing && (
                  <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={addExtraAsset} title="Add another asset">
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {form.formState.errors.assetTag && (
                <p className="text-xs text-destructive">{form.formState.errors.assetTag.message}</p>
              )}
              {extraAssets.map((asset, i) => (
                <div key={i} className="flex gap-2">
                  <ScanInput
                    value={asset.tag}
                    onChange={(e) => updateExtraAsset(i, "tag", e.target.value)}
                    onScan={(v) => updateExtraAsset(i, "tag", v)}
                    scannerTitle="Scan asset tag"
                    placeholder="Asset tag"
                    className="flex-1"
                  />
                  <Input
                    value={asset.serialNumber}
                    onChange={(e) => updateExtraAsset(i, "serialNumber", e.target.value)}
                    placeholder="Serial number"
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => removeExtraAsset(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {extraAssets.length > 0 && (
                <p className="text-xs text-fg-3">
                  Creating {totalCount} assets with the same details
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customName">Custom Name</Label>
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
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="AVAILABLE">Available</option>
              <option value="CHECKED_OUT">Deployed</option>
              <option value="IN_MAINTENANCE">In Maintenance</option>
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
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

      <SectionHeader label="Purchase Information" />
      <FormSection>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="purchaseDate">Purchase Date</Label>
            <Input id="purchaseDate" type="date" {...form.register("purchaseDate")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purchasePrice">Purchase Price ($)</Label>
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
              <Label htmlFor="purchaseOrderNumber">Purchase Order #</Label>
              <Input id="purchaseOrderNumber" {...form.register("purchaseOrderNumber")} placeholder="e.g. PO-2024-001" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="warrantyExpiry">Warranty Expiry</Label>
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
        <div className="mt-6 flex gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Update Asset" : totalCount > 1 ? `Create ${totalCount} Assets` : "Create Asset"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
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
