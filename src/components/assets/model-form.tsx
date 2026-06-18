"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { Controller } from "react-hook-form";
import { cn, focusRing } from "@/lib/utils";
import { modelSchema, type ModelFormValues } from "@/lib/validations/model";
import { useActiveOrganization } from "@/lib/auth-client";
import { createModel, updateModel } from "@/server/models";
import { useTestProfiles } from "@/hooks/use-test-profiles";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/layout/page-layouts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateCategory } from "./quick-create-category";
import { SpecificationsEditor } from "./specifications-editor";

const equipmentClassOptions = [
  { value: "CLASS_I", label: "Class I" },
  { value: "CLASS_II", label: "Class II" },
  { value: "CLASS_II_DOUBLE_INSULATED", label: "Class II (Double Insulated)" },
  { value: "LEAD_CORD_ASSEMBLY", label: "Lead / Cord Assembly" },
];

const applianceTypeOptions = [
  { value: "APPLIANCE", label: "Appliance" },
  { value: "CORD_SET", label: "Cord Set" },
  { value: "EXTENSION_LEAD", label: "Extension Lead" },
  { value: "POWER_BOARD", label: "Power Board" },
  { value: "RCD_PORTABLE", label: "RCD (Portable)" },
  { value: "RCD_FIXED", label: "RCD (Fixed)" },
  { value: "THREE_PHASE", label: "Three Phase" },
  { value: "MICROWAVE", label: "Microwave" },
  { value: "OTHER", label: "Other" },
];

interface ModelFormProps {
  initialData?: ModelFormValues & { id: string };
}

