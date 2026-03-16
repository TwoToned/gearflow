"use client";

import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import { SectionHeading, SectionDescription, SettingRow } from "./shared";

interface TotalsSectionProps {
  settings: TemplateSettings;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function TotalsSection({ settings, onSettingsChange }: TotalsSectionProps) {
  const update = (updates: Partial<TemplateSettings["totals"]>) => {
    onSettingsChange({ totals: { ...settings.totals, ...updates } });
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>Totals</SectionHeading>
        <SectionDescription>
          Control which financial summary lines are displayed.
        </SectionDescription>
      </div>

      <div className="space-y-0.5">
        <SettingRow
          label="Show totals section"
          description="Show the financial summary block"
          checked={settings.totals.showTotals}
          onCheckedChange={(v) => update({ showTotals: v })}
        />

        {settings.totals.showTotals && (
          <>
            <div className="ml-3 border-l-2 border-border/30 pl-3 space-y-0.5">
              <SettingRow
                label="Subtotal"
                checked={settings.totals.showSubtotal}
                onCheckedChange={(v) => update({ showSubtotal: v })}
              />
              <SettingRow
                label="Discount"
                checked={settings.totals.showDiscount}
                onCheckedChange={(v) => update({ showDiscount: v })}
              />
              <SettingRow
                label="Tax"
                checked={settings.totals.showTax}
                onCheckedChange={(v) => update({ showTax: v })}
              />
              <SettingRow
                label="Total"
                checked={settings.totals.showTotal}
                onCheckedChange={(v) => update({ showTotal: v })}
              />
              <SettingRow
                label="Deposit paid"
                checked={settings.totals.showDeposit}
                onCheckedChange={(v) => update({ showDeposit: v })}
              />
              <SettingRow
                label="Balance due"
                checked={settings.totals.showBalance}
                onCheckedChange={(v) => update({ showBalance: v })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
