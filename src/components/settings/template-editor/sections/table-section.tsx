"use client";

import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { DocumentType } from "@/lib/pdfme/types";
import { Label } from "@/components/ui/label";
import { SectionHeading, SectionDescription, SettingRow } from "./shared";

interface TableSectionProps {
  settings: TemplateSettings;
  templateType: DocumentType;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function TableSection({ settings, templateType, onSettingsChange }: TableSectionProps) {
  const update = (updates: Partial<TemplateSettings["table"]>) => {
    onSettingsChange({ table: { ...settings.table, ...updates } });
  };

  const showPricingOption = ["quote", "invoice"].includes(templateType);

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>Table</SectionHeading>
        <SectionDescription>
          Configure columns and display options for the equipment table.
        </SectionDescription>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-fg-3">Layout</Label>
        <div className="space-y-0.5">
          <SettingRow
            label="Group headers"
            description="Show kit/group names as section headers"
            checked={settings.table.showGroupHeaders}
            onCheckedChange={(v) => update({ showGroupHeaders: v })}
          />
          <SettingRow
            label="Kit children"
            description="Show individual items within kits"
            checked={settings.table.showKitChildren}
            onCheckedChange={(v) => update({ showKitChildren: v })}
          />
          <SettingRow
            label="Row numbers"
            checked={settings.table.showRowNumbers}
            onCheckedChange={(v) => update({ showRowNumbers: v })}
          />
        </div>
      </div>

      <div className="h-px bg-border/30" />

      <div className="space-y-1">
        <Label className="text-xs font-medium text-fg-3">Columns</Label>
        <div className="space-y-0.5">
          {showPricingOption && (
            <SettingRow
              label="Pricing columns"
              description="Unit price, duration, line total"
              checked={settings.table.showPricing}
              onCheckedChange={(v) => update({ showPricing: v })}
            />
          )}
          <SettingRow
            label="Asset tags"
            checked={settings.table.showAssetTags}
            onCheckedChange={(v) => update({ showAssetTags: v })}
          />
          <SettingRow
            label="Categories"
            checked={settings.table.showCategories}
            onCheckedChange={(v) => update({ showCategories: v })}
          />
          <SettingRow
            label="Status badges"
            checked={settings.table.showBadges}
            onCheckedChange={(v) => update({ showBadges: v })}
          />
          <SettingRow
            label="Item notes"
            checked={settings.table.showNotes}
            onCheckedChange={(v) => update({ showNotes: v })}
          />
        </div>
      </div>

      <div className="h-px bg-border/30" />

      <div className="space-y-1">
        <Label className="text-xs font-medium text-fg-3">Checkboxes</Label>
        <div className="space-y-0.5">
          <SettingRow
            label="Row checkboxes"
            description="Main checkbox per line item"
            checked={settings.table.showCheckboxes}
            onCheckedChange={(v) => update({ showCheckboxes: v })}
          />
          <SettingRow
            label="Per-unit checkboxes"
            description="Individual checkboxes for each unit in quantity"
            checked={settings.table.showPerUnitCheckboxes}
            onCheckedChange={(v) => update({ showPerUnitCheckboxes: v })}
          />
          <SettingRow
            label="Condition columns"
            description="Good / Damaged / Missing columns"
            checked={settings.table.showConditionColumns}
            onCheckedChange={(v) => update({ showConditionColumns: v })}
          />
        </div>
      </div>
    </div>
  );
}
