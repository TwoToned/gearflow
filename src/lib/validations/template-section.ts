/**
 * Zod schemas for template sections, visibility conditions, brand templates,
 * and template import/export validation.
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

/** Discriminated settings schema based on section type */
export const sectionSettingsSchema = z.record(z.string(), z.unknown());

// ─── Template Section ────────────────────────────────────────────────────────

export const templateSectionSchema = z.object({
  id: z.string().min(1).max(50),
  type: sectionTypeSchema,
  settings: sectionSettingsSchema,
  visibility: sectionVisibilitySchema,
  content: z.string().max(5000).optional(),
  order: z.number().int().min(0),
});

export const templateSectionsSchema = z
  .array(templateSectionSchema)
  .min(1, "Template must have at least one section")
  .max(50, "Template cannot have more than 50 sections");

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
export type TemplateExportData = z.input<typeof templateExportSchema>;
export type TemplateImportData = z.input<typeof templateImportSchema>;
