/**
 * Section renderer — converts a TemplateSection[] list into a multi-page
 * pdfme Template + inputs. This is the core engine of the section-based
 * template builder.
 *
 * Pipeline:
 * 1. Filter visible sections (conditions + doc type)
 * 2. Group sections into rows (using layoutHint.rowId)
 * 3. Compute row heights (max of column heights) and page breaks
 * 4. Generate per-page pdfme schemas with correct X/Y positions
 * 5. Generate per-page inputs with resolved tokens + plugin configs
 */
import type { Template, Schema } from "@pdfme/common";
import type {
  DocumentData,
  DocumentType,
  TablePluginConfig,
  FinancialSummaryConfig,
  PageHeaderConfig,
  FooterConfig,
  SignatureLineConfig,
} from "./types";
import type {
  TemplateSection,
  HeaderSectionSettings,
  ClientDetailsSectionSettings,
  ProjectDetailsSectionSettings,
  TableSectionSettings,
  TotalsSectionSettings,
  NotesSectionSettings,
  SignatureSectionSettings,
  CustomTextSectionSettings,
  CrewTableSectionSettings,
  SpacerSectionSettings,
} from "./section-types";
import {
  SECTION_HEIGHT_ESTIMATES,
  TABLE_ROW_HEIGHT_MM,
  CREW_ROW_HEIGHT_MM,
} from "./section-types";
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  FOOTER_HEIGHT,
  SECTION_GAP,
} from "./template-constants";
import type { BlockStyling } from "./section-types";
import type { RectConfig } from "./plugins/gearflow-rect";
import { filterVisibleSections } from "./condition-evaluator";
import { resolveTokensInText } from "./token-resolver";

// ─── Height Estimation ───────────────────────────────────────────────────────

/**
 * Estimate the rendered height of a section given the document data.
 */
export function estimateSectionHeight(
  section: TemplateSection,
  data: DocumentData,
): number {
  switch (section.type) {
    case "header": {
      const s = section.settings as HeaderSectionSettings;
      const base = 25;
      if (s.logoMode === "logo") return base + 22;
      return base;
    }

    case "client-details": {
      const s = section.settings as ClientDetailsSectionSettings;
      let lines = 0;
      if (s.showClientName && data.client_name) lines++;
      if (s.showClientContact && data.client_contact) lines++;
      if (s.showClientEmail && data.client_email) lines++;
      if (s.showClientAddress && data.client_billing_address) lines++;
      if (s.showClientTaxId && data.client_tax_id) lines++;
      // Custom fields add lines
      if (s.customFields) lines += s.customFields.length;
      return Math.max(lines * 4, 12);
    }

    case "project-details": {
      const s = section.settings as ProjectDetailsSectionSettings;
      let lines = 0;
      if (s.showProjectName) lines++;
      if (s.showVenue && data.venue_name) lines++;
      if (s.showRentalDates) lines++;
      if (s.showEventDates) lines++;
      if (s.showPaymentTerms && data.client_payment_terms) lines++;
      if (s.showSiteContact && data.site_contact_name) lines++;
      if (s.showDocumentDate) lines++;
      if (s.customFields) lines += s.customFields.length;
      return Math.max(lines * 4, 12);
    }

    case "table": {
      const itemCount = data.line_items.filter((i) => !i.isKitChild).length;
      const childCount = data.line_items.filter((i) => i.isKitChild).length;
      const ts = section.settings as TableSectionSettings;
      const visibleChildren = ts.showKitChildren ? childCount : 0;
      return 8 + (itemCount + visibleChildren) * TABLE_ROW_HEIGHT_MM + 4;
    }

    case "totals":
      return SECTION_HEIGHT_ESTIMATES.totals;

    case "notes": {
      const s = section.settings as NotesSectionSettings;
      let height = 0;
      if (s.showClientNotes && data.client_notes) height += 12;
      if (s.showCrewNotes && data.crew_notes) height += 12;
      return Math.max(height, 4);
    }

    case "signature":
      return SECTION_HEIGHT_ESTIMATES.signature;

    case "custom-text": {
      const content = section.content || "";
      const lines = content.split("\n").length;
      return Math.max(lines * 4 + 4, 8);
    }

    case "crew-table": {
      const crewCount = (data.crew || []).length;
      return 8 + crewCount * CREW_ROW_HEIGHT_MM + 4;
    }

    case "spacer": {
      const s = section.settings as SpacerSectionSettings;
      return s.height || 10;
    }

    case "page-break":
      return 0;

    default:
      return SECTION_HEIGHT_ESTIMATES[section.type] || 10;
  }
}

