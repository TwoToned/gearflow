"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { testTagAssetSchema, type TestTagAssetFormValues } from "@/lib/validations/test-tag";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { createTestTagAsset, peekNextTestTagIds } from "@/server/test-tag-assets";
import { getAssets } from "@/server/assets";
import { getBulkAssets } from "@/server/bulk-assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";

const equipmentClassOptions = [
  { value: "CLASS_I", label: "Class I" },
  { value: "CLASS_II", label: "Class II" },
  { value: "CLASS_II_DOUBLE_INSULATED", label: "Class II (Double Insulated)" },
  { value: "LEAD_CORD_ASSEMBLY", label: "Lead / Cord Assembly" },
];

const applianceTypeOptions = [
  { value: "APPLIANCE", label: "Appliance" },
  { value: "CORD_SET", label: "Cord Set" },
  { value: "EXTENSION_LEAD", label: "Extension Lead" },
  { value: "POWER_BOARD", label: "Power Board" },
  { value: "RCD_PORTABLE", label: "RCD (Portable)" },
  { value: "RCD_FIXED", label: "RCD (Fixed)" },
  { value: "THREE_PHASE", label: "Three Phase" },
  { value: "OTHER", label: "Other" },
];

function NewTestTagAssetInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedAssetId = searchParams.get("assetId") || "";
  const preselectedBulkAssetId = searchParams.get("bulkAssetId") || "";
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

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

  const peekQuery = useQuery({
    queryKey: ["peek-test-tag-ids", orgId],
    queryFn: () => peekNextTestTagIds(1),
  });

  const assetsQuery = useQuery({
    queryKey: ["assets", orgId, { pageSize: 500 }],
    queryFn: () => getAssets({ pageSize: 500 }),
  });

  const bulkAssetsQuery = useQuery({
    queryKey: ["bulk-assets", orgId, { pageSize: 500 }],
    queryFn: () => getBulkAssets({ pageSize: 500 }),
  });

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
        testAndTagIntervalDays: number | null;
      };
      location?: { name: string } | null;
    }[]).find((b) => b.id === bulkId);
    if (!ba) return;

    const model = ba.model;
    form.setValue("description", `${model.manufacturer ? model.manufacturer + " " : ""}${model.name}`);
    if (model.manufacturer) form.setValue("make", model.manufacturer);
    if (model.modelNumber) form.setValue("modelName", model.modelNumber);
    if (model.defaultEquipmentClass) {
      form.setValue("equipmentClass", model.defaultEquipmentClass as TestTagAssetFormValues["equipmentClass"]);
    }
    if (model.defaultApplianceType) {
      form.setValue("applianceType", model.defaultApplianceType as TestTagAssetFormValues["applianceType"]);
    }
    if (model.testAndTagIntervalDays) {
      form.setValue("testIntervalMonths", Math.max(1, Math.round(model.testAndTagIntervalDays / 30)));
    }
    if (ba.location?.name) form.setValue("location", ba.location.name);
  }

  const watchBulkAssetId = form.watch("bulkAssetId");
  const watchAssetId = form.watch("assetId");

  const mutation = useMutation({
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
      }),
    onSuccess: (result) => {
      toast.success("Test tag asset created");
      router.push(`/test-and-tag/${result.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <CanDo resource="testTag" action="create" fallback={<div className="p-8 text-center text-fg-3">You don&apos;t have permission to perform this action.</div>}>
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="t-title text-fg">New Test & Tag Item</h1>
        <p className="text-fg-3">
          Register a new item in the Test & Tag registry.
        </p>
      </div>

      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        {/* Asset Link — first section so user chooses the source before filling details */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">Link to Asset</h3>
          <div className="space-y-4">
            <p className="text-sm text-fg-3">
              Optionally link this T&T item to an existing asset. Fields will be auto-populated from the linked asset&apos;s model.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Bulk Asset</Label>
                <ComboboxPicker
                  value={watchBulkAssetId || ""}
                  onChange={(v) => {
                    form.setValue("bulkAssetId", v);
                    if (v) {
                      // Clear serialized asset link — can't have both
                      form.setValue("assetId", "");
                      populateFromBulkAsset(v);
                    }
                  }}
                  options={(bulkAssetsQuery.data?.bulkAssets || []).map((a: { id: string; assetTag: string; model: { name: string } }) => ({
                    value: a.id,
                    label: `${a.assetTag} - ${a.model.name}`,
                  }))}
                  placeholder="None"
                  searchPlaceholder="Search bulk assets..."
                  allowClear
                />
                <p className="text-xs text-fg-3">
                  For items like extension leads or power boards from a bulk pool
                </p>
              </div>
              <div className="space-y-2">
                <Label>Serialized Asset</Label>
                <ComboboxPicker
                  value={watchAssetId || ""}
                  onChange={(v) => {
                    form.setValue("assetId", v);
                    if (v) {
                      // Clear bulk asset link
                      form.setValue("bulkAssetId", "");
                      const asset = (assetsQuery.data?.assets || []).find((a: { id: string }) => a.id === v) as {
                        id: string; assetTag: string; serialNumber?: string | null;
                        model?: { name?: string; manufacturer?: string | null; modelNumber?: string | null } | null;
                      } | undefined;
                      if (asset) {
                        form.setValue("testTagId", asset.assetTag);
                        const modelName = asset.model?.name || "";
                        const manufacturer = asset.model?.manufacturer || "";
                        form.setValue("description", `${manufacturer ? manufacturer + " " : ""}${modelName} (${asset.assetTag})`);
                        if (asset.model?.manufacturer) form.setValue("make", asset.model.manufacturer);
                        if (asset.model?.modelNumber) form.setValue("modelName", asset.model.modelNumber);
                        if (asset.serialNumber) form.setValue("serialNumber", asset.serialNumber);
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
                  searchPlaceholder="Search assets..."
                  allowClear
                />
                <p className="text-xs text-fg-3">
                  For individually tracked serialized assets
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Identification */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">Identification</h3>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="testTagId">Test Tag ID *</Label>
                <ScanInput
                  id="testTagId"
                  {...form.register("testTagId")}
                  onScan={(v) => form.setValue("testTagId", v)}
                  scannerTitle="Scan test tag"
                  placeholder={peekQuery.data?.[0] || "TT-0001"}
                  readOnly={!!watchAssetId}
                  showScanButton={!watchAssetId}
                  className={watchAssetId ? "bg-bg-inset" : ""}
                />
                {watchAssetId && (
                  <p className="text-xs text-fg-3">Uses the linked asset&apos;s tag</p>
                )}
                {form.formState.errors.testTagId && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.testTagId.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="serialNumber">Serial Number</Label>
                <Input
                  id="serialNumber"
                  {...form.register("serialNumber")}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                {...form.register("description")}
                placeholder="e.g. Black IEC power cable 2m"
              />
              {form.formState.errors.description && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.description.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Make</Label>
                <Input {...form.register("make")} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input {...form.register("modelName")} placeholder="Optional" />
              </div>
            </div>
          </div>
        </div>

        {/* Classification */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">Classification</h3>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Equipment Class</Label>
                <Select
                  value={form.watch("equipmentClass")}
                  onValueChange={(v) => v && form.setValue("equipmentClass", v as TestTagAssetFormValues["equipmentClass"])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {equipmentClassOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Appliance Type</Label>
                <Select
                  value={form.watch("applianceType")}
                  onValueChange={(v) => v && form.setValue("applianceType", v as TestTagAssetFormValues["applianceType"])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {applianceTypeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="testIntervalMonths">Test Interval (months)</Label>
                <Input
                  id="testIntervalMonths"
                  type="number"
                  min={1}
                  max={120}
                  {...form.register("testIntervalMonths")}
                />
                {form.formState.errors.testIntervalMonths && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.testIntervalMonths.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  {...form.register("location")}
                  placeholder="e.g. Warehouse A"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg mb-4">Notes</h3>
            <Textarea
              {...form.register("notes")}
              placeholder="Optional notes about this item..."
              rows={3}
            />
        </div>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Item
          </Button>
        </div>
      </form>
    </div>
    </CanDo>
  );
}

export default function NewTestTagAssetPage() {
  return (
    <RequirePermission resource="testTag" action="create">
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-fg-3" /></div>}>
      <NewTestTagAssetInner />
    </Suspense>
    </RequirePermission>
  );
}
