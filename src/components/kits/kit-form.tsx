"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { Controller } from "react-hook-form";
import { kitSchema, type KitFormValues } from "@/lib/validations/kit";
import { createKit, updateKit } from "@/server/kits";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useLocations } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { useActiveOrganization } from "@/lib/auth-client";

interface KitFormProps {
  initialData?: KitFormValues & { id: string };
}

// Native <select> styled to match the registry inputs (§9.1 red focus ring,
// disabled treatment, 16px text to avoid iOS zoom).
const selectClass =
  "flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45";

export function KitForm({ initialData }: KitFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive categories (Convex) with synthetic parent name, sorted to match the
  // old getCategories() order.
  const categories = useCategoriesWithParent(orgId) ?? [];

  // Reactive location list from Convex; parent.name resolved from the flat list.
  const rawLocations = useLocations(orgId) ?? [];
  const locNameById = new Map(rawLocations.map((l) => [l.id, l.name]));
  const locations = rawLocations.map((l) => ({
    ...l,
    parent: l.parentId ? { name: locNameById.get(l.parentId) ?? "" } : null,
  }));

  const orgTags = useOrgTags(orgId);

  const form = useForm<KitFormValues>({
    resolver: zodResolver(kitSchema),
    defaultValues: initialData || {
      name: "",
      assetTag: "",
      description: "",
      categoryId: "",
      status: "AVAILABLE",
      condition: "NEW",
      checkMode: "KIT_LEVEL",
      locationId: "",
      weight: undefined,
      caseType: "",
      caseDimensions: "",
      notes: "",
      purchaseDate: undefined,
      purchasePrice: undefined,
      image: "",
      images: [],
      isActive: true,
    },
  });

  // Auto-populate asset tag for new kits
  useEffect(() => {
    if (!isEditing && !form.getValues("assetTag")) {
      peekNextAssetTags(1).then(([tag]) => {
        form.setValue("assetTag", tag);
      }).catch(() => {
        // ignore — user can still type manually
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useServerMutation({
    mutationFn: (data: KitFormValues) =>
      isEditing ? updateKit(initialData.id, data) : createKit(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Kit updated" : "Kit created");
      router.push(`/kits/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-6">
          <FormSection title="Kit details">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" {...form.register("name")} aria-invalid={!!form.formState.errors.name} placeholder="e.g. Audio kit A" />
              {form.formState.errors.name && (
                <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="assetTag">Asset tag *</Label>
              <AssetTagInput id="assetTag" {...form.register("assetTag")} aria-invalid={!!form.formState.errors.assetTag} onScan={(v) => form.setValue("assetTag", v)} placeholder="e.g. KIT-AUD-001" />
              {form.formState.errors.assetTag && (
                <p className="text-caption text-t-out">{form.formState.errors.assetTag.message}</p>
              )}
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
                allowClear
              />
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
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                {...form.register("status")}
                className={selectClass}
              >
                <option value="AVAILABLE">Available</option>
                <option value="CHECKED_OUT">Deployed</option>
                <option value="IN_MAINTENANCE">In maintenance</option>
                <option value="RETIRED">Retired</option>
                <option value="INCOMPLETE">Incomplete</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="condition">Condition</Label>
              <select
                id="condition"
                {...form.register("condition")}
                className={selectClass}
              >
                <option value="NEW">New</option>
                <option value="GOOD">Good</option>
                <option value="FAIR">Fair</option>
                <option value="POOR">Poor</option>
                <option value="DAMAGED">Damaged</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkMode">Check mode</Label>
              <select
                id="checkMode"
                {...form.register("checkMode")}
                className={selectClass}
              >
                <option value="KIT_LEVEL">Kit level — check the kit once, contents inherit</option>
                <option value="PER_ITEM">Per item — each asset gets its own model checks</option>
              </select>
              <p className="text-caption text-muted">
                {form.watch("checkMode") === "PER_ITEM"
                  ? "Each asset in the kit will go through its own model's check items during warehouse operations."
                  : "The kit is checked once during warehouse operations. All contents inherit the result."}
              </p>
            </div>
          </FormSection>

          <FormSection title="Case information">
            <div className="space-y-2">
              <Label htmlFor="caseType">Case type</Label>
              <Input id="caseType" {...form.register("caseType")} placeholder="e.g. Pelican 1650" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caseDimensions">Case dimensions</Label>
              <Input
                id="caseDimensions"
                {...form.register("caseDimensions")}
                placeholder="600x400x300mm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                step="0.1"
                {...form.register("weight")}
                placeholder="0.0"
              />
            </div>
          </FormSection>

          <FormSection title="Purchase information">
            <div className="space-y-2">
              <Label htmlFor="purchaseDate">Purchase date</Label>
              <Input id="purchaseDate" type="date" {...form.register("purchaseDate")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchasePrice">Purchase price ($)</Label>
              <Input
                id="purchasePrice"
                type="number"
                step="0.01"
                {...form.register("purchasePrice")}
              />
            </div>
          </FormSection>

          <FormSection title="Notes & tags">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...form.register("description")}
                placeholder="What this kit is used for"
                rows={2}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                {...form.register("notes")}
                placeholder="Any additional notes"
                rows={3}
              />
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
          </FormSection>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? "Update kit" : "Create kit"}
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
