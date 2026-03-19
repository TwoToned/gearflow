/**
 * Zod schemas for template sections, visibility conditions, brand templates,
 * template import/export validation, and block editor validation.
 */
import { z } from "zod";
import { DOCUMENT_TYPES } from "./document-template";

// ─── Section Types ───────────────────────────────────────────────────────────

export const SECTION_TYPE_VALUES = [
  "header",
  "client-details",
  "project-details",
  "table",
  "totals",
  "notes",
  "signature",
  "custom-text",
  "crew-table",
  "spacer",
  "page-break",
] as const;

export const sectionTypeSchema = z.enum(SECTION_TYPE_VALUES);

// ─── Condition Operators ─────────────────────────────────────────────────────

export const conditionOperatorSchema = z.enum([
  "exists",
  "not_exists",
  "equals",
  "not_equals",
]);

// ─── Visibility Condition ────────────────────────────────────────────────────

export const visibilityConditionSchema = z.object({
  field: z.string().min(1).max(100),
  operator: conditionOperatorSchema,
  value: z.string().max(500).optional(),
});

export const sectionVisibilitySchema = z.object({
  docTypes: z.array(z.enum(DOCUMENT_TYPES)).optional(),
  condition: visibilityConditionSchema.optional(),
});

// ─── Shared Sub-Schemas ─────────────────────────────────────────────────────

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Must be a valid hex color");

const sectionStylingSchema = z
  .object({
    fontSize: z.number().min(6).max(18).optional(),
    textColor: hexColorSchema.optional(),
  })
  .optional();

const customFieldSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.string().max(500),
});

// ─── Per-Section Settings ────────────────────────────────────────────────────

export const headerSectionSettingsSchema = z.object({
  logoMode: z.enum(["logo", "icon", "none"]),
  showOrgName: z.boolean(),
  showOrgAddress: z.boolean(),
  showOrgPhone: z.boolean(),
  showOrgEmail: z.boolean(),
  showOrgWebsite: z.boolean(),
  documentTitle: z.string().max(100),
});

export const clientDetailsSectionSettingsSchema = z.object({
  showClientName: z.boolean(),
  showClientContact: z.boolean(),
  showClientEmail: z.boolean(),
  showClientAddress: z.boolean(),
  showClientTaxId: z.boolean(),
  customLabels: z.record(z.string(), z.string().max(50)).optional(),
  customFields: z.array(customFieldSchema).max(20).optional(),
  styling: sectionStylingSchema,
});

export const projectDetailsSectionSettingsSchema = z.object({
  showProjectName: z.boolean(),
  showProjectNumber: z.boolean(),
  showVenue: z.boolean(),
  showRentalDates: z.boolean(),
  showEventDates: z.boolean(),
  showPaymentTerms: z.boolean(),
  showSiteContact: z.boolean(),
  showDocumentDate: z.boolean(),
  customLabels: z.record(z.string(), z.string().max(50)).optional(),
  customFields: z.array(customFieldSchema).max(20).optional(),
  styling: sectionStylingSchema,
});

export const tableSectionSettingsSchema = z.object({
  showGroupHeaders: z.boolean(),
  showKitChildren: z.boolean(),
  showCheckboxes: z.boolean(),
  showConditionColumns: z.boolean(),
  showPricing: z.boolean(),
  showBadges: z.boolean(),
  showNotes: z.boolean(),
  showPerUnitCheckboxes: z.boolean(),
  showAssetTags: z.boolean(),
  showCategories: z.boolean(),
  showRowNumbers: z.boolean(),
});

export const totalsSectionSettingsSchema = z.object({
  showSubtotal: z.boolean(),
  showDiscount: z.boolean(),
  showTax: z.boolean(),
  showTotal: z.boolean(),
  showDeposit: z.boolean(),
  showBalance: z.boolean(),
});

export const notesSectionSettingsSchema = z.object({
  showClientNotes: z.boolean(),
  showCrewNotes: z.boolean(),
});

export const signatureSectionSettingsSchema = z.object({
  columns: z.number().int().min(1).max(6),
  labels: z.array(z.string().max(50)).min(1).max(6),
});

export const customTextSectionSettingsSchema = z.object({
  fontSize: z.number().min(6).max(18),
  fontWeight: z.enum(["normal", "bold"]),
  alignment: z.enum(["left", "center", "right"]),
});

export const crewTableSectionSettingsSchema = z.object({
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showNotes: z.boolean(),
});

export const spacerSectionSettingsSchema = z.object({
  height: z.number().min(2).max(100),
});

// ─── Discriminated Settings Schema ──────────────────────────────────────────

/** Map of section type → settings schema for type-safe validation */
export const SETTINGS_SCHEMA_MAP = {
  header: headerSectionSettingsSchema,
  "client-details": clientDetailsSectionSettingsSchema,
  "project-details": projectDetailsSectionSettingsSchema,
  table: tableSectionSettingsSchema,
  totals: totalsSectionSettingsSchema,
  notes: notesSectionSettingsSchema,
  signature: signatureSectionSettingsSchema,
  "custom-text": customTextSectionSettingsSchema,
  "crew-table": crewTableSectionSettingsSchema,
  spacer: spacerSectionSettingsSchema,
  "page-break": z.object({}),
} as const;

/**
 * Validate settings based on section type (discriminated union).
 * Falls back to permissive validation for unknown types.
 */
