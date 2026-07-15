"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Boxes } from "lucide-react";

import { cn } from "@/lib/utils";
import { kitSchema, type KitFormValues } from "@/lib/validations/kit";
import { useKitWrites } from "@/hooks/use-kit-writes";
import { kitStatusLabels, conditionLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { peekNextAssetTags } from "@/server/settings";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useLocations } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField,
} from "@/components/ui/smart-form";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { useActiveOrganization } from "@/lib/auth-client";

interface KitFormProps {
  initialData?: KitFormValues & { id: string };
}

const STATUS_ORDER = ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "INCOMPLETE"] as const;
const CONDITION_ORDER = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;
const CHECK_MODE_LABELS: Record<string, string> = {
  KIT_LEVEL: "Kit level",
  PER_ITEM: "Per item",
};

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

  const v = form.watch();

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

  const kitWrites = useKitWrites();

  const mutation = useServerMutation({
    mutationFn: (data: KitFormValues) =>
      isEditing ? kitWrites.update(initialData.id, data) : kitWrites.create(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Kit updated" : "Kit created");
      router.push(`/kits/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Live-preview derivations ──────────────────────────────────
  const previewName = (v.name || "New kit").trim();
  const previewTag = (v.assetTag || "").trim();
  const statusLabel = kitStatusLabels[v.status ?? "AVAILABLE"] ?? "Available";
  const checkModeLabel = CHECK_MODE_LABELS[v.checkMode ?? "KIT_LEVEL"] ?? "Kit level";

  const helperTip = !v.name
    ? "Right now it's just a named, empty case — load the gear in from the kit's page once it exists."
    : !previewTag
      ? "An asset tag is how the warehouse finds this kit on a shelf. We pre-filled the next one."
      : "Looking good. Add assets from the kit's page after saving — case and purchase details are optional.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New kit"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                  <Boxes className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={cn("text-card-title font-semibold leading-tight", previewName === "New kit" ? "text-faint" : "text-ink")}>
                    {previewName}
                  </p>
                  <p className={cn("t-mono text-caption", previewTag ? "text-muted" : "text-faint")}>
                    {previewTag || "No tag yet"}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <StatusIndicator category="kit" value={v.status ?? "AVAILABLE"} label={statusLabel} variant="pill" />
                    <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                      {checkModeLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </SmartFormPreview>
        </>
      }
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="What the kit is and how you'll find it." divider={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Name" required error={form.formState.errors.name?.message}>
                <Input
                  {...form.register("name")}
                  placeholder="e.g. Audio kit A"
                  aria-invalid={!!form.formState.errors.name}
                />
              </SmartFormField>
            </div>
            <div className="sm:col-span-2">
              <SmartFormField
                label="Asset tag"
                required
                hint={!isEditing ? "Pre-filled from your next sequence — edit it or scan a label." : undefined}
                error={form.formState.errors.assetTag?.message}
              >
                <AssetTagInput
                  {...form.register("assetTag")}
                  aria-invalid={!!form.formState.errors.assetTag}
                  onScan={(val) => form.setValue("assetTag", val)}
                  placeholder="e.g. KIT-AUD-001"
                  className="font-mono"
                />
              </SmartFormField>
            </div>
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
                  allowClear
                />
              )} />
            </SmartFormField>
            <SmartFormField label="Location">
              <Controller control={form.control} name="locationId" render={({ field }) => (
                <ComboboxPicker
                  value={field.value || ""}
                  onChange={field.onChange}
                  options={locations.map((loc) => ({
                    value: loc.id,
                    label: loc.parent ? `${loc.parent.name} → ${loc.name}` : loc.name,
                    description: loc.type,
                  }))}
                  placeholder="No location"
                  searchPlaceholder="Search locations…"
                  emptyMessage="No locations found."
                  onCreateNew={() => setShowCreateLocation(true)}
                  createNewLabel="New location"
                  allowClear
                />
              )} />
            </SmartFormField>
            <SmartFormField label="Status">
              <Controller control={form.control} name="status" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue>{kitStatusLabels[field.value ?? "AVAILABLE"] ?? "Available"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{kitStatusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </SmartFormField>
            <SmartFormField label="Condition">
              <Controller control={form.control} name="condition" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue>{conditionLabels[field.value ?? "NEW"] ?? "New"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>{conditionLabels[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </SmartFormField>
            <div className="sm:col-span-2">
              <SmartFormField
                label="Check mode"
                hint={
                  v.checkMode === "PER_ITEM"
                    ? "Each asset in the kit will go through its own model's check items during warehouse operations."
                    : "The kit is checked once during warehouse operations. All contents inherit the result."
                }
              >
                <Controller control={form.control} name="checkMode" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{CHECK_MODE_LABELS[field.value ?? "KIT_LEVEL"] ?? "Kit level"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KIT_LEVEL">Kit level — check the kit once, contents inherit</SelectItem>
                      <SelectItem value="PER_ITEM">Per item — each asset gets its own model checks</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </SmartFormField>
            </div>
          </div>
        </SmartFormSection>

        {/* Contents */}
        <SmartFormSection title="Contents" hint="What's packed inside.">
          <div className="rounded-[var(--r)] border border-dashed border-line bg-paper-2/40 p-4">
            <p className="text-ui-text text-ink">
              {isEditing ? "Manage kit contents from the kit's page." : "Save the kit first, then add assets to it."}
            </p>
            <p className="mt-1 t-micro text-muted">
              Add, remove and reorder serialized assets and bulk stock from the kit&apos;s detail page once it exists.
            </p>
            {isEditing && (
              <Button
                type="button"
                variant="line"
                size="sm"
                className="mt-3"
                onClick={() => router.push(`/kits/${initialData.id}`)}
              >
                Open kit contents
              </Button>
            )}
          </div>
        </SmartFormSection>

        {/* Case information */}
        <SmartFormSection title="Case information" hint="Physical packaging — handy for transport planning.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Case type">
              <Input {...form.register("caseType")} placeholder="e.g. Pelican 1650" />
            </SmartFormField>
            <SmartFormField label="Case dimensions">
              <Input {...form.register("caseDimensions")} placeholder="600x400x300mm" />
            </SmartFormField>
            <SmartFormField label="Weight (kg)">
              <Input type="number" step="0.1" {...form.register("weight")} placeholder="0.0" />
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
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SmartFormField label="Purchase date">
                      <Input type="date" {...form.register("purchaseDate")} />
                    </SmartFormField>
                    <SmartFormField label="Purchase price ($)">
                      <Input type="number" step="0.01" {...form.register("purchasePrice")} placeholder="0.00" />
                    </SmartFormField>
                  </div>
                  <SmartFormField label="Description">
                    <Textarea {...form.register("description")} placeholder="What this kit is used for" rows={2} />
                  </SmartFormField>
                  <SmartFormField label="Notes">
                    <Textarea {...form.register("notes")} placeholder="Any additional notes" rows={3} />
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
          {isEditing ? "Update kit" : "Create kit"}
        </Button>
      </div>

      <QuickCreateLocation
        open={showCreateLocation}
        onOpenChange={setShowCreateLocation}
        onCreated={(id) => form.setValue("locationId", id)}
      />
    </SmartFormLayout>
  );
}
