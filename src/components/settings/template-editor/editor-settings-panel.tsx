"use client";

import type { EditorSection } from "./template-editor";
import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { DocumentType } from "@/lib/pdfme/types";
import { GeneralSection } from "./sections/general-section";
import { HeaderFooterSection } from "./sections/header-footer-section";
import { DetailsSection } from "./sections/details-section";
import { TableSection } from "./sections/table-section";
import { TotalsSection } from "./sections/totals-section";
import { OtherSection } from "./sections/other-section";

interface EditorSettingsPanelProps {
  section: EditorSection;
  settings: TemplateSettings;
  templateType: DocumentType;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function EditorSettingsPanel({
  section,
  settings,
  templateType,
  onSettingsChange,
}: EditorSettingsPanelProps) {
  return (
    <div className="w-[340px] shrink-0 overflow-y-auto border-r border-border/50 bg-card">
      <div className="p-5">
        {section === "general" && (
          <GeneralSection
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}
        {section === "header-footer" && (
          <HeaderFooterSection
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}
        {section === "details" && (
          <DetailsSection
            settings={settings}
            templateType={templateType}
            onSettingsChange={onSettingsChange}
          />
        )}
        {section === "table" && (
          <TableSection
            settings={settings}
            templateType={templateType}
            onSettingsChange={onSettingsChange}
          />
        )}
        {section === "totals" && (
          <TotalsSection
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}
        {section === "other" && (
          <OtherSection
            settings={settings}
            templateType={templateType}
            onSettingsChange={onSettingsChange}
          />
        )}
      </div>
    </div>
  );
}
