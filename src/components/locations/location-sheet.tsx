"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AddressInput } from "@/components/ui/address-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartFormField, SmartFormSection } from "@/components/ui/smart-form";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { useLocationWrites } from "@/hooks/use-location-writes";
import { useLocations } from "@/hooks/use-locations";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { locationTypeLabels } from "@/lib/status-labels";
import { useOrgCountry } from "@/lib/use-org-country";
import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";
import { toast } from "sonner";

const TYPE_ORDER = ["WAREHOUSE", "VENUE", "VEHICLE", "OFFSITE"] as const;

/** The edited location, as the sheet's fields (blank text, null parent, no capacity = empty field). */
export interface LocationSheetInitial {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  type?: string | null;
  isDefault?: boolean | null;
  notes?: string | null;
  parentId?: string | null;
  tags?: string[] | null;
  capacity?: number | null;
}

const EMPTY: LocationFormValues = {
  name: "", address: "", latitude: null, longitude: null, type: "WAREHOUSE", isDefault: false, notes: "", parentId: null, tags: [], capacity: undefined,
};

function valuesOf(l?: LocationSheetInitial): LocationFormValues {
  if (!l) return EMPTY;
  return {
    name: l.name, address: l.address ?? "", latitude: l.latitude ?? null, longitude: l.longitude ?? null,
    type: (l.type ?? "WAREHOUSE") as LocationFormValues["type"], isDefault: l.isDefault ?? false, notes: l.notes ?? "",
    parentId: l.parentId ?? null, tags: l.tags ?? [], capacity: l.capacity ?? undefined,
  };
}

/** Pure: the ids a location may NOT be moved under: itself and everything beneath it. */
export function selfAndDescendants(all: { id: string; parentId?: string | null }[], id: string): Set<string> {
  const out = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of all) if (l.parentId && out.has(l.parentId) && !out.has(l.id)) (out.add(l.id), (grew = true));
  }
  return out;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent = create. */
  location?: LocationSheetInitial;
}

/**
 * The Location sheet (UX Phase 14, §9l/§9d.4): create and edit in ONE sheet on `FormSheet`. Identity (name,
 * type) · Place (parent, address, capacity) · More details (notes, tags, default for new assets; collapsed on
 * create, open on edit). Create offers `Save and add another` (keeps parent and type). Every save toasts
 * what happened with Undo from ONE closure; an edit that changed nothing says so and offers none.
 */
