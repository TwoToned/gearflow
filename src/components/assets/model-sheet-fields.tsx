"use client";

import { Controller, type UseFormReturn } from "react-hook-form";

import { cn, focusRing } from "@/lib/utils";
import type { ModelFormValues } from "@/lib/validations/model";
import { SheetField, SheetSection } from "@/components/ui/sheet-parts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { TagInput } from "@/components/ui/tag-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { XeroAccountCodeField } from "@/components/settings/xero-coding-fields";
import { SpecificationsEditor } from "./specifications-editor";

type Form = UseFormReturn<ModelFormValues>;
interface CategoryOption { id: string; name: string; parent?: { name: string } | null }
export interface ProfileOption { id: string; name: string; equipmentClass: string; applianceType: string }

const ASSET_TYPE_LABELS: Record<string, string> = {
  SERIALIZED: "Serialised (tracked individually)",
  BULK: "Bulk (tracked by quantity)",
};

/** A number box that suggests (and one-click applies) a multiple of the daily rate. */
function RateField({ form, name, label, factor }: { form: Form; name: "weeklyRate" | "monthlyRate"; label: string; factor: number }) {
  const daily = Number(form.watch("dailyRate"));
  const own = form.watch(name);
  const suggest = daily > 0 && (own == null || own === "");
  return (
    <SheetField label={label} htmlFor={name}>
      <Input id={name} type="number" step="0.01" min="0" {...form.register(name)} placeholder={suggest ? `Suggested: $${(daily * factor).toFixed(2)}` : "0.00"} />
      {suggest ? (
        <button type="button" className={cn("rounded-[var(--r)] text-caption text-link hover:underline", focusRing)} onClick={() => form.setValue(name, daily * factor, { shouldDirty: true })}>
          Apply {factor}× daily
        </button>
      ) : null}
    </SheetField>
  );
}

export function ModelIdentityFields({ form, categories, onNewCategory, lock }: {
  form: Form; categories: CategoryOption[]; onNewCategory: () => void;
  /** Edit only: which asset types the model's existing stock forbids. */
  lock: { bulk: number; serialised: number };
}) {
  const { errors } = form.formState;
  const typeHint = [
    lock.bulk > 0 && `${lock.bulk} serialised unit(s) block switching to Bulk`,
    lock.serialised > 0 && `${lock.serialised} bulk stock record(s) block switching to Serialised`,
  ].filter(Boolean).join(" — ");
  return (
    <SheetSection title="Identity" hint="What it is and how you'll find it.">
      <div data-tour-anchor="tour-model-name">
        <SheetField label="Name" required htmlFor="model-name" error={errors.name?.message}>
          <Input id="model-name" {...form.register("name")} placeholder="e.g. Shure SM58" aria-invalid={!!errors.name} />
        </SheetField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SheetField label="Manufacturer" htmlFor="model-manufacturer"><Input id="model-manufacturer" {...form.register("manufacturer")} placeholder="e.g. Shure" /></SheetField>
        <SheetField label="Model number" htmlFor="model-number"><Input id="model-number" {...form.register("modelNumber")} placeholder="e.g. SM58-LC" /></SheetField>
        <SheetField label="SKU" htmlFor="model-sku"><Input id="model-sku" {...form.register("sku")} placeholder="e.g. SHR-SM58-LC" /></SheetField>
        <SheetField label="Category">
          <Controller control={form.control} name="categoryId" render={({ field }) => (
            <ComboboxPicker
              value={field.value || ""} onChange={field.onChange}
              options={categories.map((c) => ({ value: c.id, label: c.parent ? `${c.parent.name} → ${c.name}` : c.name }))}
              placeholder="No category" searchPlaceholder="Search categories…" emptyMessage="No categories found."
              onCreateNew={onNewCategory} createNewLabel="New category" allowClear
            />
          )} />
        </SheetField>
      </div>
      <SheetField label="Asset type" hint={typeHint ? `${typeHint}. Retire or move them first.` : "Serialised units are tracked individually; bulk stock by quantity."}>
        <Controller control={form.control} name="assetType" render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger><SelectValue>{ASSET_TYPE_LABELS[field.value ?? "SERIALIZED"]}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="SERIALIZED" disabled={lock.serialised > 0}>{ASSET_TYPE_LABELS.SERIALIZED}</SelectItem>
              <SelectItem value="BULK" disabled={lock.bulk > 0}>{ASSET_TYPE_LABELS.BULK}</SelectItem>
            </SelectContent>
          </Select>
        )} />
      </SheetField>
      <SheetField label="Description" htmlFor="model-description">
        <Textarea id="model-description" {...form.register("description")} placeholder="Optional description" rows={3} />
      </SheetField>
    </SheetSection>
  );
}

