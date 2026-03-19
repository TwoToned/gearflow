/**
 * PDF generation orchestrator.
 * Assembles template + data + plugins → calls pdfme generate() → returns PDF buffer.
 *
 * Two pipelines:
 * 1. SECTION-BASED (new): DocumentTemplate.sections → section renderer → multi-page pdfme
 * 2. LEGACY: DocumentTemplate.basePdf/schemas → direct pdfme generation
 *
 * Template selection: templateId → org default → system default.
 * Section-based templates are preferred when available.
 */
import { generate } from "@pdfme/generator";
import type { Template } from "@pdfme/common";
import { prisma } from "@/lib/prisma";
import { gearflowPlugins } from "./plugins";
import { getPdfmeFonts } from "./fonts";
import { buildDocumentData } from "./build-document-data";
import { getTemplateBuilder, getTtReportBuilder } from "./templates";
import { buildReportTemplate, buildReportInputs, calculatePageCount, countSummaryItems } from "./templates/report";
import { renderSections } from "./section-renderer";
import { getDefaultSections } from "./section-types";
import type { TemplateSection } from "./section-types";
import type { DocumentType, DocumentData, TestTagReportType } from "./types";
import type { ReportResult } from "@/lib/report-types";
import type { TemplateSettings } from "./template-settings";

// ─── Template Loading ────────────────────────────────────────────────────────

interface LoadedTemplate {
  /** Section-based template (new pipeline) */
  sections: TemplateSection[] | null;
  /** Legacy pdfme template */
  template: Template | null;
  /** Legacy settings */
  settings: TemplateSettings | null;
  /** Brand template overrides */
  brandAccentColor: string | null;
  brandFooterText: string | null;
  brandFooterSecondLine: string | null;
}

/**
 * Load a template with brand template resolution.
 * Checks for section-based templates first, falls back to legacy.
 */
async function loadTemplate(
  organizationId: string,
  docType: DocumentType,
  templateId?: string,
): Promise<LoadedTemplate> {
  try {
    // Build query for the specific template or org default
    const where = templateId
      ? { id: templateId, organizationId, isDraft: false }
      : { organizationId, type: docType, isDefault: true, isDraft: false };

    const record = await prisma.documentTemplate.findFirst({
      where,
      include: { brandTemplate: true },
    });

    if (!record) {
      return { sections: null, template: null, settings: null, brandAccentColor: null, brandFooterText: null, brandFooterSecondLine: null };
    }

    // Check for section-based template (new pipeline)
    if (record.sections) {
      const sections = JSON.parse(record.sections) as TemplateSection[];
      const brand = record.brandTemplate;
      const brandFooter = brand ? JSON.parse(brand.footerSettings) : null;
      return {
        sections,
        template: null,
        settings: null,
        brandAccentColor: brand?.accentColor || null,
        brandFooterText: brandFooter?.showFooter ? brandFooter.primaryText : null,
        brandFooterSecondLine: brandFooter?.showFooter ? brandFooter.secondaryText : null,
      };
    }

    // Legacy pipeline — requires basePdf and schemas
    if (!record.basePdf || !record.schemas) {
      return { sections: null, template: null, settings: null, brandAccentColor: null, brandFooterText: null, brandFooterSecondLine: null };
    }

    return {
      sections: null,
      template: {
        basePdf: JSON.parse(record.basePdf),
        schemas: JSON.parse(record.schemas),
      },
      settings: record.settings ? JSON.parse(record.settings) : null,
      brandAccentColor: null,
      brandFooterText: null,
      brandFooterSecondLine: null,
    };
  } catch {
    return { sections: null, template: null, settings: null, brandAccentColor: null, brandFooterText: null, brandFooterSecondLine: null };
  }
}

// ─── Main Generation ─────────────────────────────────────────────────────────

/**
 * Generate a PDF document for a project.
 *
 * Template selection: templateId → org default → system default.
 * Uses section-based pipeline when available, falls back to legacy.
 *
 * @param projectId - The project to generate a document for
 * @param organizationId - The organization the project belongs to
 * @param docType - The type of document to generate
 * @param callSheetDate - Optional date for call sheet (picks crew shifts for that day)
 * @param templateId - Optional specific template ID to use
 * @returns PDF as Uint8Array
 */