export function LocationSheet({ open, onOpenChange, location }: Props) {
  const router = useRouter();
  const editing = !!location;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useLocationWrites();
  const orgCountry = useOrgCountry();
  const orgTags = useOrgTags(orgId);
  const all = useLocations(orgId) ?? [];
  const blocked = location ? selfAndDescendants(all, location.id) : new Set<string>();
  const parents = all.filter((l) => !blocked.has(l.id));
  const [showCreateParent, setShowCreateParent] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const form = useForm<LocationFormValues>({ resolver: zodResolver(locationSchema), defaultValues: valuesOf(location) });
  // A different location (or reopening) starts from its own values.
  const key = location?.id ?? "new";
  React.useEffect(() => {
    if (open) form.reset(valuesOf(location));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens or the target changes
  }, [open, key]);
  const v = form.watch();
  const parentAddress = parents.find((l) => l.id === v.parentId)?.address || undefined;

  const saveEdit = async (values: LocationFormValues) => {
    const r = await writes.update(location!.id, values);
    if (!r.changed) toast("Nothing changed");
    else {
      announceListWrite({
        title: `Updated ${values.name}`,
        undoneTitle: "Change undone",
        performUndo: r.undoable ? async () => void (await writes.undoUpdate(location!.id, r.auditId)) : undefined,
      });
    }
    onOpenChange(false);
  };

  const saveCreate = async (values: LocationFormValues, another: boolean) => {
    const r = await writes.create(values);
    announceListWrite({
      title: `Created ${values.name}`,
      undoneTitle: `Removed ${values.name}`,
      performUndo: values.isDefault ? undefined : async () => void (await writes.undoCreate(r.id, r.auditId)),
    });
    if (another) {
      // Keeps context: parent and type stay, the rest clears.
      form.reset({ ...EMPTY, parentId: values.parentId ?? null, type: values.type });
      return;
    }
    onOpenChange(false);
    router.push(`/locations/${r.id}`);
  };

  const submit = (another: boolean) =>
    form.handleSubmit(async (values) => {
      setSaving(true);
      try {
        await (editing ? saveEdit(values) : saveCreate(values, another));
      } catch (e) {
        showError(e, { fallbackTitle: editing ? "Could not save the location" : "Could not create the location" });
      } finally {
        setSaving(false);
      }
    })();

  const errors = form.formState.errors;
  return (
    <>
      <FormSheet
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? `Edit ${location!.name}` : "New location"}
        description={editing ? undefined : "A warehouse, vehicle, venue or a bin inside one."}
        primaryLabel={editing ? "Save" : "Create location"}
        onSubmit={() => submit(false)}
        submitting={saving}
        dirty={form.formState.isDirty}
        addAnother={editing ? undefined : { label: "Save and add another", onSelect: () => submit(true), disabled: saving }}
      >
        <div className="space-y-6">
          <SmartFormSection title="Identity" hint="What it is and what kind of place." divider={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <SmartFormField label="Name" required error={errors.name?.message}>
                  <Input {...form.register("name")} placeholder="Main warehouse" aria-invalid={!!errors.name} autoFocus={!editing} />
                </SmartFormField>
              </div>
              <SmartFormField label="Type">
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(val) => field.onChange((val ?? "WAREHOUSE") as LocationFormValues["type"])}>
                      <SelectTrigger aria-label="Type">
                        <SelectValue>{locationTypeLabels[field.value ?? "WAREHOUSE"] ?? "Warehouse"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_ORDER.map((t) => (
                          <SelectItem key={t} value={t}>
                            {locationTypeLabels[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </SmartFormField>
            </div>
          </SmartFormSection>

          <SmartFormSection title="Place" hint="Where it sits, how it nests and how much it holds.">
            <div className="space-y-4">
              <SmartFormField label="Parent location" hint="Nest this under another location, e.g. a bin in a warehouse.">
                <Controller
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={(val) => field.onChange(val || null)}
                      options={parents.map((l) => ({ value: l.id, label: l.name, description: locationTypeLabels[l.type ?? "WAREHOUSE"] ?? l.type }))}
                      placeholder="None (top-level)"
                      searchPlaceholder="Search locations…"
                      emptyMessage="No locations found."
                      onCreateNew={() => setShowCreateParent(true)}
                      createNewLabel="New location"
                      allowClear
                    />
                  )}
                />
              </SmartFormField>
              <SmartFormField label="Address" hint={v.parentId && !v.address ? "Using the parent location's address. Type to set a custom one." : undefined}>
                <Controller
                  name="address"
                  control={form.control}
                  render={({ field }) => (
                    <AddressInput
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onPlaceSelect={(place) => {
                        form.setValue("latitude", place ? place.latitude : null, { shouldDirty: true });
                        form.setValue("longitude", place ? place.longitude : null, { shouldDirty: true });
                      }}
                      initialCoordinates={v.latitude != null && v.longitude != null ? { latitude: v.latitude as number, longitude: v.longitude as number } : null}
                      placeholder={parentAddress ? `Inherited: ${parentAddress}` : "123 Main St, City"}
                      countryCode={orgCountry}
                    />
                  )}
                />
              </SmartFormField>
              <SmartFormField
                label="Capacity"
                hint="How many items (assets, bulk lines and kits) this place is meant to hold. Leave blank if it has no limit."
                error={errors.capacity?.message}
              >
                <Input {...form.register("capacity")} type="number" inputMode="numeric" min={1} step={1} placeholder="e.g. 600" aria-invalid={!!errors.capacity} />
              </SmartFormField>
            </div>
          </SmartFormSection>

          <details open={editing} className="border-t border-line pt-4">
            <summary className="cursor-pointer text-ui-text font-medium text-ink">More details</summary>
            <div className="space-y-4 pt-3">
              <SmartFormField label="Notes" error={errors.notes?.message}>
                <Textarea {...form.register("notes")} rows={3} placeholder="Additional details about this location…" />
              </SmartFormField>
              <SmartFormField label="Tags">
                <Controller
                  name="tags"
                  control={form.control}
                  render={({ field }) => <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={orgTags} placeholder="Add tags…" />}
                />
              </SmartFormField>
              <label className="flex items-center gap-2">
                <Checkbox checked={!!v.isDefault} onCheckedChange={(c) => form.setValue("isDefault", !!c, { shouldDirty: true })} />
                <Label className="text-ui-text">Default location for new assets</Label>
              </label>
            </div>
          </details>
        </div>
      </FormSheet>
      <QuickCreateLocation open={showCreateParent} onOpenChange={setShowCreateParent} onCreated={(id) => form.setValue("parentId", id, { shouldDirty: true })} />
    </>
  );
}