export function ModelForm({ initialData }: ModelFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive categories (Convex) with synthetic parent name, sorted to match the
  // old getCategories() order.
  const categories = useCategoriesWithParent(orgId) ?? [];

  const orgTags = useOrgTags(orgId);

  // Reactive: testProfiles subscribes to Convex (Convex list returns all; filter
  // isActive client-side to match the old getTestProfiles default).
  const testProfiles = useTestProfiles(orgId);

  const activeProfiles = ((testProfiles || []) as unknown as { id: string; name: string; equipmentClass: string; applianceType: string; isActive: boolean }[]).filter(p => p.isActive);

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelSchema),
    defaultValues: initialData || {
      name: "",
      manufacturer: "",
      modelNumber: "",
      sku: "",
      categoryId: "",
      description: "",
      assetType: "SERIALIZED",
      requiresTestAndTag: false,
      isActive: true,
      images: [],
      manuals: [],
    },
  });

  const mutation = useServerMutation({
    mutationFn: (data: ModelFormValues) =>
      isEditing ? updateModel(initialData.id, data) : createModel(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Model updated" : "Model created");
      router.push(`/assets/models/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-6">
      {/* Basic info */}
      <FormSection title="Basic information">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" {...form.register("name")} placeholder="e.g. Shure SM58" aria-invalid={form.formState.errors.name ? true : undefined} />
            {form.formState.errors.name && (
              <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="manufacturer">Manufacturer</Label>
            <Input id="manufacturer" {...form.register("manufacturer")} placeholder="e.g. Shure" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="modelNumber">Model number</Label>
            <Input id="modelNumber" {...form.register("modelNumber")} placeholder="e.g. SM58-LC" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sku">SKU</Label>
            <Input id="sku" {...form.register("sku")} placeholder="e.g. SHR-SM58-LC" />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <ComboboxPicker
              value={form.watch("categoryId") || ""}
              onChange={(v) => form.setValue("categoryId", v)}
              options={categories.map((cat) => ({
                value: cat.id,
                label: cat.parent ? `${cat.parent.name} → ${cat.name}` : cat.name,
              }))}
              placeholder="No category"
              searchPlaceholder="Search categories..."
              onCreateNew={() => setShowCreateCategory(true)}
              createNewLabel="New category"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assetType">Asset type</Label>
            <select
              id="assetType"
              {...form.register("assetType")}
              className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="SERIALIZED">Serialized (tracked individually)</option>
              <option value="BULK">Bulk (tracked by quantity)</option>
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" {...form.register("description")} placeholder="Optional description" rows={3} />
          </div>
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
        </div>
      </FormSection>

      {/* Rate card */}
      <FormSection title="Rate card">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="dailyRate" aria-label="Daily rate">Daily rate ($)</Label>
            <Input id="dailyRate" type="number" step="0.01" min="0" {...form.register("dailyRate")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weeklyRate" aria-label="Weekly rate">Weekly rate ($)</Label>
            <Input
              id="weeklyRate"
              type="number"
              step="0.01"
              min="0"
              {...form.register("weeklyRate")}
              placeholder={
                form.watch("dailyRate") && !form.watch("weeklyRate")
                  ? `Suggested: $${(Number(form.watch("dailyRate")) * 4).toFixed(2)}`
                  : undefined
              }
            />
            {Number(form.watch("dailyRate")) > 0 && !form.watch("weeklyRate") && (
              <button
                type="button"
                className={cn("text-caption text-link hover:underline rounded-[var(--r)]", focusRing)}
                aria-describedby="weeklyRate"
                onClick={() => form.setValue("weeklyRate", Number(form.watch("dailyRate")) * 4)}
              >
                Apply 4× daily
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthlyRate" aria-label="Monthly rate">Monthly rate ($)</Label>
            <Input
              id="monthlyRate"
              type="number"
              step="0.01"
              min="0"
              {...form.register("monthlyRate")}
              placeholder={
                form.watch("dailyRate") && !form.watch("monthlyRate")
                  ? `Suggested: $${(Number(form.watch("dailyRate")) * 12).toFixed(2)}`
                  : undefined
              }
            />
            {Number(form.watch("dailyRate")) > 0 && !form.watch("monthlyRate") && (
              <button
                type="button"
                className={cn("text-caption text-link hover:underline rounded-[var(--r)]", focusRing)}
                aria-describedby="monthlyRate"
                onClick={() => form.setValue("monthlyRate", Number(form.watch("dailyRate")) * 12)}
              >
                Apply 12× daily
              </button>
            )}
          </div>
        </div>
      </FormSection>

      {/* Cost & valuation */}
      <FormSection title="Cost & valuation">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="defaultPurchasePrice">Purchase price ($)</Label>
            <Input id="defaultPurchasePrice" type="number" step="0.01" {...form.register("defaultPurchasePrice")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="replacementCost">Replacement cost ($)</Label>
            <Input id="replacementCost" type="number" step="0.01" {...form.register("replacementCost")} />
          </div>
        </div>
      </FormSection>

      {/* Technical */}
      <FormSection title="Technical details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="weight">Weight (kg)</Label>
            <Input id="weight" type="number" step="0.01" {...form.register("weight")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="powerDraw">Power draw (watts)</Label>
            <Input id="powerDraw" type="number" {...form.register("powerDraw")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenanceIntervalDays">Maintenance interval (days)</Label>
            <Input id="maintenanceIntervalDays" type="number" {...form.register("maintenanceIntervalDays")} placeholder="e.g. 365" />
          </div>
          <div className="sm:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="requiresTestAndTag"
                checked={!!form.watch("requiresTestAndTag")}
                onCheckedChange={(v) => form.setValue("requiresTestAndTag", !!v)}
              />
              <Label htmlFor="requiresTestAndTag">Requires test & tag</Label>
            </div>
            {form.watch("requiresTestAndTag") && (
              <div className="grid gap-4 sm:grid-cols-2 pl-6 border-l-2 border-line-2">
                <div className="space-y-2">
                  <Label>Test profile</Label>
                  {activeProfiles.length > 0 ? (
                    <ComboboxPicker
                      value={form.watch("defaultTestProfileId") || ""}
                      onChange={(v) => {
                        form.setValue("defaultTestProfileId", v);
                        const profile = activeProfiles.find(p => p.id === v);
                        if (profile) {
                          form.setValue("defaultEquipmentClass", profile.equipmentClass as ModelFormValues["defaultEquipmentClass"]);
                          form.setValue("defaultApplianceType", profile.applianceType as ModelFormValues["defaultApplianceType"]);
                        }
                      }}
                      options={activeProfiles.map(p => ({ value: p.id, label: p.name }))}
                      placeholder="Select profile..."
                      searchPlaceholder="Search profiles..."
                    />
                  ) : (
                    <p className="text-ui-text text-muted py-2">No test profiles configured. <a href="/settings/test-and-tag/profiles" className={cn("text-link hover:underline rounded-[var(--r)]", focusRing)}>Set up profiles</a></p>
                  )}
                  <p className="text-caption text-muted">Determines equipment class, type, and required tests</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="testAndTagIntervalDays">Test validity (days)</Label>
                  <Input id="testAndTagIntervalDays" type="number" min={1} {...form.register("testAndTagIntervalDays")} placeholder="Use org default" />
                  <p className="text-caption text-muted">Leave blank to use org T&T settings</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </FormSection>

      {/* Specifications */}
      <FormSection title="Specifications">
          <SpecificationsEditor
            value={(form.watch("specifications") as Record<string, string>) || {}}
            onChange={(specs) => form.setValue("specifications", specs)}
          />
      </FormSection>

      {/* Status */}
      <FormSection title="Status">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="isActive">Active</Label>
            <p className="text-caption text-muted">Inactive models are hidden from asset creation</p>
          </div>
          <Switch
            id="isActive"
            checked={form.watch("isActive")}
            onCheckedChange={(v) => form.setValue("isActive", v)}
          />
        </div>
      </FormSection>

        </div>
        {/* Submit */}
        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? "Update model" : "Create model"}
          </Button>
        </div>
      </div>

      <QuickCreateCategory
        open={showCreateCategory}
        onOpenChange={setShowCreateCategory}
        onCreated={(id) => form.setValue("categoryId", id)}
      />
    </form>
  );
}