export function ModelPricingFields({ form }: { form: Form }) {
  return (
    <SheetSection title="Pricing" hint="Rate card and valuation, used on quotes and reports.">
      <div className="grid gap-4 sm:grid-cols-3">
        <SheetField label="Daily rate ($)" htmlFor="dailyRate"><Input id="dailyRate" type="number" step="0.01" min="0" {...form.register("dailyRate")} placeholder="0.00" /></SheetField>
        <RateField form={form} name="weeklyRate" label="Weekly rate ($)" factor={4} />
        <RateField form={form} name="monthlyRate" label="Monthly rate ($)" factor={12} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SheetField label="Purchase price ($)" htmlFor="defaultPurchasePrice"><Input id="defaultPurchasePrice" type="number" step="0.01" {...form.register("defaultPurchasePrice")} placeholder="0.00" /></SheetField>
        <SheetField label="Replacement cost ($)" htmlFor="replacementCost"><Input id="replacementCost" type="number" step="0.01" {...form.register("replacementCost")} placeholder="0.00" /></SheetField>
        <SheetField label="Sale price ($)" htmlFor="salePrice" hint="Auto-fills a Sale line's unit price. Leave blank to enter it by hand."><Input id="salePrice" type="number" step="0.01" {...form.register("salePrice")} placeholder="0.00" /></SheetField>
        <SheetField label="Sale stock" htmlFor="saleStockQuantity" hint="New-stock sale pool, separate from rental units."><Input id="saleStockQuantity" type="number" step="1" {...form.register("saleStockQuantity")} placeholder="0" /></SheetField>
      </div>
    </SheetSection>
  );
}

export function ModelXeroFields({ form }: { form: Form }) {
  return (
    <SheetSection title="Xero coding" hint="Overrides the category default for lines using this model. Leave blank to inherit.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller name="xeroRentalAccountCode" control={form.control} render={({ field }) => (
          <XeroAccountCodeField value={field.value} onChange={field.onChange} label="Rental account" placeholder="Inherit category default" />
        )} />
        <Controller name="xeroSaleAccountCode" control={form.control} render={({ field }) => (
          <XeroAccountCodeField value={field.value} onChange={field.onChange} label="Sale account" placeholder="Inherit category default" />
        )} />
      </div>
    </SheetSection>
  );
}

export function ModelComplianceFields({ form, profiles }: { form: Form; profiles: ProfileOption[] }) {
  const v = form.watch();
  const pick = (id: string) => {
    form.setValue("defaultTestProfileId", id, { shouldDirty: true });
    const p = profiles.find((x) => x.id === id);
    if (p) {
      form.setValue("defaultEquipmentClass", p.equipmentClass as ModelFormValues["defaultEquipmentClass"]);
      form.setValue("defaultApplianceType", p.applianceType as ModelFormValues["defaultApplianceType"]);
    }
  };
  return (
    <SheetSection title="Compliance and technical" hint="Test and tag, and physical specs. Optional.">
      <div className="grid gap-4 sm:grid-cols-2">
        <SheetField label="Weight (kg)" htmlFor="weight"><Input id="weight" type="number" step="0.01" {...form.register("weight")} placeholder="0.00" /></SheetField>
        <SheetField label="Power draw (watts)" htmlFor="powerDraw"><Input id="powerDraw" type="number" {...form.register("powerDraw")} placeholder="0" /></SheetField>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="requiresTestAndTag" checked={!!v.requiresTestAndTag} onCheckedChange={(val) => form.setValue("requiresTestAndTag", !!val, { shouldDirty: true })} />
        <Label htmlFor="requiresTestAndTag">Requires test &amp; tag</Label>
      </div>
      {v.requiresTestAndTag ? (
        <div className="grid gap-4 border-l-2 border-line-2 pl-4 sm:grid-cols-2">
          <SheetField label="Test profile" hint="Sets the equipment class, type and required tests.">
            {profiles.length > 0 ? (
              <ComboboxPicker value={v.defaultTestProfileId || ""} onChange={pick} options={profiles.map((p) => ({ value: p.id, label: p.name }))} placeholder="Select profile…" searchPlaceholder="Search profiles…" emptyMessage="No profiles found." />
            ) : (
              <p className="py-2 text-ui-text text-muted">No test profiles yet. <a href="/settings/test-and-tag/profiles" className={cn("rounded-[var(--r)] text-link hover:underline", focusRing)}>Set up profiles</a></p>
            )}
          </SheetField>
          <SheetField label="Test validity (days)" htmlFor="testAndTagIntervalDays" hint="Leave blank to use the organisation's setting.">
            <Input id="testAndTagIntervalDays" type="number" min={1} {...form.register("testAndTagIntervalDays")} placeholder="Use org default" />
          </SheetField>
        </div>
      ) : null}
    </SheetSection>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--r)] border border-line bg-paper-2/40 px-3.5 py-3">
      <div><Label htmlFor={id}>{label}</Label><p className="t-micro text-muted">{hint}</p></div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ModelMoreFields({ form, orgTags, editing }: { form: Form; orgTags: string[]; editing: boolean }) {
  const v = form.watch();
  const dirty = { shouldDirty: true };
  return (
    <div className="space-y-4 pt-1">
      <SheetField label="Specifications" hint="Free-form key and value spec sheet.">
        <SpecificationsEditor value={(v.specifications as Record<string, string>) || {}} onChange={(s) => form.setValue("specifications", s, dirty)} />
      </SheetField>
      <SheetField label="Tags">
        <Controller name="tags" control={form.control} render={({ field }) => (
          <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={orgTags} placeholder="Add tags…" />
        )} />
      </SheetField>
      {/* Archiving is a verb on the model page (Archive / Restore, with Undo), not a switch here. */}
      {editing ? null : <SwitchRow id="isActive" label="Active" hint="Archived models are hidden from new quotes and pickers." checked={v.isActive ?? true} onChange={(x) => form.setValue("isActive", x, dirty)} />}
      <SwitchRow id="isContainer" label="Packing container" hint="Units of this model can be used as containers in the warehouse, whatever their category." checked={!!v.isContainer} onChange={(x) => form.setValue("isContainer", x, dirty)} />
    </div>
  );
}
