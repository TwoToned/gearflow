"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  SECTION_TYPE_LABELS,
  type TemplateSection,
  type SectionType,
  type HeaderSectionSettings,
  type ClientDetailsSectionSettings,
  type ProjectDetailsSectionSettings,
  type TableSectionSettings,
  type TotalsSectionSettings,
  type NotesSectionSettings,
  type SignatureSectionSettings,
  type CustomTextSectionSettings,
  type CrewTableSectionSettings,
  type CallSheetInfoSectionSettings,
  type DayHeaderSectionSettings,
  type SpacerSectionSettings,
  type SectionSettings,
  type SectionVisibility,
  type SectionStyling,
  type CustomField,
  type BlockStyling,
} from "@/lib/pdfme/section-types";
import { getAllowedConditionFields } from "@/lib/pdfme/condition-evaluator";

interface SectionSettingsPanelProps {
  section: TemplateSection | null;
  onUpdate: (sectionId: string, updates: Partial<TemplateSection>) => void;
  /** Block styling for the selected section (from TemplateBlock.styling) */
  blockStyling?: BlockStyling;
  /** Called when block styling changes */
  onUpdateBlockStyling?: (sectionId: string, styling: BlockStyling | undefined) => void;
}

export function SectionSettingsPanel({ section, onUpdate, blockStyling, onUpdateBlockStyling }: SectionSettingsPanelProps) {
  if (!section) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-fg-3">Select a section to edit its settings</p>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateSettings = (updates: Record<string, any>) => {
    onUpdate(section.id, {
      settings: { ...section.settings, ...updates } as SectionSettings,
    });
  };

  const updateVisibility = (updates: Partial<SectionVisibility>) => {
    onUpdate(section.id, {
      visibility: { ...section.visibility, ...updates },
    });
  };

  // Sections that support extra content (custom text appended)
  const supportsContent = section.type !== "custom-text" && section.type !== "page-break" && section.type !== "spacer";

  return (
    <div className="flex flex-col gap-0 h-full overflow-y-auto">
      {/* Section header */}
      <div className="px-4 py-3 border-b border-border/30">
        <h3 className="text-sm font-semibold text-fg">
          {SECTION_TYPE_LABELS[section.type]}
        </h3>
        <p className="text-[11px] text-fg-3 mt-0.5">
          Configure what this section displays
        </p>
      </div>

      {/* Type-specific settings */}
      <div className="px-4 py-3 space-y-3">
        <SettingsForType
          type={section.type}
          settings={section.settings}
          content={section.content}
          onUpdateSettings={updateSettings}
          onUpdateContent={(content) => onUpdate(section.id, { content })}
        />
      </div>

      {/* Extra content — available on any section (except custom-text which uses it as primary) */}
      {supportsContent && (
        <>
          <Separator className="opacity-50" />
          <div className="px-4 py-3 space-y-2">
            <h4 className="text-xs font-semibold text-fg-3 uppercase tracking-wider">
              Extra Text
            </h4>
            <Textarea
              value={section.content || ""}
              onChange={(e) => onUpdate(section.id, { content: e.target.value || undefined })}
              placeholder="Add custom text below this section... Use {tokens} for dynamic values"
              className="min-h-[60px] text-xs"
              maxLength={2000}
            />
            <p className="text-[10px] text-fg-3">
              Appended after the section content. Supports {"{client_name}"}, {"{total}"}, etc.
            </p>
          </div>
        </>
      )}

      {/* Block styling (background, border, padding) */}
      {onUpdateBlockStyling && section.type !== "page-break" && section.type !== "spacer" && (
        <>
          <Separator className="opacity-50" />
          <div className="px-4 py-3 space-y-3">
            <h4 className="text-xs font-semibold text-fg-3 uppercase tracking-wider">
              Section Styling
            </h4>
            <BlockStylingEditor
              styling={blockStyling}
              onUpdate={(s) => onUpdateBlockStyling(section.id, s)}
            />
          </div>
        </>
      )}

      {/* Visibility conditions */}
      <Separator className="opacity-50" />
      <div className="px-4 py-3 space-y-3">
        <h4 className="text-xs font-semibold text-fg-3 uppercase tracking-wider">
          Visibility
        </h4>
        <VisibilitySettings
          visibility={section.visibility}
          onUpdate={updateVisibility}
        />
      </div>
    </div>
  );
}

// ─── Per-type settings renderers ──────────────────────────────────────────────

