"use client";

import * as React from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { toast } from "sonner";

import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartFormField, SmartFormSection } from "@/components/ui/smart-form";
import { Textarea } from "@/components/ui/textarea";
import { useServerQuery } from "@/hooks/use-server-query";
import { useTestProfiles } from "@/hooks/use-test-profiles";
import { useTestTagWrites } from "@/hooks/use-test-tag-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { applianceTypeLabels, equipmentClassLabels } from "@/lib/status-labels";
import { buildTestTagEdit, testTagSheetError, type TestTagSheetInitial, type TestTagSheetValues } from "@/lib/test-tag-sheet";
import { api } from "../../../convex/_generated/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TestTagSheetInitial;
}

function valuesOf(item: TestTagSheetInitial): TestTagSheetValues {
  const { id: _id, testTagId: _tag, ...values } = item;
  void _id; void _tag;
  return values;
}

/** A Select over a label table. */
function LabelSelect({ label, value, labels, onChange }: { label: string; value: string; labels: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}><SelectValue>{labels[value] ?? value}</SelectValue></SelectTrigger>
      <SelectContent>{Object.entries(labels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/**
 * The Test & tag Edit sheet (UX Phase 14, 14b-4, D80): the item's own fields on `FormSheet`. There is NO status field
 * (it moves only through a test, Retire and Reactivate), the tag id is not editable, and next due is derived: changing
 * the interval is what moves it. A blank optional box CLEARS its field; one link at a time (an asset or a bulk asset).
 * A save toasts with the exact Undo of its own audit id; one that changed nothing says so and offers none.
 */
export function TestTagSheet({ open, onOpenChange, item }: Props) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const writes = useTestTagWrites();
  const profiles = (useTestProfiles(orgId) ?? []).filter((p) => p.isActive);
  const enabled = open && !!orgId && isAuthenticated;
  const assets = useServerQuery({ queryKey: ["tt-sheet-assets", orgId], queryFn: () => convex.query(api.assets.listPage, { orgId: orgId!, pageSize: 500 }), enabled });
  const bulk = useServerQuery({ queryKey: ["tt-sheet-bulk", orgId], queryFn: () => convex.query(api.bulkAssets.listPage, { orgId: orgId!, pageSize: 500 }), enabled });
  const [values, setValues] = React.useState<TestTagSheetValues>(() => valuesOf(item));
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setValues(valuesOf(item));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens or its target changes
  }, [open, item.id]);

  const set = <K extends keyof TestTagSheetValues>(k: K, v: TestTagSheetValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };
  /** Choosing one link clears the other. */
  const link = (k: "assetId" | "bulkAssetId", v: string) => {
    setValues((prev) => ({ ...prev, assetId: k === "assetId" ? v : v ? "" : prev.assetId, bulkAssetId: k === "bulkAssetId" ? v : v ? "" : prev.bulkAssetId }));
    setDirty(true);
  };

  const assetOptions = ((assets.data as { assets?: { id: string; assetTag: string; model?: { name?: string } | null }[] } | undefined)?.assets ?? []).map((a) => ({ value: a.id, label: `${a.assetTag}${a.model?.name ? ` — ${a.model.name}` : ""}` }));
  const bulkOptions = ((bulk.data as { bulkAssets?: { id: string; assetTag: string; model?: { name?: string } | null }[] } | undefined)?.bulkAssets ?? []).map((a) => ({ value: a.id, label: `${a.assetTag}${a.model?.name ? ` — ${a.model.name}` : ""}` }));

  const submit = async () => {
    const problem = testTagSheetError(values);
    if (problem) return void toast.error(problem);
    setSaving(true);
    try {
      const r = await writes.edit(item.id, buildTestTagEdit(values));
      if (!r.changed) toast("Nothing changed");
      else announceListWrite({ title: `Updated ${item.testTagId}`, undoneTitle: "Change undone", performUndo: async () => void (await writes.undoEdit(item.id, r.auditId)) });
      onOpenChange(false);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the item" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={`Edit ${item.testTagId}`} primaryLabel="Save" onSubmit={submit} submitting={saving} dirty={dirty}>
      <div className="space-y-6">
        <SmartFormSection title="Identity" hint="What it is. The tag id and status are not edited here." divider={false}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Description" required><Input value={values.description} onChange={(e) => set("description", e.target.value)} aria-label="Description" /></SmartFormField>
            </div>
            <SmartFormField label="Equipment class"><LabelSelect label="Equipment class" value={values.equipmentClass} labels={equipmentClassLabels} onChange={(v) => set("equipmentClass", v)} /></SmartFormField>
            <SmartFormField label="Appliance type"><LabelSelect label="Appliance type" value={values.applianceType} labels={applianceTypeLabels} onChange={(v) => set("applianceType", v)} /></SmartFormField>
            <SmartFormField label="Make"><Input value={values.make} onChange={(e) => set("make", e.target.value)} aria-label="Make" /></SmartFormField>
            <SmartFormField label="Model"><Input value={values.modelName} onChange={(e) => set("modelName", e.target.value)} aria-label="Model" /></SmartFormField>
            <SmartFormField label="Serial number"><Input value={values.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} aria-label="Serial number" /></SmartFormField>
            <SmartFormField label="Location"><Input value={values.location} onChange={(e) => set("location", e.target.value)} aria-label="Location" /></SmartFormField>
          </div>
        </SmartFormSection>

        <SmartFormSection title="Testing" hint="Next due is the last test plus the interval; it moves when the interval does.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SmartFormField label="Test interval (months)" required>
              <Input type="number" min={1} max={120} step={1} value={values.testIntervalMonths} onChange={(e) => set("testIntervalMonths", e.target.value)} aria-label="Test interval" />
            </SmartFormField>
            <SmartFormField label="Outlets" hint="Power boards and RCD boards.">
              <Input type="number" min={1} max={50} step={1} value={values.outletCount} onChange={(e) => set("outletCount", e.target.value)} aria-label="Outlets" />
            </SmartFormField>
            <div className="sm:col-span-2">
              <SmartFormField label="Test profile">
                <ComboboxPicker
                  value={values.testProfileId}
                  onChange={(val) => set("testProfileId", val || "")}
                  options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                  placeholder="No profile" searchPlaceholder="Search profiles…" emptyMessage="No profiles found." allowClear
                />
              </SmartFormField>
            </div>
          </div>
        </SmartFormSection>

        <SmartFormSection title="Link" hint="Tie it to an asset, or to a pooled bulk asset (one or the other).">
          <div className="grid gap-4 sm:grid-cols-2">
            <SmartFormField label="Serialised asset">
              <ComboboxPicker value={values.assetId} onChange={(val) => link("assetId", val || "")} options={assetOptions} placeholder="None" searchPlaceholder="Search assets…" emptyMessage="No assets found." allowClear />
            </SmartFormField>
            <SmartFormField label="Bulk asset">
              <ComboboxPicker value={values.bulkAssetId} onChange={(val) => link("bulkAssetId", val || "")} options={bulkOptions} placeholder="None" searchPlaceholder="Search bulk assets…" emptyMessage="No bulk assets found." allowClear />
            </SmartFormField>
          </div>
        </SmartFormSection>

        <SmartFormField label="Notes"><Textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={3} aria-label="Notes" /></SmartFormField>
      </div>
    </FormSheet>
  );
}
