"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ConvexError } from "convex/values";

import { useActiveOrganization } from "@/lib/auth-client";
import { useBulkAssetWrites } from "@/hooks/use-bulk-asset-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { peekNextAssetTags } from "@/server/settings";
import { bulkAssetStatusLabels } from "@/lib/status-labels";
import { bulkAssetCreateSchema, bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";
import { FormSheet } from "@/components/ui/form-sheet";
import { SheetField, SheetMore, SheetSection } from "@/components/ui/sheet-parts";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QuickCreateLocation } from "./quick-create-location";
import { useAssetSheetLookups } from "./use-asset-sheet-lookups";
import { useTagTaken } from "./use-tag-taken";

const STATUS_ORDER = ["ACTIVE", "LOW_STOCK", "OUT_OF_STOCK", "RETIRED"] as const;

export interface BulkSheetProps {
  mode: "create" | "edit";
  values: BulkAssetFormValues & { id?: string };
  onClose: () => void;
  onSaved?: (r: { id: string }) => void;
  onImportCsv?: () => void;
  words?: React.ReactNode;
}

/** `Bulk stock`: model · stock code · total quantity · status · location, then price per unit, notes, tags (D63). */
export function BulkStockSheet({ mode, values, onClose, onSaved, onImportCsv, words }: BulkSheetProps) {
  const router = useRouter();
  const editing = mode === "edit";
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useBulkAssetWrites();
  const tagTaken = useTagTaken(orgId, values.id);
  // A create needs at least one on hand; an edit may take it to 0 (out of stock).
  const form = useForm<BulkAssetFormValues>({
    resolver: zodResolver(editing ? bulkAssetSchema : bulkAssetCreateSchema),
    mode: "onTouched",
    defaultValues: values,
  });
  const { errors } = form.formState;
  const [saving, setSaving] = useState(false);
  const [locationDialog, setLocationDialog] = useState(false);
  const lookups = useAssetSheetLookups(orgId, "bulk");

  useEffect(() => {
    if (editing || values.assetTag) return;
    let live = true;
    peekNextAssetTags(1)
      .then(([tag]) => live && form.setValue("assetTag", tag, { shouldDirty: false }))
      .catch(() => undefined); // advisory: the person can still type a stock code
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened sheet
  }, []);

  // The early "already used" answer lives in its own state: the form's own blur validation
  // would otherwise clear a message set after an async lookup.
  const [taken, setTaken] = useState<string | null>(null);
  const checkTag = async (tag: string) => setTaken(await tagTaken(tag));

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
        announceListWrite({ title: `Created ${data.assetTag}`, undoneTitle: `Removed ${data.assetTag}`, performUndo: async () => void (await writes.remove(id)) });
        onSaved?.({ id });
        if (again) {
          const [tag] = await peekNextAssetTags(1).catch(() => [""]);
          form.reset({ ...data, assetTag: tag, totalQuantity: undefined }, { keepDefaultValues: false });
        } else onClose();
      } catch (e) {
        const data0 = e instanceof ConvexError ? (e.data as string | { message?: string }) : null;
        const text = data0 != null ? (typeof data0 === "string" ? data0 : (data0.message ?? "")) : e instanceof Error ? e.message : "";
        if (/already exists/i.test(text)) {
          setTaken(`${data.assetTag} is already used by another asset`);
        } else showError(e, { fallbackTitle: editing ? "Couldn't save the stock" : "Couldn't create the stock" });
      } finally {
        setSaving(false);
      }
    })();

  return (
    <>
      <FormSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={editing ? `Edit ${values.assetTag || "bulk stock"}` : "New bulk stock"}
        description="Bulk stock is tracked by quantity, not by serial."
        primaryLabel={editing ? "Save" : "Create stock"}
        onSubmit={() => save(false)}
        submitting={saving}
        dirty={form.formState.isDirty}
        addAnother={editing ? undefined : { label: "Save and add another", onSelect: () => save(true) }}
        footerStart={!editing && onImportCsv ? <button type="button" onClick={onImportCsv} className="min-h-11 text-table-cell text-ink-2 underline-offset-4 hover:underline">Import CSV…</button> : undefined}
      >
        <div className="space-y-6">
          {words}
          <SheetSection title="Identity" hint="The model and how much is on hand.">
            <SheetField label="Equipment model" required error={errors.modelId?.message}>
              <Controller control={form.control} name="modelId" render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={lookups.models.map((m) => ({ value: m.id, label: `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.name}`, description: m.modelNumber || undefined }))}
                  placeholder="Search models…"
                  searchPlaceholder="Search models…"
                  emptyMessage="No bulk models found."
                  onCreateNew={() => router.push("/assets/models/new")}
                  createNewLabel="New model"
                />
              )} />
            </SheetField>
            <div className="grid gap-4 sm:grid-cols-2">
              <SheetField label="Stock code" required error={errors.assetTag?.message ?? taken ?? undefined} hint={editing ? undefined : "Pre-filled from your next sequence. Edit it or scan a label."}>
                <AssetTagInput
                  {...form.register("assetTag", { onBlur: (e) => void checkTag(e.target.value), onChange: () => setTaken(null) })}
                  onScan={(val) => { form.setValue("assetTag", val, { shouldDirty: true }); void checkTag(val); }}
                  aria-invalid={!!errors.assetTag}
                  placeholder="e.g. AV-SM57"
                  className="font-mono"
                />
              </SheetField>
              <SheetField label="Total quantity" htmlFor="bulk-qty" required error={errors.totalQuantity?.message}>
                <Input id="bulk-qty" type="number" min={editing ? 0 : 1} step={1} inputMode="numeric" {...form.register("totalQuantity")} aria-invalid={!!errors.totalQuantity} />
              </SheetField>
            </div>
          </SheetSection>

          <SheetSection title="Status & location" hint="Where it lives and its stock state.">
            <div className="grid gap-4 sm:grid-cols-2">
              <SheetField label="Status">
                <Controller control={form.control} name="status" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue>{bulkAssetStatusLabels[field.value ?? "ACTIVE"] ?? "Active"}</SelectValue></SelectTrigger>
                    <SelectContent>{STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{bulkAssetStatusLabels[s]}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </SheetField>
              <SheetField label="Location">
                <Controller control={form.control} name="locationId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={lookups.locations.map((l) => ({ value: l.id, label: l.parent ? `${l.parent.name} → ${l.name}` : l.name, description: l.type }))}
                    placeholder="No location"
                    searchPlaceholder="Search locations…"
                    emptyMessage="No locations found."
                    onCreateNew={() => setLocationDialog(true)}
                    createNewLabel="New location"
                    allowClear
                  />
                )} />
              </SheetField>
            </div>
          </SheetSection>

          <SheetMore defaultOpen={editing}>
            <SheetField label="Price per unit ($)" hint="Leave blank if unknown." error={errors.purchasePricePerUnit?.message as string | undefined}>
              <Input type="number" step="0.01" min="0" inputMode="decimal" {...form.register("purchasePricePerUnit")} placeholder="0.00" />
            </SheetField>
            <SheetField label="Notes" error={errors.notes?.message}>
              <Textarea {...form.register("notes")} placeholder="Any additional notes" rows={3} />
            </SheetField>
            <SheetField label="Tags">
              <Controller name="tags" control={form.control} render={({ field }) => (
                <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={lookups.orgTags} placeholder="Add tags…" />
              )} />
            </SheetField>
          </SheetMore>
        </div>
      </FormSheet>
      <QuickCreateLocation open={locationDialog} onOpenChange={setLocationDialog} onCreated={(id) => form.setValue("locationId", id, { shouldDirty: true })} />
    </>
  );
}
