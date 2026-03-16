"use client";

import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { DocumentType } from "@/lib/pdfme/types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SectionHeading, SectionDescription, SettingRow } from "./shared";

interface OtherSectionProps {
  settings: TemplateSettings;
  templateType: DocumentType;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function OtherSection({ settings, templateType, onSettingsChange }: OtherSectionProps) {
  const update = (updates: Partial<TemplateSettings["other"]>) => {
    onSettingsChange({ other: { ...settings.other, ...updates } });
  };

  const showCrew = templateType === "call-sheet";

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>Other Details</SectionHeading>
        <SectionDescription>
          Notes, signatures, and additional content.
        </SectionDescription>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
        <div className="space-y-0.5">
          <SettingRow
            label="Client notes"
            description="Notes visible to the client"
            checked={settings.other.showClientNotes}
            onCheckedChange={(v) => update({ showClientNotes: v })}
          />
          {showCrew && (
            <SettingRow
              label="Crew notes"
              description="Internal notes for the crew"
              checked={settings.other.showCrewNotes}
              onCheckedChange={(v) => update({ showCrewNotes: v })}
            />
          )}
        </div>
      </div>

      <div className="h-px bg-border/30" />

      <div className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Signatures</Label>
          <SettingRow
            label="Signature section"
            description="Add signature lines at the bottom"
            checked={settings.other.showSignatureSection}
            onCheckedChange={(v) => update({ showSignatureSection: v })}
          />
        </div>

        {settings.other.showSignatureSection && (
          <div className="ml-3 border-l-2 border-border/30 pl-3 space-y-1.5">
            <Label className="text-xs font-medium">Number of signature columns</Label>
            <Input
              type="number"
              min={1}
              max={4}
              value={settings.other.signatureColumns}
              onChange={(e) => update({ signatureColumns: parseInt(e.target.value) || 2 })}
              className="h-9 w-20 text-xs"
            />
          </div>
        )}
      </div>

      <div className="h-px bg-border/30" />

      <SettingRow
        label="Summary line"
        description="Total items count and weight"
        checked={settings.other.showSummaryLine}
        onCheckedChange={(v) => update({ showSummaryLine: v })}
      />
    </div>
  );
}
