/**
 * PDF generation orchestrator.
 * Assembles template + data + plugins → calls pdfme generate() → returns PDF buffer.
 */
import { generate } from "@pdfme/generator";
import { gearflowPlugins } from "./plugins";
import { getPdfmeFonts } from "./fonts";
import { buildDocumentData } from "./build-document-data";
import { getTemplateBuilder } from "./templates";
import type { DocumentType, DocumentData } from "./types";

/**
 * Generate a PDF document for a project.
 *
 * @param projectId - The project to generate a document for
 * @param organizationId - The organization the project belongs to
 * @param docType - The type of document to generate
 * @param callSheetDate - Optional date for call sheet (picks crew shifts for that day)
 * @returns PDF as Uint8Array
 */
export async function generatePdf(
  projectId: string,
  organizationId: string,
  docType: DocumentType,
  callSheetDate?: Date
): Promise<Uint8Array> {
  // 1. Build data contract
  const data = await buildDocumentData(projectId, organizationId, docType, callSheetDate);

  // 2. Get template + build inputs
  const { buildTemplate, buildInputs } = getTemplateBuilder(docType);
  const template = buildTemplate();
  const inputs = buildInputs(data, callSheetDate);

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
