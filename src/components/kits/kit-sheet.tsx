"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { XeroAccountCodeField } from "@/components/settings/xero-coding-fields";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartFormField, SmartFormSection } from "@/components/ui/smart-form";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useKitWrites } from "@/hooks/use-kit-writes";
import { useLocations } from "@/hooks/use-locations";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { useActiveOrganization } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { conditionLabels } from "@/lib/status-labels";
import { kitSchema, type KitFormValues } from "@/lib/validations/kit";
import { peekNextAssetTags } from "@/server/settings";

const CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;
const CHECK_MODES: Record<string, string> = { KIT_LEVEL: "Kit level: check the kit once, contents inherit", PER_ITEM: "Per item: each asset gets its own model checks" };

/** A kit's own fields as the sheet edits them (status, photos and flags are not the sheet's). */
export type KitSheetInitial = Pick<
  KitFormValues,
  "name" | "assetTag" | "description" | "categoryId" | "condition" | "locationId" | "weight" | "caseType" | "caseDimensions" | "notes" | "purchaseDate" | "purchasePrice" | "tags" | "checkMode" | "xeroAccountCode"
> & { id: string };

const EMPTY: KitFormValues = { name: "", assetTag: "", description: "", categoryId: "", condition: "NEW", checkMode: "KIT_LEVEL", locationId: "", weight: undefined, caseType: "", caseDimensions: "", notes: "", purchaseDate: undefined, purchasePrice: undefined, tags: [], xeroAccountCode: "" };

function valuesOf(k?: KitSheetInitial): KitFormValues {
  return k ? { ...EMPTY, ...k } : EMPTY;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit this kit. */
  kit?: KitSheetInitial;
  /** Absent `kit` and present `copyOf` = create a copy of this kit's own fields (members are not copied). */
  copyOf?: KitSheetInitial;
}

/**
 * The Kit sheet (UX Phase 14, 14b-2, §9l): create, edit and duplicate in ONE sheet on `FormSheet`. Identity (name,
 * asset tag, condition) · Place (category, location, check mode) · Case (type, dimensions, weight) · More details
 * (description, notes, tags, purchase). There is NO status field: a kit's state is derived (D75). Create offers
 * `Save and add another`; every save toasts with the exact Undo from ONE closure; an edit that changed nothing
 * says so and offers none. Blank optional boxes CLEAR the field (the old form could not).
 */
