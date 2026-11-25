"use client";

import { Controller, type UseFormReturn } from "react-hook-form";

import { assetStatusLabels, conditionLabels, supplierOrderStatusLabels, supplierOrderTypeLabels } from "@/lib/status-labels";
import type { AssetFormValues } from "@/lib/validations/asset";
import { SheetField, SheetSection } from "@/components/ui/sheet-parts";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomFieldsInput } from "@/components/custom-fields/custom-fields-input";
import type { useAssetSheetLookups } from "./use-asset-sheet-lookups";

type Form = UseFormReturn<AssetFormValues>;
type Lookups = ReturnType<typeof useAssetSheetLookups>;
export type SheetDialogKey = "location" | "supplier" | "order";

// SOLD is written only by the sale flow, never picked here (WS11 #950).
const STATUS_ORDER = ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RESERVED", "RETIRED", "LOST"] as const;
const CONDITION_ORDER = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

const modelOption = (m: Lookups["models"][number]) => ({ value: m.id, label: `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.name}`, description: m.modelNumber || undefined });
const locationOption = (l: Lookups["locations"][number]) => ({ value: l.id, label: l.parent ? `${l.parent.name} → ${l.name}` : l.name, description: l.type });

export const dateText = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d as string | undefined));

export function IdentityFields({ form, lookups, editing, taken, onCheckTag, onTagChange, onNewModel }: {
  form: Form; lookups: Lookups; editing: boolean; taken: string | null;
  onCheckTag: (tag: string) => void; onTagChange: () => void; onNewModel: () => void;
}) {
  const { errors } = form.formState;
  return (
    <SheetSection title="Identity" hint="What it is and how you'll find it.">
      <div data-tour-anchor="tour-asset-model-field">
        <SheetField label="Equipment model" required error={errors.modelId?.message}>
          <Controller control={form.control} name="modelId" render={({ field }) => (
            <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={lookups.models.map(modelOption)}
              placeholder="Search models…" searchPlaceholder="Search models…" emptyMessage="No models found."
              onCreateNew={onNewModel} createNewLabel="New model" />
          )} />
        </SheetField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SheetField label="Asset tag" htmlFor="asset-tag" required error={errors.assetTag?.message ?? taken ?? undefined} hint={editing ? undefined : "Pre-filled from your next sequence. Edit it or scan a label."}>
          <AssetTagInput
            id="asset-tag"
            {...form.register("assetTag", { onBlur: (e) => onCheckTag(e.target.value), onChange: onTagChange })}
            onScan={(val) => { form.setValue("assetTag", val, { shouldDirty: true }); onCheckTag(val); }}
            aria-invalid={!!errors.assetTag}
            placeholder="Asset tag"
            className="font-mono"
          />
        </SheetField>
        <SheetField label="Serial number" htmlFor="asset-serial" error={errors.serialNumber?.message}>
          <Input id="asset-serial" {...form.register("serialNumber")} placeholder="Serial number" />
        </SheetField>
      </div>
      <SheetField label="Custom name" htmlFor="asset-name" hint="An optional friendly name, e.g. FOH Console 1." error={errors.customName?.message}>
        <Input id="asset-name" {...form.register("customName")} placeholder="e.g. FOH Console 1" />
      </SheetField>
    </SheetSection>
  );
}