export function validateSectionSettings(
  type: string,
  settings: unknown,
): z.ZodSafeParseResult<unknown> {
  const schema =
    SETTINGS_SCHEMA_MAP[type as keyof typeof SETTINGS_SCHEMA_MAP];
  if (!schema) {
    return z.record(z.string(), z.unknown()).safeParse(settings);
  }
  return schema.safeParse(settings);
}

/** Loose settings schema for backward compatibility during migration */
export const sectionSettingsSchema = z.record(z.string(), z.unknown());

// ─── Layout Hint ─────────────────────────────────────────────────────────────

export const layoutHintSchema = z.object({
  rowId: z.string().min(1).max(50),
  columnIndex: z.number().int().min(0).max(3),
  columnWidth: z.number().min(1).max(100),
  columnCount: z.number().int().min(1).max(4),
  styling: z
    .object({
      backgroundColor: hexColorSchema.optional(),
      borderColor: hexColorSchema.optional(),
      borderWidth: z.number().min(0).max(10).optional(),
      padding: z.number().min(0).max(50).optional(),
      margin: z.number().min(0).max(50).optional(),
    })
    .optional(),
});

// ─── Template Section ────────────────────────────────────────────────────────

export const templateSectionSchema = z.object({
  id: z.string().min(1).max(50),
  type: sectionTypeSchema,
  settings: sectionSettingsSchema,
  visibility: sectionVisibilitySchema,
  content: z.string().max(5000).optional(),
  order: z.number().int().min(0),
  layoutHint: layoutHintSchema.optional(),
});

export const templateSectionsSchema = z
  .array(templateSectionSchema)
  .min(1, "Template must have at least one section")
  .max(50, "Template cannot have more than 50 sections");

// ─── Block Styling ──────────────────────────────────────────────────────────

export const blockStylingSchema = z.object({
  backgroundColor: hexColorSchema.optional(),
  borderColor: hexColorSchema.optional(),
  borderWidth: z.number().min(0).max(10).optional(),
  padding: z.number().min(0).max(50).optional(),
  margin: z.number().min(0).max(50).optional(),
});

// ─── Template Block (editor tree) ────────────────────────────────────────────

const blockTypeSchema = z.enum([
  "row",
  "column",
  ...SECTION_TYPE_VALUES,
]);

/**
 * TemplateBlock schema — validates the editor's block tree structure.
 * Uses z.lazy for recursive children validation.
 */
export const templateBlockSchema: z.ZodType<{
  id: string;
  type: string;
  children?: unknown[];
  settings?: Record<string, unknown>;
  visibility?: z.input<typeof sectionVisibilitySchema>;
  content?: string;
  columnWidths?: number[];
  styling?: z.input<typeof blockStylingSchema>;
}> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(50),
    type: blockTypeSchema,
    children: z.array(templateBlockSchema).max(50).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    visibility: sectionVisibilitySchema.optional(),
    content: z.string().max(5000).optional(),
    columnWidths: z
      .array(z.number().min(1).max(100))
      .max(4)
      .optional(),
    styling: blockStylingSchema.optional(),
  }),
);

export const templateBlocksSchema = z
  .array(templateBlockSchema)
  .max(50, "Template cannot have more than 50 blocks");

// ─── Brand Template ──────────────────────────────────────────────────────────

export const brandTemplateHeaderSettingsSchema = z.object({
  logoMode: z.enum(["logo", "icon", "none"]),
  showOrgName: z.boolean(),
  showOrgAddress: z.boolean(),
  showOrgPhone: z.boolean(),
  showOrgEmail: z.boolean(),
  showOrgWebsite: z.boolean(),
});

export const brandTemplateFooterSettingsSchema = z.object({
  showFooter: z.boolean(),
  primaryText: z.string().max(500),
  secondaryText: z.string().max(500),
});

export const createBrandTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  headerSettings: brandTemplateHeaderSettingsSchema,
  footerSettings: brandTemplateFooterSettingsSchema,
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Must be a valid hex color")
    .optional()
    .or(z.literal("")),
});

export const updateBrandTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  headerSettings: brandTemplateHeaderSettingsSchema.optional(),
  footerSettings: brandTemplateFooterSettingsSchema.optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .or(z.literal("")),
});

// ─── Save Sections (for document template) ───────────────────────────────────

export const saveTemplateSectionsSchema = z.object({
  id: z.string().min(1),
  sections: templateSectionsSchema,
  brandTemplateId: z.string().optional().nullable(),
  /** Client-side version for optimistic locking */
  version: z.number().int().min(0).optional(),
});

// ─── Save Blocks (for block editor) ──────────────────────────────────────────

export const saveTemplateBlocksSchema = z.object({
  id: z.string().min(1),
  blocks: templateBlocksSchema,
  brandTemplateId: z.string().optional().nullable(),
  /** Client-side version for optimistic locking */
  version: z.number().int().min(0).optional(),
});

// ─── Template Export/Import ──────────────────────────────────────────────────

export const templateExportSchema = z.object({
  version: z.literal(1),
  type: z.enum(DOCUMENT_TYPES),
  name: z.string(),
  sections: templateSectionsSchema,
  exportedAt: z.string(),
});

export const templateImportSchema = templateExportSchema;

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateBrandTemplateValues = z.input<typeof createBrandTemplateSchema>;
export type UpdateBrandTemplateValues = z.input<typeof updateBrandTemplateSchema>;
export type SaveTemplateSectionsValues = z.input<typeof saveTemplateSectionsSchema>;
export type SaveTemplateBlocksValues = z.input<typeof saveTemplateBlocksSchema>;
export type TemplateExportData = z.input<typeof templateExportSchema>;
export type TemplateImportData = z.input<typeof templateImportSchema>;
