"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ConvexError } from "convex/values";
import { toast } from "sonner";

import { useActiveOrganization } from "@/lib/auth-client";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useActivationMilestones } from "@/hooks/use-activation-milestones";
import { activeMilestoneKey } from "@/lib/activation-milestones";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { peekNextAssetTags } from "@/server/settings";
import { assetStatusLabels, conditionLabels, supplierOrderStatusLabels, supplierOrderTypeLabels } from "@/lib/status-labels";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import { FormSheet } from "@/components/ui/form-sheet";
import { SheetField, SheetMore, SheetSection } from "@/components/ui/sheet-parts";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomFieldsInput } from "@/components/custom-fields/custom-fields-input";
import { QuickCreateLocation } from "./quick-create-location";
import { QuickCreateSupplier } from "./quick-create-supplier";
import { QuickCreateSupplierOrder } from "./quick-create-supplier-order";
import { useAssetSheetLookups } from "./use-asset-sheet-lookups";
import { useTagTaken } from "./use-tag-taken";

// SOLD is written only by the sale flow, never picked here (WS11 #950).
const STATUS_ORDER = ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RESERVED", "RETIRED", "LOST"] as const;
const CONDITION_ORDER = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

export interface SerialisedSheetProps {
  mode: "create" | "edit";
  /** Edit: the record. Create: prefill (New asset like this, a model's New asset). */
  values: AssetFormValues & { id?: string };
  onClose: () => void;
  onSaved?: (r: { id: string }) => void;
  onImportCsv?: () => void;
  /** Create words: `Serialised unit · Bulk stock`. */
  words?: React.ReactNode;
}

const fmtDate = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d as string | undefined));

/** What `Save and add another` keeps: model, location, condition, status, purchase context. The tag advances, the serial clears. */
export function nextAfterAdd(v: AssetFormValues, nextTag: string): AssetFormValues {
  return { ...v, assetTag: nextTag, serialNumber: "", customName: "", barcode: undefined };
}