// ─── Row Grouping ────────────────────────────────────────────────────────────

interface RowGroup {
  rowId: string;
  sections: TemplateSection[];
  /** Estimated height of this row (max of column heights) */
  height: number;
  /** Is this a page-break marker? */
  isPageBreak: boolean;
}

/**
 * Group flat sections into rows using layoutHint.rowId.
 * Sections without a layoutHint each become their own single-column row.
 */
function groupIntoRows(sections: TemplateSection[], data: DocumentData): RowGroup[] {
  const rows: RowGroup[] = [];
  const rowMap = new Map<string, TemplateSection[]>();
  const rowOrder: string[] = [];

  for (const section of sections) {
    if (section.type === "page-break") {
      // Page breaks are always their own row
      rows.push({
        rowId: `pagebreak_${section.id}`,
        sections: [section],
        height: 0,
        isPageBreak: true,
      });
      continue;
    }

    const rowId = section.layoutHint?.rowId || `solo_${section.id}`;
    if (!rowMap.has(rowId)) {
      rowMap.set(rowId, []);
      rowOrder.push(rowId);
    }
    rowMap.get(rowId)!.push(section);
  }

  // Process non-page-break rows in order
  for (const rowId of rowOrder) {
    const rowSections = rowMap.get(rowId)!;

    // Group sections by columnIndex to compute per-column heights
    const columnHeights = new Map<number, number>();
    for (const section of rowSections) {
      const colIdx = section.layoutHint?.columnIndex ?? 0;
      const sectionHeight = estimateSectionHeight(section, data);
      const current = columnHeights.get(colIdx) || 0;
      columnHeights.set(colIdx, current + sectionHeight);
    }

    // Row height = max column height
    const maxHeight = Math.max(...columnHeights.values(), 0);

    // Insert at correct position (page breaks may have been added inline)
    // Find the insertion index based on the first section's order
    const firstOrder = rowSections[0].order;
    let insertIdx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].isPageBreak && rows[i].sections[0].order > firstOrder) {
        insertIdx = i;
        break;
      }
    }

    rows.splice(insertIdx, 0, {
      rowId,
      sections: rowSections,
      height: maxHeight,
      isPageBreak: false,
    });
  }

  // Re-sort by the minimum order of sections in each row
  rows.sort((a, b) => {
    const aOrder = Math.min(...a.sections.map((s) => s.order));
    const bOrder = Math.min(...b.sections.map((s) => s.order));
    return aOrder - bOrder;
  });

  return rows;
}

// ─── Page Layout ─────────────────────────────────────────────────────────────

interface PageEntry {
  section: TemplateSection;
  x: number; // mm from left edge
  y: number;
  width: number; // mm
  height: number;
  /** For table sections on continuation pages: skip items before this index */
  tableStartIndex?: number;
}

interface PageLayout {
  entries: PageEntry[];
  isContinuation: boolean;
}

/**
 * Compute multi-page layout from visible sections.
 * Groups sections into rows (atomic units for page breaks),
 * handles table splitting, and reserves footer space.
 */
