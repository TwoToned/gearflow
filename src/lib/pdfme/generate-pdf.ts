/**
 * PDF generation orchestrator.
 * Assembles template + data + plugins → calls pdfme generate() → returns PDF buffer.
 *
 * Checks for org-specific custom default templates before falling back to system defaults.
 */
import { generate } from "@pdfme/generator";
import type { Template } from "@pdfme/common";
import { prisma } from "@/lib/prisma";
import { gearflowPlugins } from "./plugins";
import { getPdfmeFonts } from "./fonts";
import { buildDocumentData } from "./build-document-data";
import { getTemplateBuilder, getTtReportBuilder } from "./templates";
import type { DocumentType, DocumentData, TestTagReportType } from "./types";
import type { TemplateSettings } from "./template-settings";

/**
 * Try to load a specific template or the org's custom default for a document type.
 * Template selection priority: templateId → project override → org default → system default.
 * Returns null if no custom template found (falls back to system default).
 */
async function getCustomTemplate(
  organizationId: string,
  docType: DocumentType,
  templateId?: string,
): Promise<{ template: Template; settings: TemplateSettings | null } | null> {
  // If a specific templateId is provided, load that
  if (templateId) {
    const specific = await prisma.documentTemplate.findFirst({
      where: {
        id: templateId,
        organizationId,
        isDraft: false,
      },
    });
    if (specific) {
      return {
        template: {
          basePdf: JSON.parse(specific.basePdf),
          schemas: JSON.parse(specific.schemas),
        },
        settings: specific.settings ? JSON.parse(specific.settings) : null,
      };
    }
  }

  // Otherwise, look for org's default template for this doc type
  const custom = await prisma.documentTemplate.findFirst({
    where: {
      organizationId,
      type: docType,
      isDefault: true,
      isDraft: false,
    },
  });

  if (!custom) return null;

  return {
    template: {
      basePdf: JSON.parse(custom.basePdf),
      schemas: JSON.parse(custom.schemas),
    },
    settings: custom.settings ? JSON.parse(custom.settings) : null,
  };
}

/**
 * Generate a PDF document for a project.
 *
 * Template selection: templateId → org default → system default.
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

  // 2. Check for custom template, fall back to system default
  const customResult = await getCustomTemplate(organizationId, docType, templateId);

  const { buildTemplate, buildInputs } = getTemplateBuilder(docType);
  const templateSettings = customResult?.settings || undefined;
  const inputs = buildInputs(data, callSheetDate, templateSettings);

  let template: Template;
  if (customResult) {
    template = customResult.template;
  } else {
    template = buildTemplate(templateSettings);
  }

  // 3. Generate PDF via pdfme
  const pdf = await generate({
    template,
    inputs: [inputs],
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
