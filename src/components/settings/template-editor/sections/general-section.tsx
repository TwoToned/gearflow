"use client";

import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SectionHeading, SectionDescription } from "./shared";

interface GeneralSectionProps {
  settings: TemplateSettings;
  onSettingsChange: (updates: Partial<TemplateSettings>) => void;
}

export function GeneralSection({ settings, onSettingsChange }: GeneralSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>General</SectionHeading>
        <SectionDescription>
          Global appearance settings for your document.
        </SectionDescription>
      </div>

      {/* Accent Color */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Accent Colour</Label>
        <p className="text-[11px] text-fg-3 leading-relaxed">
          Used for headers, lines, and highlighted elements. Leave empty to use your organisation&apos;s brand colour.
        </p>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="color"
              value={settings.accentColor || "#0d4f4f"}
              onChange={(e) => onSettingsChange({ accentColor: e.target.value })}
              className="h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            />
          </div>
          <Input
            value={settings.accentColor}
            onChange={(e) => onSettingsChange({ accentColor: e.target.value })}
            placeholder="Organisation default"
            className="h-9 flex-1 text-xs font-mono"
          />
          {settings.accentColor && (
            <button
              onClick={() => onSettingsChange({ accentColor: "" })}
              className="text-[11px] text-fg-3 hover:text-fg underline"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