export function ConditionFields({ form, lookups, onNewLocation }: { form: Form; lookups: Lookups; onNewLocation: () => void }) {
  return (
    <SheetSection title="Condition & location" hint="Where it lives and what shape it's in.">
      <div className="grid gap-4 sm:grid-cols-2">
        <SheetField label="Status">
          <Controller control={form.control} name="status" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue>{assetStatusLabels[field.value ?? "AVAILABLE"] ?? "Available"}</SelectValue></SelectTrigger>
              <SelectContent>{STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{assetStatusLabels[s]}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </SheetField>
        <SheetField label="Condition">
          <Controller control={form.control} name="condition" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue>{conditionLabels[field.value ?? "NEW"] ?? "New"}</SelectValue></SelectTrigger>
              <SelectContent>{CONDITION_ORDER.map((c) => <SelectItem key={c} value={c}>{conditionLabels[c]}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </SheetField>
      </div>
      <SheetField label="Location">
        <Controller control={form.control} name="locationId" render={({ field }) => (
          <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={lookups.locations.map(locationOption)}
            placeholder="No location" searchPlaceholder="Search locations…" emptyMessage="No locations found."
            onCreateNew={onNewLocation} createNewLabel="New location" allowClear />
        )} />
      </SheetField>
    </SheetSection>
  );
}

/** Picking an order fills the price and date the person left blank (never overwrites what they typed). */
function applyOrder(form: Form, o: Lookups["supplierOrders"][number] | undefined) {
  if (!o) return form.setValue("purchaseOrderNumber", "");
  form.setValue("purchaseOrderNumber", o.orderNumber);
  if (!form.getValues("purchasePrice") && o.total != null) form.setValue("purchasePrice", Number(o.total));
  if (!form.getValues("purchaseDate") && o.orderDate) form.setValue("purchaseDate", new Date(o.orderDate).toISOString().slice(0, 10));
}

export function PurchaseFields({ form, lookups, initial, supplierId, onOpen }: {
  form: Form; lookups: Lookups; initial: AssetFormValues; supplierId: string | undefined; onOpen: (d: SheetDialogKey) => void;
}) {
  const { errors } = form.formState;
  const prior = form.watch("purchaseOrderNumber");
  const orderId = form.watch("supplierOrderId");
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SheetField label="Purchase date" htmlFor="asset-pdate" error={errors.purchaseDate?.message as string | undefined}>
          <Input id="asset-pdate" type="date" defaultValue={dateText(initial.purchaseDate)} {...form.register("purchaseDate")} />
        </SheetField>
        <SheetField label="Purchase price ($)" htmlFor="asset-price" hint="Leave blank if unknown." error={errors.purchasePrice?.message as string | undefined}>
          <Input id="asset-price" type="number" step="0.01" min="0" inputMode="decimal" {...form.register("purchasePrice")} placeholder="0.00" />
        </SheetField>
        <SheetField label="Supplier">
          <Controller control={form.control} name="supplierId" render={({ field }) => (
            <ComboboxPicker value={field.value || ""}
              onChange={(val) => { field.onChange(val); if (val !== field.value) { form.setValue("supplierOrderId", ""); form.setValue("purchaseOrderNumber", ""); } }}
              options={lookups.suppliers.map((s) => ({ value: s.id, label: s.name, description: s.contactName || undefined }))}
              placeholder="No supplier" searchPlaceholder="Search suppliers…" emptyMessage="No suppliers found."
              onCreateNew={() => onOpen("supplier")} createNewLabel="New supplier" allowClear />
          )} />
        </SheetField>
        {supplierId ? (
          <SheetField label="Order #" hint={!orderId && prior ? `Previously recorded as "${prior}".` : undefined}>
            <Controller control={form.control} name="supplierOrderId" render={({ field }) => (
              <ComboboxPicker value={field.value || ""}
                onChange={(val) => { field.onChange(val); applyOrder(form, lookups.supplierOrders.find((x) => x.id === val)); }}
                options={lookups.supplierOrders.map((o) => ({ value: o.id, label: o.orderNumber, description: `${supplierOrderTypeLabels[o.type] ?? o.type} · ${supplierOrderStatusLabels[o.status] ?? o.status}` }))}
                placeholder="No order" searchPlaceholder="Search orders…" emptyMessage="No orders for this supplier yet."
                onCreateNew={() => onOpen("order")} createNewLabel="New order" allowClear />
            )} />
          </SheetField>
        ) : null}
        <SheetField label="Warranty expiry" htmlFor="asset-warranty" error={errors.warrantyExpiry?.message as string | undefined}>
          <Input id="asset-warranty" type="date" defaultValue={dateText(initial.warrantyExpiry)} {...form.register("warrantyExpiry")} />
        </SheetField>
      </div>
      <Controller name="customFieldValues" control={form.control} render={({ field }) => (
        <CustomFieldsInput entityType="ASSET" values={(field.value as Record<string, string>) ?? {}} onChange={field.onChange} />
      )} />
      <SheetField label="Tags">
        <Controller name="tags" control={form.control} render={({ field }) => (
          <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={lookups.orgTags} placeholder="Add tags…" />
        )} />
      </SheetField>
    </>
  );
}
