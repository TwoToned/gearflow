"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { useLocationWrites } from "@/hooks/use-location-writes";
import { useLocations } from "@/hooks/use-locations";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrgTags } from "@/hooks/use-org-tags";
import { locationTypeLabels } from "@/lib/status-labels";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField, SmartFormActions, SmartFormPreviewPill,
} from "@/components/ui/smart-form";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";

interface LocationFormProps {
  initialData?: LocationFormValues & { id: string };
}

const LOCATION_TYPE_ORDER = ["WAREHOUSE", "VENUE", "VEHICLE", "OFFSITE"] as const;

export function LocationForm({ initialData }: LocationFormProps) {
  const router = useRouter();
  const isEditing = !!initialData?.id;
  const [showCreateParent, setShowCreateParent] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  // Reactive location list from Convex (a sibling created elsewhere appears as a
  // selectable parent instantly). Exclude self — a location can't be its own parent.
  const allLocations = (useLocations(orgId) ?? []).filter(
    (l) => l.id !== initialData?.id,
  );

  const orgTags = useOrgTags(orgId);

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: initialData || {
      name: "",
      address: "",
      latitude: null,
      longitude: null,
      type: "WAREHOUSE",
      isDefault: false,
      notes: "",
      parentId: null,
      tags: [],
    },
  });

  const v = form.watch();

  const locWrites = useLocationWrites();
  const mutation = useServerMutation({
    mutationFn: (data: LocationFormValues) =>
      isEditing ? locWrites.update(initialData!.id, data) : locWrites.create(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Location updated" : "Location created");
      const id = isEditing ? initialData!.id : (result as { id: string }).id;
      router.push(`/locations/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Derivations ───────────────────────────────────────────────
  const parentLoc = v.parentId ? allLocations.find((l) => l.id === v.parentId) : null;
  const parentAddress = parentLoc?.address || undefined;

  const previewName = (v.name || "New location").trim();
  const typeLabel = locationTypeLabels[v.type ?? "WAREHOUSE"] ?? "Warehouse";
  const previewAddress = (v.address || parentAddress || "").trim();

  const helperTip = !v.name
    ? "Start with a name — Main warehouse, Loading dock, Truck 2. That's enough to save."
    : !previewAddress
      ? "Add an address to map it and bias address search. Optional — name is all you need."
      : "Looking good. Nest it under a parent or set it as the default for new assets.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New location"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                  <MapPin className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={cn("text-card-title font-semibold leading-tight", previewName === "New location" ? "text-faint" : "text-ink")}>
                    {previewName}
                  </p>
                  <SmartFormPreviewPill>{typeLabel}</SmartFormPreviewPill>
                  <p className={cn("text-caption", previewAddress ? "text-muted" : "text-faint")}>
                    {previewAddress || "No address yet"}
                  </p>
                </div>
              </div>
            </div>
          </SmartFormPreview>
        </>
      }
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="What it is and what kind of place." divider={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Name" required error={form.formState.errors.name?.message}>
                <Input
                  {...form.register("name")}
                  placeholder="Main warehouse"
                  aria-invalid={!!form.formState.errors.name}
                />
              </SmartFormField>
            </div>
            <SmartFormField label="Type">
              <Controller control={form.control} name="type" render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(val) => field.onChange((val ?? "WAREHOUSE") as LocationFormValues["type"])}
                >
                  <SelectTrigger>
                    <SelectValue>{locationTypeLabels[field.value ?? "WAREHOUSE"] ?? "Warehouse"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_TYPE_ORDER.map((t) => (
                      <SelectItem key={t} value={t}>{locationTypeLabels[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Place */}
        <SmartFormSection title="Place" hint="Where it sits and how it nests.">
          <div className="space-y-5">
            <SmartFormField label="Parent location" hint="Nest this under another location, e.g. a zone in a warehouse.">
              <Controller control={form.control} name="parentId" render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={(val) => field.onChange(val || null)}
                  options={allLocations.map((loc) => ({
                    value: loc.id,
                    label: loc.name,
                    description: locationTypeLabels[loc.type ?? "WAREHOUSE"] ?? loc.type,
                  }))}
                  placeholder="None (top-level)"
                  searchPlaceholder="Search locations…"
                  emptyMessage="No locations found."
                  onCreateNew={() => setShowCreateParent(true)}
                  createNewLabel="New location"
                  allowClear
                />
              )} />
            </SmartFormField>
            <SmartFormField
              label="Address"
              hint={v.parentId && !v.address ? "Using the parent location's address. Type to set a custom one." : undefined}
            >
              <Controller
                name="address"
                control={form.control}
                render={({ field }) => (
                  <AddressInput
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onPlaceSelect={(place) => {
                      if (place) {
                        form.setValue("latitude", place.latitude);
                        form.setValue("longitude", place.longitude);
                      } else {
                        form.setValue("latitude", null);
                        form.setValue("longitude", null);
                      }
                    }}
                    initialCoordinates={
                      v.latitude != null && v.longitude != null
                        ? { latitude: v.latitude as number, longitude: v.longitude as number }
                        : null
                    }
                    placeholder={parentAddress ? `Inherited: ${parentAddress}` : "123 Main St, City"}
                    countryCode={orgCountry}
                  />
                )}
              />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* More details — progressive disclosure */}
        <section className="border-t border-line pt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="more" className="border-line">
              <AccordionTrigger>More details</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 pt-1">
                  <SmartFormField label="Notes">
                    <Textarea {...form.register("notes")} rows={3} placeholder="Additional details about this location…" />
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
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={v.isDefault}
                      onCheckedChange={(checked) => form.setValue("isDefault", !!checked)}
                    />
                    <Label className="text-ui-text">Default location for new assets</Label>
                  </label>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      </div>

      <SmartFormActions>
        <Button type="button" variant="line" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEditing ? "Update location" : "Create location"}
        </Button>
      </SmartFormActions>

      <QuickCreateLocation
        open={showCreateParent}
        onOpenChange={setShowCreateParent}
        onCreated={(id) => form.setValue("parentId", id)}
      />
    </SmartFormLayout>
  );
}
