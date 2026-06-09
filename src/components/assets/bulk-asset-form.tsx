"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Controller } from "react-hook-form";
import { bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";
import { createBulkAsset, updateBulkAsset } from "@/server/bulk-assets";
import { getOrgTags } from "@/server/tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { getModels } from "@/server/models";
import { getLocations } from "@/server/locations";
import { useSuppliers } from "@/hooks/use-suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
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

  const { data: modelsData } = useQuery({
    queryKey: ["models", orgId, { isActive: true, assetType: "BULK", pageSize: 200 }],
    queryFn: () => getModels({ assetType: "BULK", pageSize: 200 }),
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations", orgId],
    queryFn: () => getLocations({ pageSize: 100 }),
  });
  const locations = locationsData?.locations || [];

  // Reactive supplier list from Convex; active-only (matches old getSuppliers).
  const allSuppliers = useSuppliers(orgId);
  const suppliers = (allSuppliers ?? []).filter((s) => s.isActive ?? true);

  const { data: orgTags } = useQuery({
    queryKey: ["org-tags", orgId],
    queryFn: () => getOrgTags(),
  });

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

  const mutation = useMutation({
    mutationFn: (data: BulkAssetFormValues) =>
      isEditing ? updateBulkAsset(initialData.id, data) : createBulkAsset(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Bulk asset updated" : "Bulk asset created");
      router.push(`/assets/registry/${result.id}?type=bulk`);
    },
    onError: (e) => toast.error(e.message),
  });

  const models = modelsData?.models || [];

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-6">
      <FormSection title="Bulk Asset Details">
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
          <div className="space-y-2">
            <Label htmlFor="assetTag">Asset Tag *</Label>
            <ScanInput id="assetTag" {...form.register("assetTag")} onScan={(v) => form.setValue("assetTag", v)} scannerTitle="Scan asset tag" placeholder="e.g. AV-SM57" />
            {form.formState.errors.assetTag && (
              <p className="text-xs text-destructive">{form.formState.errors.assetTag.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalQuantity">Total Quantity *</Label>
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
            <Label htmlFor="purchasePricePerUnit">Price Per Unit ($)</Label>
            <Input id="purchasePricePerUnit" type="number" step="0.01" {...form.register("purchasePricePerUnit")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reorderThreshold">Reorder Threshold</Label>
            <Input id="reorderThreshold" type="number" {...form.register("reorderThreshold")} placeholder="Low stock alert" />
            <p className="text-[11px] text-fg-4">
              Items at or below this surface on /warehouse/reorder.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Preferred Supplier</Label>
            <ComboboxPicker
              value={form.watch("preferredSupplierId") || ""}
              onChange={(v) => form.setValue("preferredSupplierId", v)}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="No preferred supplier"
              searchPlaceholder="Search suppliers..."
              allowClear
            />
            <p className="text-[11px] text-fg-4">
              Reorder dashboard groups low-stock items by supplier.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              {...form.register("status")}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="ACTIVE">Active</option>
              <option value="LOW_STOCK">Low Stock</option>
              <option value="OUT_OF_STOCK">Out of Stock</option>
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
        <div className="mt-6 flex gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Update Bulk Asset" : "Create Bulk Asset"}
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
    </form>
  );
}
