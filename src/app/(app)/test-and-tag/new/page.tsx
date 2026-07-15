"use client";

import { useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { testTagAssetSchema, type TestTagAssetFormValues } from "@/lib/validations/test-tag";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { createTestTagAsset, peekNextTestTagIds } from "@/server/test-tag-assets";
import { useTestProfiles } from "@/hooks/use-test-profiles";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { equipmentClassLabels, applianceTypeLabels } from "@/lib/status-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField,
} from "@/components/ui/smart-form";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";

const EQUIPMENT_CLASS_ORDER = ["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"] as const;
const APPLIANCE_TYPE_ORDER = [
  "APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD",
  "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "MICROWAVE", "OTHER",
] as const;

function NewTestTagAssetInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedAssetId = searchParams.get("assetId") || "";
  const preselectedBulkAssetId = searchParams.get("bulkAssetId") || "";
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const form = useForm<TestTagAssetFormValues>({
    resolver: zodResolver(testTagAssetSchema),
    defaultValues: {
      testTagId: "",
      description: "",
      equipmentClass: "CLASS_I",
      applianceType: "APPLIANCE",
      make: "",
      modelName: "",
      serialNumber: "",
      location: "",
      testIntervalMonths: 3,
      notes: "",
      assetId: preselectedAssetId,
      bulkAssetId: preselectedBulkAssetId,
    },
  });

  const peekQuery = useServerQuery({
    queryKey: ["peek-test-tag-ids", orgId],
    queryFn: () => peekNextTestTagIds(1),
  });

  const assetsQuery = useServerQuery({
    queryKey: ["assets", orgId, isAuthenticated, { pageSize: 500 }],
    queryFn: () => convex.query(api.assets.listPage, { orgId: orgId!, pageSize: 500 }),
    enabled: !!orgId && isAuthenticated,
  });

  const bulkAssetsQuery = useServerQuery({
    queryKey: ["bulk-assets", orgId, isAuthenticated, { pageSize: 500 }],
    queryFn: () => convex.query(api.bulkAssets.listPage, { orgId: orgId!, pageSize: 500 }),
    enabled: !!orgId && isAuthenticated,
  });

  // Reactive: testProfiles subscribes to Convex (filter isActive client-side).
  const profilesData = useTestProfiles(orgId);

  const profileList = (profilesData || []) as unknown as { id: string; name: string; equipmentClass: string; applianceType: string; isActive: boolean }[];
  const activeProfiles = profileList.filter(p => p.isActive);

  // Auto-populate the test tag ID from peek (only when no linked asset)
  useEffect(() => {
    if (peekQuery.data && peekQuery.data.length > 0 && !form.getValues("testTagId") && !preselectedAssetId) {
      form.setValue("testTagId", peekQuery.data[0]);
    }
  }, [peekQuery.data, form, preselectedAssetId]);

  // Auto-populate from linked serialized asset if assetId is provided
  useEffect(() => {
    if (preselectedAssetId && assetsQuery.data?.assets) {
      const asset = assetsQuery.data.assets.find((a: { id: string }) => a.id === preselectedAssetId) as {
        id: string; assetTag: string; serialNumber?: string | null; customName?: string | null;
        model?: { name?: string; manufacturer?: string | null; modelNumber?: string | null } | null;
      } | undefined;
      if (asset) {
        form.setValue("testTagId", asset.assetTag);
        if (!form.getValues("description")) {
          const modelName = asset.model?.name || "";
          const manufacturer = asset.model?.manufacturer || "";
          form.setValue("description", `${manufacturer ? manufacturer + " " : ""}${modelName} (${asset.assetTag})`);
          if (asset.model?.manufacturer) form.setValue("make", asset.model.manufacturer);
          if (asset.model?.modelNumber) form.setValue("modelName", asset.model.modelNumber);
          if (asset.serialNumber) form.setValue("serialNumber", asset.serialNumber);
        }
      }
    }
  }, [preselectedAssetId, assetsQuery.data, form]);

  // Auto-populate from linked bulk asset
  useEffect(() => {
    if (preselectedBulkAssetId && bulkAssetsQuery.data?.bulkAssets) {
      populateFromBulkAsset(preselectedBulkAssetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedBulkAssetId, bulkAssetsQuery.data]);

  function populateFromBulkAsset(bulkId: string) {
    if (!bulkId || !bulkAssetsQuery.data?.bulkAssets) return;
    const ba = (bulkAssetsQuery.data.bulkAssets as {
      id: string; assetTag: string;
      model: {
        name: string; manufacturer: string | null; modelNumber: string | null;
        defaultEquipmentClass: string | null; defaultApplianceType: string | null;
        defaultTestProfileId: string | null;
        testAndTagIntervalDays: number | null;
      };
      location?: { name: string } | null;
    }[]).find((b) => b.id === bulkId);
    if (!ba) return;

    const model = ba.model;
    form.setValue("description", `${model.manufacturer ? model.manufacturer + " " : ""}${model.name}`);
    if (model.manufacturer) form.setValue("make", model.manufacturer);
    if (model.modelNumber) form.setValue("modelName", model.modelNumber);
    if (model.defaultTestProfileId) {
      form.setValue("testProfileId", model.defaultTestProfileId);
      const profile = activeProfiles.find(p => p.id === model.defaultTestProfileId);
      if (profile) {
        form.setValue("equipmentClass", profile.equipmentClass as TestTagAssetFormValues["equipmentClass"]);
        form.setValue("applianceType", profile.applianceType as TestTagAssetFormValues["applianceType"]);
      }
    } else {
      if (model.defaultEquipmentClass) {
        form.setValue("equipmentClass", model.defaultEquipmentClass as TestTagAssetFormValues["equipmentClass"]);
      }
      if (model.defaultApplianceType) {
        form.setValue("applianceType", model.defaultApplianceType as TestTagAssetFormValues["applianceType"]);
      }
    }
    if (model.testAndTagIntervalDays) {
      form.setValue("testIntervalMonths", Math.max(1, Math.round(model.testAndTagIntervalDays / 30)));
    }
    if (ba.location?.name) form.setValue("location", ba.location.name);
  }

  const v = form.watch();
  const watchBulkAssetId = v.bulkAssetId;
  const watchAssetId = v.assetId;
  const watchProfileId = v.testProfileId;

  const mutation = useServerMutation({
    mutationFn: (data: TestTagAssetFormValues) =>
      createTestTagAsset({
        testTagId: data.testTagId,
        description: data.description,
        equipmentClass: data.equipmentClass,
        applianceType: data.applianceType,
        make: data.make || undefined,
        modelName: data.modelName || undefined,
        serialNumber: data.serialNumber || undefined,
        location: data.location || undefined,
        testIntervalMonths: Number(data.testIntervalMonths),
        notes: data.notes || undefined,
        assetId: data.assetId || undefined,
        bulkAssetId: data.bulkAssetId || undefined,
        testProfileId: data.testProfileId || undefined,
      }),
    onSuccess: (result) => {
      toast.success("Test tag asset created");
      router.push(`/test-and-tag/${result.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Live-preview derivations ──────────────────────────────────
  const previewTag = (v.testTagId || "").trim();
  const previewDesc = (v.description || "").trim();
  const selectedProfile = activeProfiles.find((p) => p.id === watchProfileId);
  const classLabel = equipmentClassLabels[v.equipmentClass ?? "CLASS_I"] ?? "Class I";
  const intervalMonths = Number(v.testIntervalMonths) || 0;

  const linkedToAsset = !!watchAssetId || !!watchBulkAssetId;
  const helperTip = !linkedToAsset && !previewTag
    ? "Link an existing asset to auto-fill its details, or register a standalone item."
    : !watchProfileId
      ? "Pick a test profile — it sets the equipment class, appliance type and required tests."
      : "Looking good. The test interval drives the next-due date once the item is tested.";

  return (
    <CanDo resource="testTag" action="create" fallback={<div className="p-8 text-center text-muted">You don&apos;t have permission to perform this action.</div>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-ui-text text-muted">
          <Link href="/test-and-tag" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>Test &amp; tag</Link>
          <span className="text-faint">/</span>
          <span className="text-ink">New item</span>
        </div>
        <div>
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">New test &amp; tag item</h1>
          <p className="mt-1 text-ui-text text-muted">Register a new item in the test &amp; tag registry.</p>
        </div>

        <SmartFormLayout
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          aside={
            <>
              <SmartFormRail eyebrow="New item" tip={helperTip} />
              <SmartFormPreview>
                <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                      <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className={cn("text-card-title font-semibold leading-tight", previewDesc ? "text-ink" : "text-faint")}>
                        {previewDesc || "New item"}
                      </p>
                      <p className={cn("t-mono text-caption", previewTag ? "text-muted" : "text-faint")}>
                        {previewTag || "No tag yet"}
                      </p>
                      <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                        {classLabel}
                      </span>
                      <p className={cn("text-caption", intervalMonths ? "text-muted" : "text-faint")}>
                        {intervalMonths
                          ? `Retest every ${intervalMonths} month${intervalMonths === 1 ? "" : "s"}`
                          : "No interval set"}
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
            <SmartFormSection title="Identity" hint="Link an asset to auto-fill, then confirm the tag." divider={false}>
              <div className="grid gap-5 sm:grid-cols-2">
                <SmartFormField label="Bulk asset" hint="For pooled items like leads or power boards.">
                  <ComboboxPicker
                    value={watchBulkAssetId || ""}
                    onChange={(val) => {
                      form.setValue("bulkAssetId", val);
                      if (val) {
                        // Clear serialized asset link — can't have both
                        form.setValue("assetId", "");
                        populateFromBulkAsset(val);
                      }
                    }}
                    options={(bulkAssetsQuery.data?.bulkAssets || []).map((a: { id: string; assetTag: string; model: { name: string } | null }) => ({
                      value: a.id,
                      label: `${a.assetTag} — ${a.model?.name ?? ""}`,
                    }))}
                    placeholder="None"
                    searchPlaceholder="Search bulk assets…"
                    emptyMessage="No bulk assets found."
                    allowClear
                  />
                </SmartFormField>
                <SmartFormField label="Serialized asset" hint="For individually tracked assets.">
                  <ComboboxPicker
                    value={watchAssetId || ""}
                    onChange={(val) => {
                      form.setValue("assetId", val);
                      if (val) {
                        // Clear bulk asset link
                        form.setValue("bulkAssetId", "");
                        const asset = (assetsQuery.data?.assets || []).find((a: { id: string }) => a.id === val) as {
                          id: string; assetTag: string; serialNumber?: string | null;
                          model?: {
                            name?: string; manufacturer?: string | null; modelNumber?: string | null;
                            defaultTestProfileId?: string | null;
                            defaultEquipmentClass?: string | null; defaultApplianceType?: string | null;
                          } | null;
                        } | undefined;
                        if (asset) {
                          form.setValue("testTagId", asset.assetTag);
                          const modelName = asset.model?.name || "";
                          const manufacturer = asset.model?.manufacturer || "";
                          form.setValue("description", `${manufacturer ? manufacturer + " " : ""}${modelName} (${asset.assetTag})`);
                          if (asset.model?.manufacturer) form.setValue("make", asset.model.manufacturer);
                          if (asset.model?.modelNumber) form.setValue("modelName", asset.model.modelNumber);
                          if (asset.serialNumber) form.setValue("serialNumber", asset.serialNumber);
                          if (asset.model?.defaultTestProfileId) {
                            form.setValue("testProfileId", asset.model.defaultTestProfileId);
                            const profile = activeProfiles.find(p => p.id === asset.model?.defaultTestProfileId);
                            if (profile) {
                              form.setValue("equipmentClass", profile.equipmentClass as TestTagAssetFormValues["equipmentClass"]);
                              form.setValue("applianceType", profile.applianceType as TestTagAssetFormValues["applianceType"]);
                            }
                          }
                        }
                      } else {
                        form.setValue("testTagId", peekQuery.data?.[0] || "");
                      }
                    }}
                    options={(assetsQuery.data?.assets || []).map((a: { id: string; assetTag: string; customName?: string | null }) => ({
                      value: a.id,
                      label: a.assetTag,
                      description: a.customName || undefined,
                    }))}
                    placeholder="None"
                    searchPlaceholder="Search assets…"
                    emptyMessage="No assets found."
                    allowClear
                  />
                </SmartFormField>
                <SmartFormField
                  label="Test tag ID"
                  required
                  hint={watchAssetId ? "Uses the linked asset's tag." : "Pre-filled from your next sequence — edit it or scan a label."}
                  error={form.formState.errors.testTagId?.message}
                >
                  <AssetTagInput
                    {...form.register("testTagId")}
                    placeholder={peekQuery.data?.[0] || "TT-0001"}
                    readOnly={!!watchAssetId}
                    className={cn("font-mono", watchAssetId && "bg-paper-2")}
                    aria-invalid={!!form.formState.errors.testTagId}
                  />
                </SmartFormField>
                <SmartFormField label="Serial number">
                  <Input {...form.register("serialNumber")} placeholder="Optional" />
                </SmartFormField>
                <div className="sm:col-span-2">
                  <SmartFormField label="Description" required error={form.formState.errors.description?.message}>
                    <Input
                      {...form.register("description")}
                      placeholder="e.g. Black IEC power cable 2m"
                      aria-invalid={!!form.formState.errors.description}
                    />
                  </SmartFormField>
                </div>
                <SmartFormField label="Make">
                  <Input {...form.register("make")} placeholder="Optional" />
                </SmartFormField>
                <SmartFormField label="Model">
                  <Input {...form.register("modelName")} placeholder="Optional" />
                </SmartFormField>
              </div>
            </SmartFormSection>

            {/* Test details */}
            <SmartFormSection title="Test details" hint="The profile sets class, type and required tests.">
              <div className="space-y-5">
                <SmartFormField
                  label="Test profile"
                  required
                  hint="Determines equipment class, appliance type and which tests are required."
                >
                  {activeProfiles.length > 0 ? (
                    <ComboboxPicker
                      value={watchProfileId || ""}
                      onChange={(val) => {
                        form.setValue("testProfileId", val);
                        const profile = activeProfiles.find(p => p.id === val);
                        if (profile) {
                          form.setValue("equipmentClass", profile.equipmentClass as TestTagAssetFormValues["equipmentClass"]);
                          form.setValue("applianceType", profile.applianceType as TestTagAssetFormValues["applianceType"]);
                        }
                      }}
                      options={activeProfiles.map(p => ({ value: p.id, label: p.name }))}
                      placeholder="Select a test profile…"
                      searchPlaceholder="Search profiles…"
                      emptyMessage="No profiles found."
                    />
                  ) : (
                    <p className="py-2 text-ui-text text-muted">
                      No test profiles configured.{" "}
                      <Link href="/settings/test-and-tag/profiles" className={cn("rounded-sm text-link hover:underline", focusRing)}>Set up profiles</Link>
                    </p>
                  )}
                </SmartFormField>

                <div className="grid gap-5 sm:grid-cols-2">
                  <SmartFormField label="Equipment class" hint={selectedProfile ? "Set by the test profile — override if needed." : undefined}>
                    <Controller control={form.control} name="equipmentClass" render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue>{equipmentClassLabels[field.value ?? "CLASS_I"] ?? "Class I"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {EQUIPMENT_CLASS_ORDER.map((c) => (
                            <SelectItem key={c} value={c}>{equipmentClassLabels[c]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                  </SmartFormField>
                  <SmartFormField label="Appliance type" hint={selectedProfile ? "Set by the test profile — override if needed." : undefined}>
                    <Controller control={form.control} name="applianceType" render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue>{applianceTypeLabels[field.value ?? "APPLIANCE"] ?? "Appliance"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {APPLIANCE_TYPE_ORDER.map((t) => (
                            <SelectItem key={t} value={t}>{applianceTypeLabels[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                  </SmartFormField>
                  <SmartFormField
                    label="Test interval (months)"
                    error={form.formState.errors.testIntervalMonths?.message}
                  >
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      {...form.register("testIntervalMonths")}
                      aria-invalid={!!form.formState.errors.testIntervalMonths}
                    />
                  </SmartFormField>
                  <SmartFormField label="Location">
                    <Input {...form.register("location")} placeholder="e.g. Warehouse A" />
                  </SmartFormField>
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
                      <SmartFormField label="Notes">
                        <Textarea {...form.register("notes")} placeholder="Optional notes about this item…" rows={3} />
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
              Create item
            </Button>
          </div>
        </SmartFormLayout>
      </div>
    </CanDo>
  );
}

export default function NewTestTagAssetPage() {
  return (
    <RequirePermission resource="testTag" action="create">
      <Suspense fallback={
        <div className="grid max-w-6xl gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <Skeleton className="h-5 w-48 rounded-[var(--r)]" />
            <Skeleton className="h-64 rounded-[var(--r)]" />
          </div>
          <Skeleton className="hidden h-48 rounded-[var(--r)] lg:block" />
        </div>
      }>
        <NewTestTagAssetInner />
      </Suspense>
    </RequirePermission>
  );
}