export function SerialisedSheet({ mode, values, onClose, onSaved, onImportCsv, words }: SerialisedSheetProps) {
  const router = useRouter();
  const editing = mode === "edit";
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useAssetWrites();
  const milestones = useActivationMilestones(orgId);
  const isAssetMilestone = milestones != null && activeMilestoneKey(milestones) === "asset";
  const tagTaken = useTagTaken(orgId, values.id);

  const form = useForm<AssetFormValues>({ resolver: zodResolver(assetSchema), mode: "onTouched", defaultValues: values });
  const v = form.watch();
  const { errors } = form.formState;
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<"location" | "supplier" | "order" | null>(null);
  const lookups = useAssetSheetLookups(orgId, "serialized", v.supplierId);

  // Create: pre-fill the next tag (a preview; reserved on save).
  useEffect(() => {
    if (editing || values.assetTag) return;
    let live = true;
    peekNextAssetTags(1)
      .then(([tag]) => live && form.setValue("assetTag", tag, { shouldDirty: false }))
      .catch(() => undefined); // advisory: the person can still type a tag
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened sheet
  }, []);

  // The early "already used" answer lives in its own state: the form's own blur validation
  // would otherwise clear a message set after an async lookup.
  const [taken, setTaken] = useState<string | null>(null);
  const checkTag = async (tag: string) => setTaken(await tagTaken(tag));

  /** Save. `again` keeps the sheet open on a fresh sibling (batched create). */
  const save = (again: boolean) =>
    form.handleSubmit(async (data) => {
      const clash = await tagTaken(data.assetTag);
      setTaken(clash);
      if (clash) return;
      setSaving(true);
      try {
        if (editing) {
          const r = await writes.update(values.id!, data);
          announceListWrite({
            title: r.undoable ? `Saved ${data.assetTag}` : `Nothing changed on ${data.assetTag}`,
            undoneTitle: `Restored ${data.assetTag}`,
            performUndo: r.undoable ? async () => void (await writes.undoUpdate(values.id!, r.auditId)) : undefined,
          });
          onSaved?.({ id: values.id! });
          onClose();
          return;
        }
        const { id } = await writes.create(data);
        const onFirstModel = !!data.modelId && data.modelId === milestones?.firstModelId;
        if (isAssetMilestone && onFirstModel) {
          toast.success(`Created ${data.assetTag}`, { action: { label: "Create your first job", onClick: () => router.push("/projects/new") } });
        } else {
          announceListWrite({ title: `Created ${data.assetTag}`, undoneTitle: `Removed ${data.assetTag}`, performUndo: async () => void (await writes.remove(id)) });
        }
        onSaved?.({ id });
        if (again) {
          const [tag] = await peekNextAssetTags(1).catch(() => [""]);
          form.reset(nextAfterAdd(data, tag), { keepDefaultValues: false });
        } else onClose();
      } catch (e) {
        const dup = e instanceof ConvexError && (e.data as { code?: string } | undefined)?.code === "DUPLICATE_ASSET_TAG";
        if (dup) setTaken(`${data.assetTag} is already used by another asset`);
        else showError(e, { fallbackTitle: editing ? "Couldn't save the asset" : "Couldn't create the asset" });
      } finally {
        setSaving(false);
      }
    })();

  return (
    <>
      <FormSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={editing ? `Edit ${values.assetTag || "asset"}` : "New asset"}
        description={editing ? "Notes live on the Notes tab." : "A serialised unit: tracked by its own tag."}
        primaryLabel={editing ? "Save" : "Create asset"}
        onSubmit={() => save(false)}
        submitting={saving}
        dirty={form.formState.isDirty}
        addAnother={editing ? undefined : { label: "Save and add another", onSelect: () => save(true) }}
        footerStart={!editing && onImportCsv ? <button type="button" onClick={onImportCsv} className="min-h-11 text-table-cell text-ink-2 underline-offset-4 hover:underline">Import CSV…</button> : undefined}
      >
        <div className="space-y-6">
          {words}
          <SheetSection title="Identity" hint="What it is and how you'll find it.">
            <div data-tour-anchor="tour-asset-model-field">
              <SheetField label="Equipment model" required error={errors.modelId?.message}>
                <Controller control={form.control} name="modelId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={lookups.models.map((m) => ({ value: m.id, label: `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.name}`, description: m.modelNumber || undefined }))}
                    placeholder="Search models…"
                    searchPlaceholder="Search models…"
                    emptyMessage="No models found."
                    onCreateNew={() => router.push("/assets/models/new")}
                    createNewLabel="New model"
                  />
                )} />
              </SheetField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SheetField label="Asset tag" required error={errors.assetTag?.message ?? taken ?? undefined} hint={editing ? undefined : "Pre-filled from your next sequence. Edit it or scan a label."}>
                <AssetTagInput
                  {...form.register("assetTag", { onBlur: (e) => void checkTag(e.target.value), onChange: () => setTaken(null) })}
                  onScan={(val) => { form.setValue("assetTag", val, { shouldDirty: true }); void checkTag(val); }}
                  aria-invalid={!!errors.assetTag}
                  placeholder="Asset tag"
                  className="font-mono"
                />
              </SheetField>
              <SheetField label="Serial number" error={errors.serialNumber?.message}>
                <Input {...form.register("serialNumber")} placeholder="Serial number" />
              </SheetField>
            </div>
            <SheetField label="Custom name" hint="An optional friendly name, e.g. FOH Console 1." error={errors.customName?.message}>
              <Input {...form.register("customName")} placeholder="e.g. FOH Console 1" />
            </SheetField>
          </SheetSection>

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
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={lookups.locations.map((l) => ({ value: l.id, label: l.parent ? `${l.parent.name} → ${l.name}` : l.name, description: l.type }))}
                  placeholder="No location"
                  searchPlaceholder="Search locations…"
                  emptyMessage="No locations found."
                  onCreateNew={() => setDialog("location")}
                  createNewLabel="New location"
                  allowClear
                />
              )} />
            </SheetField>
          </SheetSection>

          <SheetMore defaultOpen={editing} label="Purchase and more details">
            <div className="grid gap-4 sm:grid-cols-2">
              <SheetField label="Purchase date" error={errors.purchaseDate?.message as string | undefined}>
                <Input type="date" defaultValue={fmtDate(values.purchaseDate)} {...form.register("purchaseDate")} />
              </SheetField>
              <SheetField label="Purchase price ($)" hint="Leave blank if unknown." error={errors.purchasePrice?.message as string | undefined}>
                <Input type="number" step="0.01" min="0" inputMode="decimal" {...form.register("purchasePrice")} placeholder="0.00" />
              </SheetField>
              <SheetField label="Supplier">
                <Controller control={form.control} name="supplierId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={(val) => {
                      field.onChange(val);
                      if (val !== field.value) { form.setValue("supplierOrderId", ""); form.setValue("purchaseOrderNumber", ""); }
                    }}
                    options={lookups.suppliers.map((s) => ({ value: s.id, label: s.name, description: s.contactName || undefined }))}
                    placeholder="No supplier"
                    searchPlaceholder="Search suppliers…"
                    emptyMessage="No suppliers found."
                    onCreateNew={() => setDialog("supplier")}
                    createNewLabel="New supplier"
                    allowClear
                  />
                )} />
              </SheetField>
              {v.supplierId ? (
                <SheetField label="Order #" hint={!v.supplierOrderId && v.purchaseOrderNumber ? `Previously recorded as "${v.purchaseOrderNumber}".` : undefined}>
                  <Controller control={form.control} name="supplierOrderId" render={({ field }) => (
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={(val) => {
                        field.onChange(val);
                        const o = lookups.supplierOrders.find((x) => x.id === val);
                        if (o) {
                          form.setValue("purchaseOrderNumber", o.orderNumber);
                          if (!form.getValues("purchasePrice") && o.total != null) form.setValue("purchasePrice", Number(o.total));
                          if (!form.getValues("purchaseDate") && o.orderDate) form.setValue("purchaseDate", new Date(o.orderDate).toISOString().slice(0, 10));
                        } else if (!val) form.setValue("purchaseOrderNumber", "");
                      }}
                      options={lookups.supplierOrders.map((o) => ({ value: o.id, label: o.orderNumber, description: `${supplierOrderTypeLabels[o.type] ?? o.type} · ${supplierOrderStatusLabels[o.status] ?? o.status}` }))}
                      placeholder="No order"
                      searchPlaceholder="Search orders…"
                      emptyMessage="No orders for this supplier yet."
                      onCreateNew={() => setDialog("order")}
                      createNewLabel="New order"
                      allowClear
                    />
                  )} />
                </SheetField>
              ) : null}
              <SheetField label="Warranty expiry" error={errors.warrantyExpiry?.message as string | undefined}>
                <Input type="date" defaultValue={fmtDate(values.warrantyExpiry)} {...form.register("warrantyExpiry")} />
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
          </SheetMore>
        </div>
      </FormSheet>

      <QuickCreateLocation open={dialog === "location"} onOpenChange={(o) => !o && setDialog(null)} onCreated={(id) => form.setValue("locationId", id, { shouldDirty: true })} />
      <QuickCreateSupplier open={dialog === "supplier"} onOpenChange={(o) => !o && setDialog(null)} onCreated={(id) => form.setValue("supplierId", id, { shouldDirty: true })} />
      {v.supplierId ? (
        <QuickCreateSupplierOrder
          open={dialog === "order"}
          onOpenChange={(o) => !o && setDialog(null)}
          supplierId={v.supplierId}
          onCreated={(o) => { form.setValue("supplierOrderId", o.id, { shouldDirty: true }); form.setValue("purchaseOrderNumber", o.orderNumber); }}
        />
      ) : null}
    </>
  );
}
