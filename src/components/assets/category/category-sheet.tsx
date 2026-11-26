"use client";

import * as React from "react";
import { toast } from "sonner";

import { XeroAccountCodeField } from "@/components/settings/xero-coding-fields";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartFormField, SmartFormSection } from "@/components/ui/smart-form";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useCategoryWrites } from "@/hooks/use-category-writes";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { buildCategoryEdit, categorySheetError, type CategorySheetInitial, type CategorySheetValues } from "@/lib/category-sheet";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { equipmentClassLabels } from "@/lib/status-labels";

const NO_CLASS = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategorySheetInitial;
  /** The ids of this category and everything below it: none of them may be its parent. */
  excludedParentIds: string[];
}

function valuesOf(c: CategorySheetInitial): CategorySheetValues {
  const { id: _id, ...values } = c;
  void _id;
  return values;
}

/**
 * The Category Edit sheet (UX Phase 14, 14b-5, D77): the category's own fields on `FormSheet`, including the optional
 * default Test & tag class and interval that its OWN models inherit unless a model sets its own. A save sends only what
 * changed against the values the sheet opened with, toasts with the exact Undo of its own audit id, and one that changed
 * nothing says so and offers none. The parent can't be the category itself or anything below it.
 */
export function CategorySheet({ open, onOpenChange, category, excludedParentIds }: Props) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useCategoryWrites();
  const categories = useCategoriesWithParent(orgId) ?? [];
  const orgTags = useOrgTags(orgId);
  const [values, setValues] = React.useState<CategorySheetValues>(() => valuesOf(category));
  // What the sheet OPENED with: a save sends only what changed against it, so a newer edit by someone else is never reverted.
  const [opened, setOpened] = React.useState<CategorySheetValues>(() => valuesOf(category));
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setValues(valuesOf(category));
    setOpened(valuesOf(category));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens or its target changes
  }, [open, category.id]);

  const set = <K extends keyof CategorySheetValues>(k: K, v: CategorySheetValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const parentOptions = categories
    .filter((c) => !excludedParentIds.includes(c.id))
    .map((c) => ({ value: c.id, label: c.parent ? `${c.parent.name} → ${c.name}` : c.name }));

  const submit = async () => {
    const problem = categorySheetError(values, category.id);
    if (problem) return void toast.error(problem);
    setSaving(true);
    try {
      const r = await writes.edit(category.id, buildCategoryEdit(values, opened));
      if (!r.changed) toast("Nothing changed");
      else announceListWrite({ title: `Updated ${values.name.trim()}`, undoneTitle: "Change undone", performUndo: async () => void (await writes.undoEdit(category.id, r.auditId)) });
      onOpenChange(false);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the category" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={`Edit ${category.name}`} primaryLabel="Save" onSubmit={submit} submitting={saving} dirty={dirty}>
      <div className="space-y-6">
        <SmartFormSection title="Identity" hint="What it is called and where it sits." divider={false}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Name" required><Input value={values.name} onChange={(e) => set("name", e.target.value)} aria-label="Name" /></SmartFormField>
            </div>
            <SmartFormField label="Parent category">
              <ComboboxPicker value={values.parentId} onChange={(val) => set("parentId", val || "")} options={parentOptions} placeholder="Top level" searchPlaceholder="Search categories…" emptyMessage="No categories found." allowClear />
            </SmartFormField>
            <SmartFormField label="Icon" hint="A short emoji or symbol."><Input value={values.icon} onChange={(e) => set("icon", e.target.value)} aria-label="Icon" maxLength={10} /></SmartFormField>
            <div className="sm:col-span-2">
              <SmartFormField label="Description"><Textarea value={values.description} onChange={(e) => set("description", e.target.value)} rows={2} aria-label="Description" /></SmartFormField>
            </div>
          </div>
        </SmartFormSection>

        <SmartFormSection title="Test & tag defaults" hint="The class and interval its own models take when they set none of their own. Subcategories do not inherit them.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SmartFormField label="Equipment class">
              <Select value={values.defaultEquipmentClass || NO_CLASS} onValueChange={(v) => set("defaultEquipmentClass", v === NO_CLASS ? "" : v)}>
                <SelectTrigger aria-label="Equipment class"><SelectValue>{values.defaultEquipmentClass ? equipmentClassLabels[values.defaultEquipmentClass] ?? values.defaultEquipmentClass : "No default"}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLASS}>No default</SelectItem>
                  {Object.entries(equipmentClassLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </SmartFormField>
            <SmartFormField label="Test interval (months)" hint="Blank means no default.">
              <Input type="number" min={1} max={120} step={1} value={values.defaultTestIntervalMonths} onChange={(e) => set("defaultTestIntervalMonths", e.target.value)} aria-label="Test interval" />
            </SmartFormField>
          </div>
        </SmartFormSection>

        <details open className="border-t border-line pt-4">
          <summary className="cursor-pointer text-ui-text font-medium text-ink">More details</summary>
          <div className="space-y-4 pt-3">
            <SmartFormField label="Tags"><TagInput value={values.tags} onChange={(t) => set("tags", t)} suggestions={orgTags} placeholder="Add tags…" /></SmartFormField>
            <XeroAccountCodeField value={values.xeroAccountCode} onChange={(code) => set("xeroAccountCode", code)} label="Xero account" placeholder="No category default" />
          </div>
        </details>
      </div>
    </FormSheet>
  );
}