function SettingsForType({
  type,
  settings,
  content,
  onUpdateSettings,
  onUpdateContent,
}: {
  type: SectionType;
  settings: SectionSettings;
  content?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdateSettings: (updates: Record<string, any>) => void;
  onUpdateContent: (content: string) => void;
}) {
  switch (type) {
    case "header":
      return <HeaderSettings settings={settings as HeaderSectionSettings} onUpdate={onUpdateSettings} />;
    case "client-details":
      return <ClientDetailsSettings settings={settings as ClientDetailsSectionSettings} onUpdate={onUpdateSettings} />;
    case "project-details":
      return <ProjectDetailsSettings settings={settings as ProjectDetailsSectionSettings} onUpdate={onUpdateSettings} />;
    case "table":
      return <TableSettings settings={settings as TableSectionSettings} onUpdate={onUpdateSettings} />;
    case "totals":
      return <TotalsSettings settings={settings as TotalsSectionSettings} onUpdate={onUpdateSettings} />;
    case "notes":
      return <NotesSettings settings={settings as NotesSectionSettings} onUpdate={onUpdateSettings} />;
    case "signature":
      return <SignatureSettings settings={settings as SignatureSectionSettings} onUpdate={onUpdateSettings} />;
    case "custom-text":
      return (
        <CustomTextSettings
          settings={settings as CustomTextSectionSettings}
          content={content || ""}
          onUpdate={onUpdateSettings}
          onUpdateContent={onUpdateContent}
        />
      );
    case "crew-table":
      return <CrewTableSettings settings={settings as CrewTableSectionSettings} onUpdate={onUpdateSettings} />;
    case "call-sheet-info":
      return <CallSheetInfoSettings settings={settings as CallSheetInfoSectionSettings} onUpdate={onUpdateSettings} />;
    case "day-header":
      return <DayHeaderSettings settings={settings as DayHeaderSectionSettings} onUpdate={onUpdateSettings} />;
    case "spacer":
      return <SpacerSettings settings={settings as SpacerSectionSettings} onUpdate={onUpdateSettings} />;
    case "page-break":
      return (
        <p className="text-xs text-fg-3">
          No settings — forces a new page at this point.
        </p>
      );
    default:
      return null;
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs text-fg-2 font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Editable label row — toggle + optional custom label */
function LabelledToggleRow({
  label,
  customLabel,
  labelKey,
  checked,
  onChange,
  onLabelChange,
}: {
  label: string;
  customLabel?: string;
  labelKey: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onLabelChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-fg-2 font-normal">{label}</Label>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
      {checked && (
        <Input
          value={customLabel || ""}
          onChange={(e) => onLabelChange(labelKey, e.target.value)}
          placeholder={`Label: ${label}`}
          className="h-7 text-xs text-fg-3"
          maxLength={50}
        />
      )}
    </div>
  );
}

/** Per-section styling editor */
function StylingEditor({
  styling,
  onUpdate,
}: {
  styling?: SectionStyling;
  onUpdate: (styling: SectionStyling) => void;
}) {
  const current = styling || {};
  return (
    <div className="space-y-2 rounded-lg border border-border/30 p-2.5">
      <h5 className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider">Styling</h5>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Font Size</Label>
          <Select
            value={current.fontSize ? String(current.fontSize) : ""}
            onValueChange={(v) => onUpdate({ ...current, fontSize: v ? Number(v) : undefined })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue>{current.fontSize ? `${current.fontSize}pt` : "Default"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Default</SelectItem>
              {[7, 8, 9, 10, 11, 12, 14].map((s) => (
                <SelectItem key={s} value={String(s)}>{s}pt</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Text Colour</Label>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={current.textColor || "#1a1a1a"}
              onChange={(e) => onUpdate({ ...current, textColor: e.target.value })}
              className="w-7 h-7 rounded border border-border/50 cursor-pointer p-0"
            />
            {current.textColor && (
              <button
                className="text-[9px] text-fg-3 hover:text-fg"
                onClick={() => onUpdate({ ...current, textColor: undefined })}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Custom key-value fields editor */
function CustomFieldsEditor({
  fields,
  onUpdate,
}: {
  fields?: CustomField[];
  onUpdate: (fields: CustomField[]) => void;
}) {
  const items = fields || [];

  const addField = () => {
    onUpdate([...items, { label: "", value: "" }]);
  };

  const updateField = (index: number, updates: Partial<CustomField>) => {
    const next = items.map((f, i) => (i === index ? { ...f, ...updates } : f));
    onUpdate(next);
  };

  const removeField = (index: number) => {
    onUpdate(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h5 className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider">
          Custom Fields
        </h5>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1"
          onClick={addField}
          disabled={items.length >= 10}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>
      {items.map((field, i) => (
        <div key={i} className="flex gap-1.5 items-start">
          <div className="flex-1 space-y-1">
            <Input
              value={field.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              placeholder="Label"
              className="h-7 text-xs"
              maxLength={50}
            />
            <Input
              value={field.value}
              onChange={(e) => updateField(i, { value: e.target.value })}
              placeholder="Value or {token}"
              className="h-7 text-xs text-fg-3"
              maxLength={200}
            />
          </div>
          <button
            className="mt-1 text-fg-3 hover:text-destructive shrink-0"
            onClick={() => removeField(i)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {items.length === 0 && (
        <p className="text-[10px] text-fg-3">
          Add custom fields like &quot;BSB: 000-000&quot; or &quot;PO Number: {"{project_number}"}&quot;
        </p>
      )}
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function HeaderSettings({
  settings,
  onUpdate,
}: {
  settings: HeaderSectionSettings;
  onUpdate: (u: Partial<HeaderSectionSettings>) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Document Title</Label>
        <Input
          value={settings.documentTitle}
          onChange={(e) => onUpdate({ documentTitle: e.target.value })}
          placeholder="e.g. QUOTE, TAX INVOICE"
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-fg-3">
          Supports tokens like {"{project_name}"} for dynamic titles.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Logo Display</Label>
        <Select
          value={settings.logoMode}
          onValueChange={(v) => onUpdate({ logoMode: v as "logo" | "icon" | "none" })}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue>
              {settings.logoMode === "logo" ? "Full Logo" : settings.logoMode === "icon" ? "Icon Only" : "Hidden"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="logo">Full Logo</SelectItem>
            <SelectItem value="icon">Icon Only</SelectItem>
            <SelectItem value="none">Hidden</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ToggleRow label="Organisation Name" checked={settings.showOrgName} onChange={(v) => onUpdate({ showOrgName: v })} />
      <ToggleRow label="Address" checked={settings.showOrgAddress} onChange={(v) => onUpdate({ showOrgAddress: v })} />
      <ToggleRow label="Phone" checked={settings.showOrgPhone} onChange={(v) => onUpdate({ showOrgPhone: v })} />
      <ToggleRow label="Email" checked={settings.showOrgEmail} onChange={(v) => onUpdate({ showOrgEmail: v })} />
      <ToggleRow label="Website" checked={settings.showOrgWebsite} onChange={(v) => onUpdate({ showOrgWebsite: v })} />
    </>
  );
}

// ─── Client Details ─────────────────────────────────────────────────────────

function ClientDetailsSettings({
  settings,
  onUpdate,
}: {
  settings: ClientDetailsSectionSettings;
  onUpdate: (u: Partial<ClientDetailsSectionSettings>) => void;
}) {
  const labels = settings.customLabels || {};
  const updateLabel = (key: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...labels, [key]: value })) {
      if (v) next[k] = v;
    }
    onUpdate({ customLabels: Object.keys(next).length > 0 ? next : undefined });
  };

  return (
    <>
      <ToggleRow label="Client Name" checked={settings.showClientName} onChange={(v) => onUpdate({ showClientName: v })} />
      <LabelledToggleRow
        label="Contact Person"
        customLabel={labels.contact}
        labelKey="contact"
        checked={settings.showClientContact}
        onChange={(v) => onUpdate({ showClientContact: v })}
        onLabelChange={updateLabel}
      />
      <ToggleRow label="Email" checked={settings.showClientEmail} onChange={(v) => onUpdate({ showClientEmail: v })} />
      <ToggleRow label="Address" checked={settings.showClientAddress} onChange={(v) => onUpdate({ showClientAddress: v })} />
      <LabelledToggleRow
        label="ABN / Tax ID"
        customLabel={labels.taxId}
        labelKey="taxId"
        checked={settings.showClientTaxId}
        onChange={(v) => onUpdate({ showClientTaxId: v })}
        onLabelChange={updateLabel}
      />

      <Separator className="opacity-30" />
      <CustomFieldsEditor
        fields={settings.customFields}
        onUpdate={(customFields) => onUpdate({ customFields: customFields.length > 0 ? customFields : undefined })}
      />

      <Separator className="opacity-30" />
      <StylingEditor
        styling={settings.styling}
        onUpdate={(styling) => onUpdate({ styling })}
      />
    </>
  );
}

// ─── Project Details ────────────────────────────────────────────────────────

function ProjectDetailsSettings({
  settings,
  onUpdate,
}: {
  settings: ProjectDetailsSectionSettings;
  onUpdate: (u: Partial<ProjectDetailsSectionSettings>) => void;
}) {
  const labels = settings.customLabels || {};
  const updateLabel = (key: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...labels, [key]: value })) {
      if (v) next[k] = v;
    }
    onUpdate({ customLabels: Object.keys(next).length > 0 ? next : undefined });
  };

  return (
    <>
      <ToggleRow label="Project Name" checked={settings.showProjectName} onChange={(v) => onUpdate({ showProjectName: v })} />
      <ToggleRow label="Project Number" checked={settings.showProjectNumber} onChange={(v) => onUpdate({ showProjectNumber: v })} />
      <LabelledToggleRow
        label="Venue"
        customLabel={labels.venue}
        labelKey="venue"
        checked={settings.showVenue}
        onChange={(v) => onUpdate({ showVenue: v })}
        onLabelChange={updateLabel}
      />
      <LabelledToggleRow
        label="Rental Dates"
        customLabel={labels.rentalDates}
        labelKey="rentalDates"
        checked={settings.showRentalDates}
        onChange={(v) => onUpdate({ showRentalDates: v })}
        onLabelChange={updateLabel}
      />
      <LabelledToggleRow
        label="Event Dates"
        customLabel={labels.eventDates}
        labelKey="eventDates"
        checked={settings.showEventDates}
        onChange={(v) => onUpdate({ showEventDates: v })}
        onLabelChange={updateLabel}
      />
      <LabelledToggleRow
        label="Payment Terms"
        customLabel={labels.paymentTerms}
        labelKey="paymentTerms"
        checked={settings.showPaymentTerms}
        onChange={(v) => onUpdate({ showPaymentTerms: v })}
        onLabelChange={updateLabel}
      />
      <LabelledToggleRow
        label="Site Contact"
        customLabel={labels.siteContact}
        labelKey="siteContact"
        checked={settings.showSiteContact}
        onChange={(v) => onUpdate({ showSiteContact: v })}
        onLabelChange={updateLabel}
      />
      <LabelledToggleRow
        label="Document Date"
        customLabel={labels.documentDate}
        labelKey="documentDate"
        checked={settings.showDocumentDate}
        onChange={(v) => onUpdate({ showDocumentDate: v })}
        onLabelChange={updateLabel}
      />

      <Separator className="opacity-30" />
      <CustomFieldsEditor
        fields={settings.customFields}
        onUpdate={(customFields) => onUpdate({ customFields: customFields.length > 0 ? customFields : undefined })}
      />

      <Separator className="opacity-30" />
      <StylingEditor
        styling={settings.styling}
        onUpdate={(styling) => onUpdate({ styling })}
      />
    </>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

function TableSettings({
  settings,
  onUpdate,
}: {
  settings: TableSectionSettings;
  onUpdate: (u: Partial<TableSectionSettings>) => void;
}) {
  return (
    <>
      <ToggleRow label="Group Headers" checked={settings.showGroupHeaders} onChange={(v) => onUpdate({ showGroupHeaders: v })} />
      <ToggleRow label="Kit Children" checked={settings.showKitChildren} onChange={(v) => onUpdate({ showKitChildren: v })} />
      <ToggleRow label="Row Numbers" checked={settings.showRowNumbers} onChange={(v) => onUpdate({ showRowNumbers: v })} />
      <ToggleRow label="Pricing" checked={settings.showPricing} onChange={(v) => onUpdate({ showPricing: v })} />
      <ToggleRow label="Badges" checked={settings.showBadges} onChange={(v) => onUpdate({ showBadges: v })} />
      <ToggleRow label="Notes" checked={settings.showNotes} onChange={(v) => onUpdate({ showNotes: v })} />
      <ToggleRow label="Checkboxes" checked={settings.showCheckboxes} onChange={(v) => onUpdate({ showCheckboxes: v })} />
      <ToggleRow label="Per-unit Checkboxes" checked={settings.showPerUnitCheckboxes} onChange={(v) => onUpdate({ showPerUnitCheckboxes: v })} />
      <ToggleRow label="Condition Columns" checked={settings.showConditionColumns} onChange={(v) => onUpdate({ showConditionColumns: v })} />
      <ToggleRow label="Asset Tags" checked={settings.showAssetTags} onChange={(v) => onUpdate({ showAssetTags: v })} />
      <ToggleRow label="Categories" checked={settings.showCategories} onChange={(v) => onUpdate({ showCategories: v })} />
    </>
  );
}

// ─── Totals ─────────────────────────────────────────────────────────────────

function TotalsSettings({
  settings,
  onUpdate,
}: {
  settings: TotalsSectionSettings;
  onUpdate: (u: Partial<TotalsSectionSettings>) => void;
}) {
  return (
    <>
      <ToggleRow label="Subtotal" checked={settings.showSubtotal} onChange={(v) => onUpdate({ showSubtotal: v })} />
      <ToggleRow label="Discount" checked={settings.showDiscount} onChange={(v) => onUpdate({ showDiscount: v })} />
      <ToggleRow label="Tax" checked={settings.showTax} onChange={(v) => onUpdate({ showTax: v })} />
      <ToggleRow label="Total" checked={settings.showTotal} onChange={(v) => onUpdate({ showTotal: v })} />
      <ToggleRow label="Deposit Paid" checked={settings.showDeposit} onChange={(v) => onUpdate({ showDeposit: v })} />
      <ToggleRow label="Balance Due" checked={settings.showBalance} onChange={(v) => onUpdate({ showBalance: v })} />
    </>
  );
}

// ─── Notes ──────────────────────────────────────────────────────────────────

function NotesSettings({
  settings,
  onUpdate,
}: {
  settings: NotesSectionSettings;
  onUpdate: (u: Partial<NotesSectionSettings>) => void;
}) {
  return (
    <>
      <ToggleRow label="Client Notes" checked={settings.showClientNotes} onChange={(v) => onUpdate({ showClientNotes: v })} />
      <ToggleRow label="Crew Notes" checked={settings.showCrewNotes} onChange={(v) => onUpdate({ showCrewNotes: v })} />
    </>
  );
}

// ─── Signature ──────────────────────────────────────────────────────────────

function SignatureSettings({
  settings,
  onUpdate,
}: {
  settings: SignatureSectionSettings;
  onUpdate: (u: Partial<SignatureSectionSettings>) => void;
}) {
  const updateLabel = (index: number, value: string) => {
    const labels = [...settings.labels];
    labels[index] = value;
    onUpdate({ labels });
  };

  const addColumn = () => {
    if (settings.columns >= 6) return;
    onUpdate({
      columns: settings.columns + 1,
      labels: [...settings.labels, `Signature ${settings.columns + 1}`],
    });
  };

  const removeColumn = () => {
    if (settings.columns <= 1) return;
    onUpdate({
      columns: settings.columns - 1,
      labels: settings.labels.slice(0, settings.columns - 1),
    });
  };

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-fg-3">Columns ({settings.columns})</Label>
          <div className="flex gap-1">
            <button
              className="text-xs px-2 py-0.5 rounded bg-bg-inset text-fg-3 hover:text-fg disabled:opacity-30"
              onClick={removeColumn}
              disabled={settings.columns <= 1}
            >
              -
            </button>
            <button
              className="text-xs px-2 py-0.5 rounded bg-bg-inset text-fg-3 hover:text-fg disabled:opacity-30"
              onClick={addColumn}
              disabled={settings.columns >= 6}
            >
              +
            </button>
          </div>
        </div>
      </div>
      {settings.labels.map((label, i) => (
        <div key={i} className="space-y-1">
          <Label className="text-xs text-fg-3">Label {i + 1}</Label>
          <Input
            value={label}
            onChange={(e) => updateLabel(i, e.target.value)}
            className="h-8 text-sm"
            maxLength={50}
          />
        </div>
      ))}
    </>
  );
}

// ─── Custom Text ────────────────────────────────────────────────────────────

function CustomTextSettings({
  settings,
  content,
  onUpdate,
  onUpdateContent,
}: {
  settings: CustomTextSectionSettings;
  content: string;
  onUpdate: (u: Partial<CustomTextSectionSettings>) => void;
  onUpdateContent: (content: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Content</Label>
        <Textarea
          value={content}
          onChange={(e) => onUpdateContent(e.target.value)}
          placeholder="Enter text... Use {token_name} for dynamic values"
          className="min-h-[80px] text-sm"
          maxLength={5000}
        />
        <p className="text-[10px] text-fg-3">
          Use tokens like {"{client_name}"}, {"{project_name}"}, {"{total}"} for dynamic content.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Font Size</Label>
        <Select
          value={String(settings.fontSize)}
          onValueChange={(v) => onUpdate({ fontSize: Number(v) })}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue>{settings.fontSize}pt</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[6, 7, 8, 9, 10, 11, 12, 14, 16, 18].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}pt
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Weight</Label>
        <Select
          value={settings.fontWeight}
          onValueChange={(v) => onUpdate({ fontWeight: v as "normal" | "bold" })}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue>{settings.fontWeight === "bold" ? "Bold" : "Normal"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="bold">Bold</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Alignment</Label>
        <Select
          value={settings.alignment}
          onValueChange={(v) => onUpdate({ alignment: v as "left" | "center" | "right" })}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue>
              {settings.alignment === "left" ? "Left" : settings.alignment === "center" ? "Centre" : "Right"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="center">Centre</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

// ─── Crew Table ─────────────────────────────────────────────────────────────

function CrewTableSettings({
  settings,
  onUpdate,
}: {
  settings: CrewTableSectionSettings;
  onUpdate: (u: Partial<CrewTableSectionSettings>) => void;
}) {
  return (
    <>
      <ToggleRow label="Phone" checked={settings.showPhone} onChange={(v) => onUpdate({ showPhone: v })} />
      <ToggleRow label="Email" checked={settings.showEmail} onChange={(v) => onUpdate({ showEmail: v })} />
      <ToggleRow label="Notes" checked={settings.showNotes} onChange={(v) => onUpdate({ showNotes: v })} />
    </>
  );
}

// ─── Call Sheet Info ────────────────────────────────────────────────────────

function CallSheetInfoSettings({
  settings,
  onUpdate,
}: {
  settings: CallSheetInfoSectionSettings;
  onUpdate: (u: Partial<CallSheetInfoSectionSettings>) => void;
}) {
  return (
    <>
      <ToggleRow label="PM Contact" checked={settings.showPmContact} onChange={(v) => onUpdate({ showPmContact: v })} />
      <ToggleRow label="Client Contact" checked={settings.showClientContact} onChange={(v) => onUpdate({ showClientContact: v })} />
      <ToggleRow label="Venue Details" checked={settings.showVenueDetails} onChange={(v) => onUpdate({ showVenueDetails: v })} />
      <ToggleRow label="Schedule Times" checked={settings.showScheduleTimes} onChange={(v) => onUpdate({ showScheduleTimes: v })} />
      <ToggleRow label="Equipment Summary" checked={settings.showEquipmentSummary} onChange={(v) => onUpdate({ showEquipmentSummary: v })} />
    </>
  );
}

// ─── Day Header ─────────────────────────────────────────────────────────────

function DayHeaderSettings({
  settings,
  onUpdate,
}: {
  settings: DayHeaderSectionSettings;
  onUpdate: (u: Partial<DayHeaderSectionSettings>) => void;
}) {
  return (
    <>
      <ToggleRow label="Phases" checked={settings.showPhases} onChange={(v) => onUpdate({ showPhases: v })} />
      <ToggleRow label="Crew Count" checked={settings.showCrewCount} onChange={(v) => onUpdate({ showCrewCount: v })} />
    </>
  );
}

// ─── Spacer ─────────────────────────────────────────────────────────────────

function SpacerSettings({
  settings,
  onUpdate,
}: {
  settings: SpacerSectionSettings;
  onUpdate: (u: Partial<SpacerSectionSettings>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-fg-3">Height (mm)</Label>
      <Input
        type="number"
        min={2}
        max={100}
        value={settings.height}
        onChange={(e) => onUpdate({ height: Math.max(2, Math.min(100, Number(e.target.value))) })}
        className="h-8 text-sm w-24"
      />
    </div>
  );
}

// ─── Block Styling Editor ───────────────────────────────────────────────────

function BlockStylingEditor({
  styling,
  onUpdate,
}: {
  styling?: BlockStyling;
  onUpdate: (styling: BlockStyling | undefined) => void;
}) {
  const current = styling || {};
  const hasStyling = !!(current.backgroundColor || current.borderColor || current.padding || current.margin);

  const update = (updates: Partial<BlockStyling>) => {
    const next = { ...current, ...updates };
    // Clean empty values
    if (!next.backgroundColor && !next.borderColor && !next.borderWidth && !next.padding && !next.margin) {
      onUpdate(undefined);
    } else {
      onUpdate(next);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Background</Label>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={current.backgroundColor || "#ffffff"}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              className="w-7 h-7 rounded border border-border/50 cursor-pointer p-0"
            />
            {current.backgroundColor && (
              <button
                className="text-[9px] text-fg-3 hover:text-fg"
                onClick={() => update({ backgroundColor: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Border</Label>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={current.borderColor || "#cccccc"}
              onChange={(e) => update({ borderColor: e.target.value, borderWidth: current.borderWidth || 0.5 })}
              className="w-7 h-7 rounded border border-border/50 cursor-pointer p-0"
            />
            {current.borderColor && (
              <button
                className="text-[9px] text-fg-3 hover:text-fg"
                onClick={() => update({ borderColor: undefined, borderWidth: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {current.borderColor && (
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Border Width</Label>
          <Select
            value={String(current.borderWidth || 0.5)}
            onValueChange={(v) => update({ borderWidth: Number(v) })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue>{current.borderWidth || 0.5}pt</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[0.25, 0.5, 0.75, 1, 1.5, 2].map((w) => (
                <SelectItem key={w} value={String(w)}>{w}pt</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Padding (mm)</Label>
          <Input
            type="number"
            min={0}
            max={20}
            step={0.5}
            value={current.padding || 0}
            onChange={(e) => update({ padding: Number(e.target.value) || undefined })}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-fg-3">Margin (mm)</Label>
          <Input
            type="number"
            min={0}
            max={20}
            step={0.5}
            value={current.margin || 0}
            onChange={(e) => update({ margin: Number(e.target.value) || undefined })}
            className="h-7 text-xs"
          />
        </div>
      </div>

      {hasStyling && (
        <button
          className="text-[10px] text-destructive hover:underline"
          onClick={() => onUpdate(undefined)}
        >
          Clear all styling
        </button>
      )}
    </div>
  );
}

// ─── Visibility Settings ────────────────────────────────────────────────────

function VisibilitySettings({
  visibility,
  onUpdate,
}: {
  visibility: SectionVisibility;
  onUpdate: (u: Partial<SectionVisibility>) => void;
}) {
  const conditionFields = getAllowedConditionFields();
  const condition = visibility.condition;

  return (
    <>
      {/* Data condition */}
      <div className="space-y-1.5">
        <Label className="text-xs text-fg-3">Data condition (optional)</Label>
        <p className="text-[10px] text-fg-3">
          Show or hide this section based on document data.
        </p>
        {condition ? (
          <div className="space-y-2 rounded-lg border border-border/50 p-2.5">
            <Select
              value={condition.field}
              onValueChange={(v) => {
                if (v) onUpdate({ condition: { ...condition, field: v } });
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue>{condition.field || "Select field..."}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {conditionFields.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={condition.operator}
              onValueChange={(v) =>
                onUpdate({
                  condition: {
                    ...condition,
                    operator: v as "exists" | "not_exists" | "equals" | "not_equals",
                  },
                })
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue>
                  {condition.operator === "exists"
                    ? "has value"
                    : condition.operator === "not_exists"
                      ? "is empty"
                      : condition.operator === "equals"
                        ? "equals"
                        : "does not equal"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exists">has value</SelectItem>
                <SelectItem value="not_exists">is empty</SelectItem>
                <SelectItem value="equals">equals</SelectItem>
                <SelectItem value="not_equals">does not equal</SelectItem>
              </SelectContent>
            </Select>
            {(condition.operator === "equals" || condition.operator === "not_equals") && (
              <Input
                value={condition.value || ""}
                onChange={(e) =>
                  onUpdate({ condition: { ...condition, value: e.target.value } })
                }
                placeholder="Value..."
                className="h-7 text-xs"
              />
            )}
            <button
              className="text-[10px] text-destructive hover:underline"
              onClick={() => onUpdate({ condition: undefined })}
            >
              Remove condition
            </button>
          </div>
        ) : (
          <button
            className="text-xs text-primary hover:underline"
            onClick={() =>
              onUpdate({
                condition: { field: "client_name", operator: "exists" },
              })
            }
          >
            + Add condition
          </button>
        )}
      </div>
    </>
  );
}
