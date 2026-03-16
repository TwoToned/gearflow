"use client";

import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading, SectionDescription, SettingRow } from "./shared";

interface HeaderFooterSectionProps {
  settings: TemplateSettings;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function HeaderFooterSection({ settings, onSettingsChange }: HeaderFooterSectionProps) {
  const updateHeader = (updates: Partial<TemplateSettings["header"]>) => {
    onSettingsChange({ header: { ...settings.header, ...updates } });
  };
  const updateFooter = (updates: Partial<TemplateSettings["footer"]>) => {
    onSettingsChange({ footer: { ...settings.footer, ...updates } });
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div>
        <SectionHeading>Header</SectionHeading>
        <SectionDescription>
          Configure the document header with your branding.
        </SectionDescription>
      </div>

      <div className="space-y-4">
        {/* Document title */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Document Title</Label>
          <Input
            value={settings.header.documentTitle}
            onChange={(e) => updateHeader({ documentTitle: e.target.value })}
            placeholder="e.g. QUOTE"
            className="h-9 text-xs"
          />
        </div>

        {/* Logo mode */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Logo Display</Label>
          <Select
            value={settings.header.logoMode}
            onValueChange={(v) => v && updateHeader({ logoMode: v as "logo" | "icon" | "none" })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="logo">Full Logo</SelectItem>
              <SelectItem value="icon">Icon Only</SelectItem>
              <SelectItem value="none">No Logo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Org detail toggles */}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Organisation Details</Label>
          <div className="space-y-0.5">
            <SettingRow
              label="Show organisation name"
              checked={settings.header.showOrgName}
              onCheckedChange={(v) => updateHeader({ showOrgName: v })}
            />
            <SettingRow
              label="Show address"
              checked={settings.header.showOrgAddress}
              onCheckedChange={(v) => updateHeader({ showOrgAddress: v })}
            />
            <SettingRow
              label="Show phone"
              checked={settings.header.showOrgPhone}
              onCheckedChange={(v) => updateHeader({ showOrgPhone: v })}
            />
            <SettingRow
              label="Show email"
              checked={settings.header.showOrgEmail}
              onCheckedChange={(v) => updateHeader({ showOrgEmail: v })}
            />
            <SettingRow
              label="Show website"
              checked={settings.header.showOrgWebsite}
              onCheckedChange={(v) => updateHeader({ showOrgWebsite: v })}
            />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border/50" />

      {/* Footer Section */}
      <div>
        <SectionHeading>Footer</SectionHeading>
        <SectionDescription>
          Text shown at the bottom of each page.
        </SectionDescription>
      </div>

      <div className="space-y-4">
        <SettingRow
          label="Show footer"
          checked={settings.footer.showFooter}
          onCheckedChange={(v) => updateFooter({ showFooter: v })}
        />

        {settings.footer.showFooter && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Primary Text</Label>
              <Input
                value={settings.footer.primaryText}
                onChange={(e) => updateFooter({ primaryText: e.target.value })}
                placeholder="Auto: Org Name | Email | Phone"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Secondary Text</Label>
              <Input
                value={settings.footer.secondaryText}
                onChange={(e) => updateFooter({ secondaryText: e.target.value })}
                placeholder="Optional"
                className="h-9 text-xs"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
