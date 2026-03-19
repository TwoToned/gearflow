"use client";

import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { DocumentType } from "@/lib/pdfme/types";
import { Label } from "@/components/ui/label";
import { SectionHeading, SectionDescription, SettingRow } from "./shared";

interface DetailsSectionProps {
  settings: TemplateSettings;
  templateType: DocumentType;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function DetailsSection({ settings, templateType, onSettingsChange }: DetailsSectionProps) {
  const update = (updates: Partial<TemplateSettings["details"]>) => {
    onSettingsChange({ details: { ...settings.details, ...updates } });
  };

  const isCallSheet = templateType === "call-sheet";
  const isDelivery = templateType === "delivery-docket";

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>Transaction Details</SectionHeading>
        <SectionDescription>
          Choose which client and project fields appear on the document.
        </SectionDescription>
      </div>

      {/* Client Fields */}
      {!isCallSheet && !isDelivery && (
        <>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-fg-3">Client Information</Label>
            <div className="space-y-0.5">
              <SettingRow
                label="Client name"
                checked={settings.details.showClientName}
                onCheckedChange={(v) => update({ showClientName: v })}
              />
              <SettingRow
                label="Contact person"
                checked={settings.details.showClientContact}
                onCheckedChange={(v) => update({ showClientContact: v })}
              />
              <SettingRow
                label="Email address"
                checked={settings.details.showClientEmail}
                onCheckedChange={(v) => update({ showClientEmail: v })}
              />
              <SettingRow
                label="Billing address"
                checked={settings.details.showClientAddress}
                onCheckedChange={(v) => update({ showClientAddress: v })}
              />
              <SettingRow
                label="Tax ID / ABN"
                checked={settings.details.showClientTaxId}
                onCheckedChange={(v) => update({ showClientTaxId: v })}
              />
            </div>
          </div>

          <div className="h-px bg-border/30" />
        </>
      )}

      {/* Project Fields */}
      <div className="space-y-1">
        <Label className="text-xs font-medium text-fg-3">Project Information</Label>
        <div className="space-y-0.5">
          <SettingRow
            label="Project name"
            checked={settings.details.showProjectName}
            onCheckedChange={(v) => update({ showProjectName: v })}
          />
          <SettingRow
            label="Project number"
            checked={settings.details.showProjectNumber}
            onCheckedChange={(v) => update({ showProjectNumber: v })}
          />
          <SettingRow
            label="Venue"
            checked={settings.details.showVenue}
            onCheckedChange={(v) => update({ showVenue: v })}
          />
          <SettingRow
            label="Rental dates"
            checked={settings.details.showRentalDates}
            onCheckedChange={(v) => update({ showRentalDates: v })}
          />
          <SettingRow
            label="Event dates"
            checked={settings.details.showEventDates}
            onCheckedChange={(v) => update({ showEventDates: v })}
          />
          <SettingRow
            label="Document date"
            checked={settings.details.showDocumentDate}
            onCheckedChange={(v) => update({ showDocumentDate: v })}
          />
          <SettingRow
            label="Payment terms"
            checked={settings.details.showPaymentTerms}
            onCheckedChange={(v) => update({ showPaymentTerms: v })}
          />
          <SettingRow
            label="Site contact"
            checked={settings.details.showSiteContact}
            onCheckedChange={(v) => update({ showSiteContact: v })}
          />
        </div>
      </div>
    </div>
  );
}