export function KitSheet({ open, onOpenChange, kit, copyOf }: Props) {
  const router = useRouter();
  const editing = !!kit;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useKitWrites();
  const categories = useCategoriesWithParent(orgId) ?? [];
  const rawLocations = useLocations(orgId) ?? [];
  const locNameById = new Map(rawLocations.map((l) => [l.id, l.name]));
  const orgTags = useOrgTags(orgId);
  const xeroLinked = useXeroLinked();
  const [showCreateLocation, setShowCreateLocation] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const form = useForm<KitFormValues>({ resolver: zodResolver(kitSchema), defaultValues: valuesOf(kit ?? copyOf) });
  const key = kit?.id ?? (copyOf ? `copy:${copyOf.id}` : "new");
  React.useEffect(() => {
    if (!open) return;
    const start = valuesOf(kit ?? copyOf);
    form.reset(kit ? start : { ...start, ...(copyOf ? { name: `${copyOf.name} (copy)` } : {}), assetTag: "" });
    if (!kit) {
      // The next tag in the org's sequence, pre-filled (the user can type or scan another).
      peekNextAssetTags(1).then(([tag]) => form.setValue("assetTag", tag)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens or its target changes
  }, [open, key]);

  const saveEdit = async (values: KitFormValues) => {
    const r = await writes.edit(kit!.id, values);
    if (!r.changed) toast("Nothing changed");
    else announceListWrite({ title: `Updated ${values.assetTag}`, undoneTitle: "Change undone", performUndo: async () => void (await writes.undoEdit(kit!.id, r.auditId)) });
    onOpenChange(false);
  };

  const saveCreate = async (values: KitFormValues, another: boolean) => {
    const r = await writes.create({ ...values, status: "AVAILABLE" });
    announceListWrite({ title: `Created ${values.assetTag}`, undoneTitle: `Removed ${values.assetTag}`, performUndo: async () => void (await writes.undoCreate(r.id, r.auditId)) });
    if (another) {
      // Keeps context: category, location, condition and check mode stay; the rest clears and the next tag is pre-filled.
      form.reset({ ...EMPTY, categoryId: values.categoryId, locationId: values.locationId, condition: values.condition, checkMode: values.checkMode });
      peekNextAssetTags(1).then(([tag]) => form.setValue("assetTag", tag)).catch(() => {});
      return;
    }
    onOpenChange(false);
    router.push(`/kits/${r.id}`);
  };

  const submit = (another: boolean) =>
    form.handleSubmit(async (values) => {
      setSaving(true);
      try {
        await (editing ? saveEdit(values) : saveCreate(values, another));
      } catch (e) {
        showError(e, { fallbackTitle: editing ? "Could not save the kit" : "Could not create the kit" });
      } finally {
        setSaving(false);
      }
    })();

  const errors = form.formState.errors;
  const v = form.watch();
  return (
    <>
      <FormSheet
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? `Edit ${kit!.assetTag}` : copyOf ? `Duplicate ${copyOf.assetTag}` : "New kit"}
        description={editing ? undefined : "A case of gear that always travels together. Add its contents from the kit's page."}
        primaryLabel={editing ? "Save" : "Create kit"}
        onSubmit={() => submit(false)}
        submitting={saving}
        dirty={form.formState.isDirty}
        addAnother={editing ? undefined : { label: "Save and add another", onSelect: () => submit(true), disabled: saving }}
      >
        <div className="space-y-6">
          <SmartFormSection title="Identity" hint="What it is and how the warehouse finds it." divider={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <SmartFormField label="Name" required error={errors.name?.message}>
                  <Input {...form.register("name")} placeholder="Wireless mic case" aria-invalid={!!errors.name} autoFocus={!editing} />
                </SmartFormField>
              </div>
              <SmartFormField label="Asset tag" required hint={!editing ? "Pre-filled from your next sequence. Edit it or scan a label." : undefined} error={errors.assetTag?.message}>
                <AssetTagInput {...form.register("assetTag")} aria-invalid={!!errors.assetTag} onScan={(val) => form.setValue("assetTag", val, { shouldDirty: true })} placeholder="e.g. KIT-AUD-001" className="font-mono" />
              </SmartFormField>
              <SmartFormField label="Condition">
                <Controller control={form.control} name="condition" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Condition"><SelectValue>{conditionLabels[field.value ?? "NEW"] ?? "New"}</SelectValue></SelectTrigger>
                    <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c} value={c}>{conditionLabels[c]}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </SmartFormField>
            </div>
          </SmartFormSection>

          <SmartFormSection title="Place" hint="Where it lives and how it is checked.">
            <div className="grid gap-4 sm:grid-cols-2">
              <SmartFormField label="Category">
                <Controller control={form.control} name="categoryId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={(val) => field.onChange(val || "")}
                    options={categories.map((c) => ({ value: c.id, label: c.parent ? `${c.parent.name} → ${c.name}` : c.name }))}
                    placeholder="No category" searchPlaceholder="Search categories…" emptyMessage="No categories found." allowClear
                  />
                )} />
              </SmartFormField>
              <SmartFormField label="Location">
                <Controller control={form.control} name="locationId" render={({ field }) => (
                  <ComboboxPicker
                    value={field.value || ""}
                    onChange={(val) => field.onChange(val || "")}
                    options={rawLocations.map((l) => ({ value: l.id, label: l.parentId ? `${locNameById.get(l.parentId) ?? ""} → ${l.name}` : l.name, description: l.type }))}
                    placeholder="No location" searchPlaceholder="Search locations…" emptyMessage="No locations found."
                    onCreateNew={() => setShowCreateLocation(true)} createNewLabel="New location" allowClear
                  />
                )} />
              </SmartFormField>
              <div className="sm:col-span-2">
                <SmartFormField label="Check mode">
                  <Controller control={form.control} name="checkMode" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-label="Check mode"><SelectValue>{CHECK_MODES[field.value ?? "KIT_LEVEL"]}</SelectValue></SelectTrigger>
                      <SelectContent>{Object.entries(CHECK_MODES).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                </SmartFormField>
              </div>
            </div>
          </SmartFormSection>

          <SmartFormSection title="Case" hint="Physical packaging, handy for transport planning.">
            <div className="grid gap-4 sm:grid-cols-2">
              <SmartFormField label="Case type"><Input {...form.register("caseType")} placeholder="e.g. Pelican 1650" /></SmartFormField>
              <SmartFormField label="Case dimensions"><Input {...form.register("caseDimensions")} placeholder="600x400x300mm" /></SmartFormField>
              <SmartFormField label="Weight (kg)" error={errors.weight?.message}><Input type="number" step="0.1" min={0} {...form.register("weight")} placeholder="0.0" /></SmartFormField>
            </div>
          </SmartFormSection>

          <details open={editing} className="border-t border-line pt-4">
            <summary className="cursor-pointer text-ui-text font-medium text-ink">More details</summary>
            <div className="space-y-4 pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <SmartFormField label="Purchase date"><Input type="date" {...form.register("purchaseDate")} /></SmartFormField>
                <SmartFormField label="Purchase price ($)" error={errors.purchasePrice?.message}><Input type="number" step="0.01" min={0} {...form.register("purchasePrice")} placeholder="0.00" /></SmartFormField>
              </div>
              <SmartFormField label="Description"><Textarea {...form.register("description")} placeholder="What this kit is used for" rows={2} /></SmartFormField>
              <SmartFormField label="Notes"><Textarea {...form.register("notes")} placeholder="Any additional notes" rows={3} /></SmartFormField>
              <SmartFormField label="Tags">
                <Controller name="tags" control={form.control} render={({ field }) => <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={orgTags} placeholder="Add tags…" />} />
              </SmartFormField>
              {xeroLinked && (
                <Controller name="xeroAccountCode" control={form.control} render={({ field }) => (
                  <XeroAccountCodeField value={field.value} onChange={field.onChange} label="Xero account" placeholder="Inherit category default" />
                )} />
              )}
            </div>
          </details>
          {v.checkMode === "PER_ITEM" && <p className="t-micro text-muted">Each asset in the kit goes through its own model&apos;s check items in the warehouse.</p>}
        </div>
      </FormSheet>
      <QuickCreateLocation open={showCreateLocation} onOpenChange={setShowCreateLocation} onCreated={(id) => form.setValue("locationId", id, { shouldDirty: true })} />
    </>
  );
}
