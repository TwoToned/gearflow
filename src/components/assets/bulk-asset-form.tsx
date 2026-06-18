"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { Controller } from "react-hook-form";
import { bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";
import { createBulkAsset, updateBulkAsset } from "@/server/bulk-assets";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { useModels } from "@/hooks/use-models";
import { useLocations } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateLocation } from "./quick-create-location";
import { useActiveOrganization } from "@/lib/auth-client";

interface BulkAssetFormProps {
  initialData?: BulkAssetFormValues & { id: string };
  preselectedModelId?: string;
}

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

  const mutation = useServerMutation({
    mutationFn: (data: BulkAssetFormValues) =>
      isEditing ? updateBulkAsset(initialData.id, data) : createBulkAsset(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Bulk asset updated" : "Bulk asset created");
      router.push(`/assets/registry/${result.id}?type=bulk`);
    },
    onError: (e) => toast.error(e.message),
  });


  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-6">
      <FormSection title="Bulk asset details">
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
          <div className="space-y-2">
            <Label htmlFor="assetTag">Asset tag *</Label>
            <AssetTagInput id="assetTag" {...form.register("assetTag")} onScan={(v) => form.setValue("assetTag", v)} placeholder="e.g. AV-SM57" />
            {form.formState.errors.assetTag && (
              <p className="text-caption text-t-out">{form.formState.errors.assetTag.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalQuantity">Total quantity *</Label>
            <Input id="totalQuantity" type="number" {...form.register("totalQuantity")} />
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
            <Label htmlFor="purchasePricePerUnit">Price per unit ($)</Label>
            <Input id="purchasePricePerUnit" type="number" step="0.01" {...form.register("purchasePricePerUnit")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              {...form.register("status")}
              className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="ACTIVE">Active</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="OUT_OF_STOCK">Out of stock</option>
              <option value="RETIRED">Retired</option>
            </select>
          </div>
        </div>
      </FormSection>

      <FormSection title="Notes">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" {...form.register("notes")} placeholder="Any additional notes" rows={3} className="mt-2" />
      </FormSection>

      <FormSection title="Tags">
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
            {isEditing ? "Update bulk asset" : "Create bulk asset"}
          </Button>
        </div>
      </div>

      <QuickCreateLocation
        open={showCreateLocation}
        onOpenChange={setShowCreateLocation}
        onCreated={(id) => form.setValue("locationId", id)}
      />
    </form>
  );
}
