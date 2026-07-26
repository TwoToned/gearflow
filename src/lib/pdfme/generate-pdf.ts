/**
 * PDF generation orchestrator.
 *
 * One pipeline: build data → compose (fixed layout, paginated) → render.
 * The 5 project document types (quote, invoice, packing-list, return-sheet,
 * delivery-docket) go through `composeDocument()`. Call sheets use their own
 * service-based builder (`templates/call-sheet-services.ts`); T&T reports use
 * their own single-purpose builders (`templates/tt-*.ts`).
 */
import { buildDocumentData } from "./build-document-data";
import { composeDocument } from "./document-composer";
import { DOCUMENT_LAYOUTS, type ProjectDocumentType } from "./document-layouts";
import { renderPdfTemplate } from "./pdf-render";
import { getTtReportBuilder } from "./templates";
import type { TestTagReportType } from "./types";

/**
 * Generate a PDF document for a project.
 *
 * @param projectId - The project to generate a document for
 * @param organizationId - The organization the project belongs to
 * @param docType - The type of document to generate
 * @returns PDF as Uint8Array
 */
export async function generatePdf(
  projectId: string,
  organizationId: string,
  docType: ProjectDocumentType,
): Promise<Uint8Array> {
  const layout = DOCUMENT_LAYOUTS[docType];
  const data = await buildDocumentData(projectId, organizationId, docType, undefined, {
    expandProjectGroups: layout.expandProjectGroups,
  });

  const { template, inputs } = composeDocument(docType, data, data.org_document_color);
  return renderPdfTemplate(template, inputs);
}

/**
 * Generate a call sheet PDF.
 * Queries project services directly, groups by date, shows crew per service.
 * Each date gets a section header. Each row: crew member, service, role, call, wrap, notes.
 * Automatically paginates across multiple pages.
 */
export async function generateCallSheetPdf(
  projectId: string,
  organizationId: string,
  options: {
    callSheetDates?: Date[];
    allDates?: boolean;
    crewMemberId?: string;
    crewRoleId?: string;
  },
): Promise<Uint8Array> {
  const {
    buildCallSheetFromServices,
  } = await import("./templates/call-sheet-services");

  return buildCallSheetFromServices(projectId, organizationId, options);
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

  return renderPdfTemplate(template, [inputs]);
}
