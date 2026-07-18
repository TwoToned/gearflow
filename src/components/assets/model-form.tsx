"use client";

import { useState } from "react";
import { AppImage } from "@/components/ui/app-image";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Package } from "lucide-react";

import { cn, focusRing } from "@/lib/utils";
import { modelSchema, type ModelFormValues } from "@/lib/validations/model";
import { useActiveOrganization } from "@/lib/auth-client";
import { useModelWrites } from "@/hooks/use-model-writes";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateCategory } from "./quick-create-category";
import { SpecificationsEditor } from "./specifications-editor";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField,
} from "@/components/ui/smart-form";

const ASSET_TYPE_LABELS: Record<string, string> = {
  SERIALIZED: "Serialized (tracked individually)",
  BULK: "Bulk (tracked by quantity)",
};
const ASSET_TYPE_ORDER = ["SERIALIZED", "BULK"] as const;

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

  const v = form.watch();

  const modelWrites = useModelWrites();

  const mutation = useServerMutation({
    mutationFn: (data: ModelFormValues) =>
      isEditing ? modelWrites.update(initialData.id, data) : modelWrites.create(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Model updated" : "Model created");
      router.push(`/assets/models/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Live-preview derivations ──────────────────────────────────
  const modelName = (v.name || "").trim();
  const previewName = modelName
    ? `${v.manufacturer ? `${v.manufacturer.trim()} ` : ""}${modelName}`.trim()
    : "New model";
  const previewImage = v.image || (Array.isArray(v.images) ? v.images[0] : undefined) || null;
  const selectedCategory = categories.find((c) => c.id === v.categoryId);
  const categoryLabel = selectedCategory
    ? (selectedCategory.parent ? `${selectedCategory.parent.name} → ${selectedCategory.name}` : selectedCategory.name)
    : null;
  const dailyRate = v.dailyRate != null && v.dailyRate !== "" ? Number(v.dailyRate) : null;
  const rateLine = dailyRate ? `$${dailyRate.toFixed(2)} / day` : null;

  const helperTip = !modelName
    ? "This is the spec sheet, not a physical unit — name it now and the actual gear hangs off it later."
    : !v.categoryId
      ? "Filing it under a category makes it easy to find when you're building a quote."
      : "Looking good. Rates, technical details and specs are all optional — fill what you know.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New model"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)]">
              <div className="relative flex aspect-[5/3] items-center justify-center overflow-hidden bg-paper-2">
                {previewImage ? (
                  <AppImage src={previewImage} alt={previewName} fill sizes="(max-width: 768px) 100vw, 400px" className="object-cover" />
                ) : (
                  <Package className="h-8 w-8 text-faint" strokeWidth={1.5} />
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <p className={cn("text-card-title font-semibold leading-tight", previewName === "New model" ? "text-faint" : "text-ink")}>
                  {previewName}
                </p>
                {categoryLabel && (
                  <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                    {categoryLabel}
                  </span>
                )}
                <p className={cn("text-caption", rateLine ? "text-muted" : "text-faint")}>
                  {rateLine || "No daily rate"}
                </p>
              </div>
            </div>
          </SmartFormPreview>
        </>
      }
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="What it is and how you'll find it." divider={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Name" required error={form.formState.errors.name?.message}>
                <Input
                  {...form.register("name")}
                  placeholder="e.g. Shure SM58"
                  aria-invalid={!!form.formState.errors.name}
                />
              </SmartFormField>
            </div>
            <SmartFormField label="Manufacturer">
              <Input {...form.register("manufacturer")} placeholder="e.g. Shure" />
            </SmartFormField>
            <SmartFormField label="Model number">
              <Input {...form.register("modelNumber")} placeholder="e.g. SM58-LC" />
            </SmartFormField>
            <SmartFormField label="SKU">
              <Input {...form.register("sku")} placeholder="e.g. SHR-SM58-LC" />
            </SmartFormField>
            <SmartFormField label="Category">
              <Controller control={form.control} name="categoryId" render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={categories.map((cat) => ({
                    value: cat.id,
                    label: cat.parent ? `${cat.parent.name} → ${cat.name}` : cat.name,
                  }))}
                  placeholder="No category"
                  searchPlaceholder="Search categories…"
                  emptyMessage="No categories found."
                  onCreateNew={() => setShowCreateCategory(true)}
                  createNewLabel="New category"
                  allowClear
                />
              )} />
            </SmartFormField>
            <div className="sm:col-span-2">
              <SmartFormField label="Asset type" hint="Serialized assets are tracked individually; bulk by quantity.">
                <Controller control={form.control} name="assetType" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{ASSET_TYPE_LABELS[field.value ?? "SERIALIZED"] ?? "Serialized (tracked individually)"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ASSET_TYPE_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>{ASSET_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </SmartFormField>
            </div>
            <div className="sm:col-span-2">
              <SmartFormField label="Description">
                <Textarea {...form.register("description")} placeholder="Optional description" rows={3} />
              </SmartFormField>
            </div>
          </div>
        </SmartFormSection>

        {/* Pricing */}
        <SmartFormSection title="Pricing" hint="Rate card and valuation — used on quotes and reports.">
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <SmartFormField label="Daily rate ($)">
                <Input id="dailyRate" type="number" step="0.01" min="0" {...form.register("dailyRate")} placeholder="0.00" />
              </SmartFormField>
              <SmartFormField label="Weekly rate ($)">
                <Input
                  id="weeklyRate"
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register("weeklyRate")}
                  placeholder={
                    v.dailyRate && !v.weeklyRate
                      ? `Suggested: $${(Number(v.dailyRate) * 4).toFixed(2)}`
                      : "0.00"
                  }
                />
                {Number(v.dailyRate) > 0 && !v.weeklyRate && (
                  <button
                    type="button"
                    className={cn("text-caption text-link hover:underline rounded-[var(--r)]", focusRing)}
                    aria-describedby="weeklyRate"
                    onClick={() => form.setValue("weeklyRate", Number(v.dailyRate) * 4)}
                  >
                    Apply 4× daily
                  </button>
                )}
              </SmartFormField>
              <SmartFormField label="Monthly rate ($)">
                <Input
                  id="monthlyRate"
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register("monthlyRate")}
                  placeholder={
                    v.dailyRate && !v.monthlyRate
                      ? `Suggested: $${(Number(v.dailyRate) * 12).toFixed(2)}`
                      : "0.00"
                  }
                />
                {Number(v.dailyRate) > 0 && !v.monthlyRate && (
                  <button
                    type="button"
                    className={cn("text-caption text-link hover:underline rounded-[var(--r)]", focusRing)}
                    aria-describedby="monthlyRate"
                    onClick={() => form.setValue("monthlyRate", Number(v.dailyRate) * 12)}
                  >
                    Apply 12× daily
                  </button>
                )}
              </SmartFormField>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <SmartFormField label="Purchase price ($)">
                <Input type="number" step="0.01" {...form.register("defaultPurchasePrice")} placeholder="0.00" />
              </SmartFormField>
              <SmartFormField label="Replacement cost ($)">
                <Input type="number" step="0.01" {...form.register("replacementCost")} placeholder="0.00" />
              </SmartFormField>
            </div>
          </div>
        </SmartFormSection>

        {/* Compliance & technical */}
        <SmartFormSection title="Compliance & technical" hint="Test & tag and physical specs — optional.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Weight (kg)">
              <Input type="number" step="0.01" {...form.register("weight")} placeholder="0.00" />
            </SmartFormField>
            <SmartFormField label="Power draw (watts)">
              <Input type="number" {...form.register("powerDraw")} placeholder="0" />
            </SmartFormField>
            <SmartFormField label="Maintenance interval (days)">
              <Input type="number" {...form.register("maintenanceIntervalDays")} placeholder="e.g. 365" />
            </SmartFormField>
            <div className="sm:col-span-2 space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="requiresTestAndTag"
                  checked={!!v.requiresTestAndTag}
                  onCheckedChange={(val) => form.setValue("requiresTestAndTag", !!val)}
                />
                <Label htmlFor="requiresTestAndTag">Requires test &amp; tag</Label>
              </div>
              {v.requiresTestAndTag && (
                <div className="grid gap-5 sm:grid-cols-2 pl-6 border-l-2 border-line-2">
                  <SmartFormField
                    label="Test profile"
                    hint="Determines equipment class, type and required tests."
                  >
                    {activeProfiles.length > 0 ? (
                      <ComboboxPicker
                        value={v.defaultTestProfileId || ""}
                        onChange={(val) => {
                          form.setValue("defaultTestProfileId", val);
                          const profile = activeProfiles.find(p => p.id === val);
                          if (profile) {
                            form.setValue("defaultEquipmentClass", profile.equipmentClass as ModelFormValues["defaultEquipmentClass"]);
                            form.setValue("defaultApplianceType", profile.applianceType as ModelFormValues["defaultApplianceType"]);
                          }
                        }}
                        options={activeProfiles.map(p => ({ value: p.id, label: p.name }))}
                        placeholder="Select profile…"
                        searchPlaceholder="Search profiles…"
                        emptyMessage="No profiles found."
                      />
                    ) : (
                      <p className="text-ui-text text-muted py-2">No test profiles configured. <a href="/settings/test-and-tag/profiles" className={cn("text-link hover:underline rounded-[var(--r)]", focusRing)}>Set up profiles</a></p>
                    )}
                  </SmartFormField>
                  <SmartFormField label="Test validity (days)" hint="Leave blank to use org T&T settings.">
                    <Input type="number" min={1} {...form.register("testAndTagIntervalDays")} placeholder="Use org default" />
                  </SmartFormField>
                </div>
              )}
            </div>
          </div>
        </SmartFormSection>

        {/* More details — progressive disclosure */}
        <section className="border-t border-line pt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="more" className="border-line">
              <AccordionTrigger>More details</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 pt-1">
                  <SmartFormField label="Specifications" hint="Free-form key/value spec sheet.">
                    <SpecificationsEditor
                      value={(v.specifications as Record<string, string>) || {}}
                      onChange={(specs) => form.setValue("specifications", specs)}
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
                  <div className="flex items-center justify-between rounded-[var(--r)] border border-line bg-paper-2/40 px-3.5 py-3">
                    <div>
                      <Label htmlFor="isActive">Active</Label>
                      <p className="t-micro text-muted">Inactive models are hidden from asset creation.</p>
                    </div>
                    <Switch
                      id="isActive"
                      checked={v.isActive}
                      onCheckedChange={(val) => form.setValue("isActive", val)}
                    />
                  </div>
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
          {isEditing ? "Update model" : "Create model"}
        </Button>
      </div>

      <QuickCreateCategory
        open={showCreateCategory}
        onOpenChange={setShowCreateCategory}
        onCreated={(id) => form.setValue("categoryId", id)}
      />
    </SmartFormLayout>
  );
}