export async function generatePdf(
  projectId: string,
  organizationId: string,
  docType: DocumentType,
  callSheetDate?: Date,
  templateId?: string,
): Promise<Uint8Array> {
  // 1. Build data contract
  const data = await buildDocumentData(projectId, organizationId, docType, callSheetDate);

  // 2. Load template (section-based or legacy)
  const loaded = await loadTemplate(organizationId, docType, templateId);

  // 3. Section-based pipeline (new)
  if (loaded.sections) {
    const docColor = loaded.brandAccentColor || data.org_document_color;
    const { template, inputs } = renderSections(
      loaded.sections,
      data,
      docType,
      docColor,
      loaded.brandFooterText || undefined,
      loaded.brandFooterSecondLine || undefined,
    );

    const pdf = await generate({
      template,
      inputs,
      plugins: gearflowPlugins,
      options: { font: getPdfmeFonts() },
    });
    return pdf;
  }

  // 4. Legacy pipeline (fallback)
  const { buildTemplate, buildInputs } = getTemplateBuilder(docType);
  const templateSettings = loaded.settings || undefined;
  const inputs = buildInputs(data, callSheetDate, templateSettings);

  let template: Template;
  if (loaded.template) {
    template = loaded.template;
  } else {
    template = buildTemplate(templateSettings);
  }

  const pdf = await generate({
    template,
    inputs: [inputs],
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}

/**
 * Generate a PDF from sections + data (for section-based template preview).
 * Used by the template builder live preview.
 */
export async function generatePdfFromSections(
  data: DocumentData,
  docType: DocumentType,
  sections: TemplateSection[],
  docColor?: string,
  footerText?: string,
  footerSecondLine?: string,
): Promise<Uint8Array> {
  const color = docColor || data.org_document_color;
  const { template, inputs } = renderSections(
    sections,
    data,
    docType,
    color,
    footerText,
    footerSecondLine,
  );

  const pdf = await generate({
    template,
    inputs,
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}

/**
 * Generate a PDF from pre-built data (avoids re-fetching from DB).
 * Useful when data has already been loaded, e.g. for preview or batch generation.
 */
export async function generatePdfFromData(
  data: DocumentData,
  docType: DocumentType,
  callSheetDate?: Date
): Promise<Uint8Array> {
  const { buildTemplate, buildInputs } = getTemplateBuilder(docType);
  const template = buildTemplate();
  const inputs = buildInputs(data, callSheetDate);

  const pdf = await generate({
    template,
    inputs: [inputs],
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}

/**
 * Generate a PDF from data + settings (for template preview).
 * Uses system default template structure but applies user's custom settings.
 */
export async function generatePdfFromSettings(
  data: DocumentData,
  docType: DocumentType,
  settings: TemplateSettings,
  callSheetDate?: Date
): Promise<Uint8Array> {
  const { buildTemplate, buildInputs } = getTemplateBuilder(docType);
  const template = buildTemplate(settings);
  const inputs = buildInputs(data, callSheetDate, settings);

  const pdf = await generate({
    template,
    inputs: [inputs],
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}

/**
 * Generate a T&T report PDF from pre-loaded report data.
 *
 * @param reportType - The T&T report type
 * @param reportData - The report data (from the report server action)
 * @param orgData - Organization data (name, branding, logos)
 * @returns PDF as Uint8Array
 */
export async function generateTestTagReport(
  reportType: TestTagReportType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reportData: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orgData: any,
): Promise<Uint8Array> {
  const { buildTemplate, buildInputs } = getTtReportBuilder(reportType);
  const template = buildTemplate();
  const inputs = buildInputs(reportData, orgData);

  const pdf = await generate({
    template,
    inputs: [inputs],
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}

/**
 * Generate a PDF from a report result (custom or pre-built report).
 *
 * @param title - Report title
 * @param result - The executed report result
 * @param orgData - Organization data (name, branding, logos)
 * @param subtitle - Optional subtitle (e.g. data source label)
 * @returns PDF as Uint8Array
 */
export async function generateReportPdf(
  title: string,
  result: ReportResult,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orgData: any,
  subtitle?: string,
  dataSource?: string,
): Promise<Uint8Array> {
  const summaryItemCount = countSummaryItems(result);
  const pageCount = calculatePageCount(result.rows.length, summaryItemCount);
  const template = buildReportTemplate(pageCount, summaryItemCount);
  const inputs = buildReportInputs({ title, subtitle, result, dataSource }, orgData);

  const pdf = await generate({
    template,
    inputs,
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}