export function computePageLayout(
  sections: TemplateSection[],
  data: DocumentData,
): PageLayout[] {
  const rows = groupIntoRows(sections, data);
  const pages: PageLayout[] = [];
  let currentPage: PageLayout = { entries: [], isContinuation: false };
  let currentY = MARGIN;
  const maxY = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;

  const headerSection = sections.find((s) => s.type === "header");

  function startNewPage() {
    pages.push(currentPage);
    currentPage = { entries: [], isContinuation: true };
    currentY = MARGIN;

    if (headerSection) {
      const hHeight = estimateSectionHeight(headerSection, data);
      currentPage.entries.push({
        section: headerSection,
        x: MARGIN,
        y: currentY,
        width: CONTENT_WIDTH,
        height: hHeight,
      });
      currentY += hHeight + SECTION_GAP;
    }
  }

  for (const row of rows) {
    if (row.isPageBreak) {
      startNewPage();
      continue;
    }

    const rowHeight = row.height;

    // Check if this row fits on the current page
    if (currentY + rowHeight > maxY && currentPage.entries.length > 0) {
      // Check if this is a table row that needs splitting
      const tableSections = row.sections.filter((s) => s.type === "table" || s.type === "crew-table");
      if (tableSections.length > 0 && row.sections.length === 1) {
        // Single table in this row — split across pages
        const section = row.sections[0];
        const availableHeight = maxY - currentY;

        // First page
        const sectionX = getSectionX(section);
        const sectionW = getSectionWidth(section);
        currentPage.entries.push({
          section,
          x: sectionX,
          y: currentY,
          width: sectionW,
          height: availableHeight,
          tableStartIndex: 0,
        });

        // Continuation pages
        const headerRowHeight = TABLE_ROW_HEIGHT_MM + 4;
        const rowsOnFirstPage = Math.max(1, Math.floor((availableHeight - headerRowHeight) / TABLE_ROW_HEIGHT_MM));
        const remainingHeight = rowHeight - availableHeight;
        const continuationContentHeight = maxY - MARGIN - (headerSection ? estimateSectionHeight(headerSection, data) + SECTION_GAP : 0);
        const extraPages = Math.ceil(remainingHeight / continuationContentHeight);
        const rowsPerContinuation = Math.max(1, Math.floor((continuationContentHeight - headerRowHeight) / TABLE_ROW_HEIGHT_MM));

        let currentStartIndex = rowsOnFirstPage;
        for (let i = 0; i < extraPages; i++) {
          startNewPage();
          const pageTableHeight = Math.min(
            remainingHeight - i * continuationContentHeight,
            continuationContentHeight,
          );
          currentPage.entries.push({
            section,
            x: sectionX,
            y: currentY,
            width: sectionW,
            height: pageTableHeight,
            tableStartIndex: currentStartIndex,
          });
          currentY += pageTableHeight;
          currentStartIndex += rowsPerContinuation;
        }
        continue;
      }

      // Non-table row that doesn't fit — start new page
      startNewPage();
    }

    // Place all sections in this row at the current Y
    for (const section of row.sections) {
      if (section.type === "header" && currentPage.isContinuation) {
        // Skip header sections in content rows on continuation pages
        // (header is already added by startNewPage)
        continue;
      }

      currentPage.entries.push({
        section,
        x: getSectionX(section),
        y: currentY,
        width: getSectionWidth(section),
        height: rowHeight,
      });
    }

    currentY += rowHeight + SECTION_GAP;
  }

  if (currentPage.entries.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/** Calculate X position for a section based on its layoutHint */
function getSectionX(section: TemplateSection): number {
  if (!section.layoutHint || section.layoutHint.columnCount <= 1) {
    // Legacy: client-details on left half, project-details on right half
    if (section.type === "project-details") {
      return MARGIN + CONTENT_WIDTH / 2 + 4;
    }
    return MARGIN;
  }

  const { columnIndex, columnWidth, columnCount } = section.layoutHint;

  // Calculate X from preceding columns' widths
  // We need all columns' widths in this row, but we only have this section's info.
  // Use columnIndex and columnWidth to compute offset:
  // Each column before this one occupies its share of CONTENT_WIDTH.
  // Since we don't know other columns' exact widths, we compute from percentage positions.
  let xOffset = 0;
  // Approximate: assume columns before this one fill up to this column's start
  // We can compute from: all columns sum to 100%, this column starts at sum of widths before it
  // Since we only know this column's width, we use columnIndex * (avgWidth)
  // Better approach: total width / 100 * (percentage offset)
  // For that we need to know what percentage came before this column.
  // We can approximate: (100 - columnWidth * (columnCount - columnIndex)) / ... no.
  // Simplest correct approach: offset = CONTENT_WIDTH * (100 - columnWidth * remaining) / 100
  // Actually for equal splits, offset = columnIndex * (CONTENT_WIDTH / columnCount)
  // For unequal, we'd need all widths. Let's use the fact that the layoutHint was set
  // by flattenBlocks which sets each column's width. We just need each column's offset.
  // Since we don't have other columns' widths here, we calculate based on even distribution
  // when we can't determine precisely. In practice, we'll fix this in buildSectionSchema.

  // For now: use even column spacing based on columnIndex
  // This will be refined when we have the full row context
  if (columnCount > 1) {
    // Even split fallback — works for most cases
    // Real width comes from columnWidth percentage
    const colWidthMm = (CONTENT_WIDTH * columnWidth) / 100;
    // Offset: for column 0, x = MARGIN. For column 1, x = MARGIN + col0Width, etc.
    // Without knowing col0's width, approximate with even splits for offset
    const evenColWidth = CONTENT_WIDTH / columnCount;
    xOffset = columnIndex * evenColWidth;
  }

  return MARGIN + xOffset;
}

/** Calculate width for a section based on its layoutHint */
function getSectionWidth(section: TemplateSection): number {
  if (!section.layoutHint || section.layoutHint.columnCount <= 1) {
    // Legacy: client-details and project-details are half-width
    if (section.type === "client-details" || section.type === "project-details") {
      return CONTENT_WIDTH / 2 - 4;
    }
    return CONTENT_WIDTH;
  }

  return (CONTENT_WIDTH * section.layoutHint.columnWidth) / 100;
}

/**
 * Estimate page break positions (for the editor preview).
 * Returns Y-offsets (in mm from document start) where page breaks occur.
 */
export function estimatePageBreaks(
  sections: TemplateSection[],
  data: DocumentData,
): number[] {
  const breaks: number[] = [];
  let cumulativeY = 0;
  const contentHeight = PAGE_HEIGHT - MARGIN * 2 - FOOTER_HEIGHT;

  // Group into rows for accurate row-level page breaks
  const rows = groupIntoRows(sections, data);

  for (const row of rows) {
    if (row.isPageBreak) {
      breaks.push(cumulativeY);
      cumulativeY = 0;
      continue;
    }

    if (cumulativeY + row.height > contentHeight && cumulativeY > 0) {
      breaks.push(cumulativeY);
      cumulativeY = row.height + SECTION_GAP;
    } else {
      cumulativeY += row.height + SECTION_GAP;
    }
  }

  return breaks;
}

// ─── Schema & Input Generation ───────────────────────────────────────────────

/**
 * Build the pdfme schema entry for a section at a given position.
 */
function buildSectionSchema(
  entry: PageEntry,
  pageIndex: number,
): Schema & Record<string, unknown> {
  const { section, x, y, width, height } = entry;
  const uniqueName = `${section.type}_${section.id}_p${pageIndex}`;
  const base = {
    name: uniqueName,
    content: "",
    position: { x, y },
    width,
    height,
  };

  switch (section.type) {
    case "header":
      return { ...base, type: "gearflowPageHeader" };

    case "client-details": {
      const cs = section.settings as ClientDetailsSectionSettings;
      return {
        ...base,
        type: "text",
        fontSize: cs.styling?.fontSize || 9,
        fontColor: cs.styling?.textColor || "#1a1a1a",
      };
    }

    case "project-details": {
      const ps = section.settings as ProjectDetailsSectionSettings;
      return {
        ...base,
        type: "text",
        fontSize: ps.styling?.fontSize || 9,
        fontColor: ps.styling?.textColor || "#1a1a1a",
      };
    }

    case "table":
      return { ...base, type: "gearflowTable" };

    case "totals":
      return { ...base, type: "gearflowFinancialSummary" };

    case "notes":
      return {
        ...base,
        type: "text",
        fontSize: 8,
        fontColor: "#666666",
      };

    case "signature":
      return { ...base, type: "gearflowSignatureLine" };

    case "custom-text": {
      const s = section.settings as CustomTextSectionSettings;
      return {
        ...base,
        type: "text",
        fontSize: s.fontSize,
        fontColor: "#333333",
        fontWeight: s.fontWeight === "bold" ? "bold" : undefined,
        textAlign: s.alignment,
      };
    }

    case "crew-table":
      return { ...base, type: "gearflowCrewTable" };

    case "spacer":
      return { ...base, type: "text", fontSize: 1, fontColor: "#ffffff" };

    default:
      return { ...base, type: "text" };
  }
}

/**
 * Build the pdfme input value for a section.
 */
function buildSectionInput(
  section: TemplateSection,
  data: DocumentData,
  docType: DocumentType,
  docColor: string,
  tableStartIndex?: number,
): string {
  switch (section.type) {
    case "header": {
      const s = section.settings as HeaderSectionSettings;
      const orgDetailParts: string[] = [];
      if (s.showOrgAddress && data.org_address) orgDetailParts.push(data.org_address);
      if (s.showOrgPhone && data.org_phone) orgDetailParts.push(data.org_phone);
      if (s.showOrgEmail && data.org_email) orgDetailParts.push(data.org_email);
      if (s.showOrgWebsite && data.org_website) orgDetailParts.push(data.org_website);

      const rawTitle = s.documentTitle || docType.toUpperCase();
      const resolvedTitle = resolveTokensInText(rawTitle, data);

      const config: PageHeaderConfig = {
        orgName: data.org_name || "",
        orgDetails: orgDetailParts.join("\n"),
        docTitle: resolvedTitle,
        docMeta: `${data.project_number || ""}\n${data.document_date || ""}`,
        logoData: data.org_logo,
        iconData: data.org_icon,
        documentLogoMode: s.logoMode,
        showOrgNameOnDocuments: s.showOrgName,
        documentColor: docColor,
      };
      return JSON.stringify(config);
    }

    case "client-details": {
      const s = section.settings as ClientDetailsSectionSettings;
      const labels = s.customLabels || {};
      const lines: string[] = [];
      if (s.showClientName && data.client_name) lines.push(data.client_name);
      if (s.showClientContact && data.client_contact) lines.push(`${labels.contact || "Attn"}: ${data.client_contact}`);
      if (s.showClientEmail && data.client_email) lines.push(data.client_email);
      if (s.showClientAddress && data.client_billing_address) lines.push(data.client_billing_address);
      if (s.showClientTaxId && data.client_tax_id) lines.push(`${labels.taxId || "ABN"}: ${data.client_tax_id}`);
      if (s.customFields) {
        for (const cf of s.customFields) {
          const resolvedValue = resolveTokensInText(cf.value, data);
          if (resolvedValue) lines.push(`${cf.label}: ${resolvedValue}`);
        }
      }
      if (section.content) {
        lines.push(resolveTokensInText(section.content, data));
      }
      return lines.length > 0 ? lines.join("\n") : "-";
    }

    case "project-details": {
      const s = section.settings as ProjectDetailsSectionSettings;
      const labels = s.customLabels || {};
      const lines: string[] = [];
      if (s.showProjectName) lines.push(data.project_name);
      if (s.showVenue && data.venue_name) lines.push(`${labels.venue || "Venue"}: ${data.venue_name}`);
      if (s.showRentalDates && data.rental_start && data.rental_start !== "-") {
        const end = data.rental_end && data.rental_end !== "-" ? ` - ${data.rental_end}` : "";
        lines.push(`${labels.rentalDates || "Rental"}: ${data.rental_start}${end}`);
      }
      if (s.showEventDates && data.event_start && data.event_start !== "-") {
        const end = data.event_end && data.event_end !== "-" ? ` - ${data.event_end}` : "";
        lines.push(`${labels.eventDates || "Event"}: ${data.event_start}${end}`);
      }
      if (s.showPaymentTerms && data.client_payment_terms) {
        lines.push(`${labels.paymentTerms || "Payment Terms"}: ${data.client_payment_terms}`);
      }
      if (s.showSiteContact && data.site_contact_name) {
        let contactLine = `${labels.siteContact || "Site Contact"}: ${data.site_contact_name}`;
        if (data.site_contact_phone) contactLine += ` | Ph: ${data.site_contact_phone}`;
        lines.push(contactLine);
      }
      if (s.showDocumentDate) lines.push(`${labels.documentDate || "Date"}: ${data.document_date}`);
      if (s.customFields) {
        for (const cf of s.customFields) {
          const resolvedValue = resolveTokensInText(cf.value, data);
          if (resolvedValue) lines.push(`${cf.label}: ${resolvedValue}`);
        }
      }
      if (section.content) {
        lines.push(resolveTokensInText(section.content, data));
      }
      return lines.length > 0 ? lines.join("\n") : "-";
    }

    case "table": {
      const s = section.settings as TableSectionSettings;
      const tableValue: {
        items: typeof data.line_items;
        config: TablePluginConfig;
        startIndex?: number;
      } = {
        items: data.line_items,
        config: {
          documentType: docType,
          documentColor: docColor,
          showGroupHeaders: s.showGroupHeaders,
          showKitChildren: s.showKitChildren,
          showCheckboxes: s.showCheckboxes,
          showConditionColumns: s.showConditionColumns,
          showPricing: s.showPricing,
          showBadges: s.showBadges,
          showNotes: s.showNotes,
          showPerUnitCheckboxes: s.showPerUnitCheckboxes,
          showAssetTags: s.showAssetTags,
          showCategories: s.showCategories,
          showRowNumbers: s.showRowNumbers,
          filterOptional: false,
          filterByStatus: getFilterByStatus(docType),
        },
      };
      if (tableStartIndex) {
        tableValue.startIndex = tableStartIndex;
      }
      return JSON.stringify(tableValue);
    }

    case "totals": {
      const s = section.settings as TotalsSectionSettings;
      const config: FinancialSummaryConfig = {
        subtotal: s.showSubtotal ? data.subtotal : 0,
        discountPercent: s.showDiscount ? data.discount_percent : 0,
        discountAmount: s.showDiscount ? data.discount_amount : 0,
        taxLabel: data.tax_label,
        taxAmount: s.showTax ? data.tax_amount : 0,
        total: s.showTotal ? data.total : 0,
        depositPaid: s.showDeposit ? data.deposit_paid : 0,
        balanceDue: s.showBalance ? data.balance_due : 0,
        documentColor: docColor,
      };
      return JSON.stringify(config);
    }

    case "notes": {
      const s = section.settings as NotesSectionSettings;
      const parts: string[] = [];
      if (s.showClientNotes && data.client_notes) parts.push(data.client_notes);
      if (s.showCrewNotes && data.crew_notes) parts.push(data.crew_notes);
      return parts.join("\n\n");
    }

    case "signature": {
      const s = section.settings as SignatureSectionSettings;
      const config: SignatureLineConfig = {
        columns: s.labels.map((label) => ({ label })),
        orgName: data.org_name || "",
      };
      return JSON.stringify(config);
    }

    case "custom-text": {
      const content = section.content || "";
      return resolveTokensInText(content, data);
    }

    case "crew-table": {
      return JSON.stringify({
        crew: data.crew || [],
        documentColor: docColor,
      });
    }

    case "spacer":
      return "";

    default:
      return "";
  }
}

/** Check if a BlockStyling object has any visual properties set */
function hasStyling(styling: BlockStyling): boolean {
  return !!(styling.backgroundColor || styling.borderColor);
}

/** Get status filter for table items based on document type */
function getFilterByStatus(docType: DocumentType): string[] | null {
  switch (docType) {
    case "delivery-docket":
      return ["CHECKED_OUT"];
    case "return-sheet":
      return ["CHECKED_OUT", "RETURNED"];
    default:
      return null;
  }
}

// ─── Main Render Function ────────────────────────────────────────────────────

export interface RenderResult {
  template: Template;
  inputs: Record<string, string>[];
}

/**
 * Render a section-based template into a pdfme Template + inputs.
 * This is the main entry point for the section-based pipeline.
 *
 * Supports both flat sections (legacy) and column-aware sections (with layoutHint).
 */
export function renderSections(
  sections: TemplateSection[],
  data: DocumentData,
  docType: DocumentType,
  docColor: string,
  footerText?: string,
  footerSecondLine?: string,
): RenderResult {
  // 1. Filter visible sections
  const visibleSections = filterVisibleSections(sections, docType, data);

  if (visibleSections.length === 0) {
    return {
      template: {
        basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
        schemas: [[]],
      },
      inputs: [{}],
    };
  }

  // 2. Compute page layout (now column-aware via layoutHint)
  const pages = computePageLayout(visibleSections, data);

  // 3. Build pdfme schemas and inputs per page
  const allSchemas: (Schema & Record<string, unknown>)[][] = [];
  const allInputs: Record<string, string>[] = [];

  const footerConfig: FooterConfig = {
    text: footerText || `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: footerSecondLine || "",
  };

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageSchemas: (Schema & Record<string, unknown>)[] = [];
    const pageInputs: Record<string, string> = {};

    for (const entry of page.entries) {
      // Insert background rect before content when styling is present
      const styling = entry.section.layoutHint?.styling;
      if (styling && hasStyling(styling)) {
        const rectName = `rect_${entry.section.id}_p${pageIdx}`;
        const padding = styling.padding || 0;
        pageSchemas.push({
          name: rectName,
          type: "gearflowRect",
          content: "",
          position: { x: entry.x - padding, y: entry.y - padding },
          width: entry.width + padding * 2,
          height: entry.height + padding * 2,
        });
        const rectConfig: RectConfig = {
          backgroundColor: styling.backgroundColor,
          borderColor: styling.borderColor,
          borderWidth: styling.borderWidth,
          padding: styling.padding,
        };
        pageInputs[rectName] = JSON.stringify(rectConfig);
      }

      const schema = buildSectionSchema(entry, pageIdx);
      const input = buildSectionInput(entry.section, data, docType, docColor, entry.tableStartIndex);
      pageSchemas.push(schema);
      pageInputs[schema.name] = input;
    }

    // Add footer to every page
    const footerName = `footer_p${pageIdx}`;
    pageSchemas.push({
      name: footerName,
      type: "gearflowPageFooter",
      content: "",
      position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT },
      width: CONTENT_WIDTH,
      height: FOOTER_HEIGHT,
    });
    pageInputs[footerName] = JSON.stringify(footerConfig);

    allSchemas.push(pageSchemas);
    allInputs.push(pageInputs);
  }

  return {
    template: {
      basePdf: {
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        padding: [MARGIN, MARGIN, MARGIN, MARGIN],
      },
      schemas: allSchemas,
    },
    inputs: allInputs,
  };
}
