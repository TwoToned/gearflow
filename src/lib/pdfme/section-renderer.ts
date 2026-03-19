/**
 * Section renderer — converts a TemplateSection[] list into a multi-page
 * pdfme Template + inputs. This is the core engine of the section-based
 * template builder.
 *
 * Pipeline:
 * 1. Filter visible sections (conditions + doc type)
 * 2. Compute section heights and page breaks
 * 3. Generate per-page pdfme schemas with correct Y positions
 * 4. Generate per-page inputs with resolved tokens + plugin configs
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
  PAGE_CONTENT_HEIGHT_MM,
} from "./section-types";
import { filterVisibleSections } from "./condition-evaluator";
import { resolveTokensInText } from "./token-resolver";

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm
const FOOTER_HEIGHT = 10; // mm

// ─── Height Estimation ───────────────────────────────────────────────────────

interface SectionWithHeight {
  section: TemplateSection;
  estimatedHeight: number; // mm
}

/**
 * Estimate the rendered height of a section given the document data.
 */
function estimateSectionHeight(
  section: TemplateSection,
  data: DocumentData,
): number {
  switch (section.type) {
    case "header": {
      const s = section.settings as HeaderSectionSettings;
      const base = 25;
      // Logo mode adds height
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
      return Math.max(lines * 4, 12);
    }

    case "table": {
      // Count visible items
      const itemCount = data.line_items.filter((i) => !i.isKitChild).length;
      const childCount = data.line_items.filter((i) => i.isKitChild).length;
      const ts = section.settings as TableSectionSettings;
      const visibleChildren = ts.showKitChildren ? childCount : 0;
      // Header + rows + some padding
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
      const crewCount = data.crew.length;
      return 8 + crewCount * CREW_ROW_HEIGHT_MM + 4;
    }

    case "spacer": {
      const s = section.settings as SpacerSectionSettings;
      return s.height || 10;
    }

    case "page-break":
      return 0; // Handled as a page break marker

    default:
      return SECTION_HEIGHT_ESTIMATES[section.type] || 10;
  }
}

// ─── Page Layout ─────────────────────────────────────────────────────────────

interface PageLayout {
  /** Sections on this page with their Y positions */
  entries: { section: TemplateSection; y: number; height: number }[];
  /** Whether this is a continuation page (shows continuation header) */
  isContinuation: boolean;
  /** Whether the table is split across this page */
  tableSlice?: { startIndex: number; endIndex: number };
}

/**
 * Compute multi-page layout from visible sections.
 * Handles page breaks, table splitting, and footer reservation.
 */
export function computePageLayout(
  sections: TemplateSection[],
  data: DocumentData,
): PageLayout[] {
  const pages: PageLayout[] = [];
  let currentPage: PageLayout = { entries: [], isContinuation: false };
  let currentY = MARGIN;
  const maxY = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT; // Reserve space for footer

  // Find the header and footer sections for repetition on continuation pages
  const headerSection = sections.find((s) => s.type === "header");

  for (const section of sections) {
    if (section.type === "page-break") {
      // Force a new page
      pages.push(currentPage);
      currentPage = { entries: [], isContinuation: true };
      currentY = MARGIN;
      // Repeat header on continuation pages
      if (headerSection) {
        const hHeight = estimateSectionHeight(headerSection, data);
        currentPage.entries.push({ section: headerSection, y: currentY, height: hHeight });
        currentY += hHeight + 2;
      }
      continue;
    }

    const sectionHeight = estimateSectionHeight(section, data);

    // Check if this section fits on the current page
    if (currentY + sectionHeight > maxY && currentPage.entries.length > 0) {
      // Section doesn't fit — start a new page
      pages.push(currentPage);
      currentPage = { entries: [], isContinuation: true };
      currentY = MARGIN;

      // Repeat header on continuation pages
      if (headerSection && section.type !== "header") {
        const hHeight = estimateSectionHeight(headerSection, data);
        currentPage.entries.push({ section: headerSection, y: currentY, height: hHeight });
        currentY += hHeight + 2;
      }
    }

    // Special handling for tables: if the table is taller than available space,
    // we split it across pages. The table plugin handles this internally via
    // its own item slicing — we just need to ensure we allocate enough pages.
    if (section.type === "table" && sectionHeight > (maxY - currentY)) {
      // Table needs splitting — allocate remaining space on this page,
      // then create continuation pages as needed.
      // The table plugin will receive all items and draw what fits.
      // We set the height to fill the remaining page space.
      const availableHeight = maxY - currentY;
      currentPage.entries.push({ section, y: currentY, height: availableHeight });
      currentY = maxY; // Page is full

      // Calculate how many more pages the table needs
      const remainingHeight = sectionHeight - availableHeight;
      const continuationContentHeight = maxY - MARGIN - (headerSection ? estimateSectionHeight(headerSection, data) + 2 : 0);
      const extraPages = Math.ceil(remainingHeight / continuationContentHeight);

      for (let i = 0; i < extraPages; i++) {
        pages.push(currentPage);
        currentPage = { entries: [], isContinuation: true };
        currentY = MARGIN;

        if (headerSection) {
          const hHeight = estimateSectionHeight(headerSection, data);
          currentPage.entries.push({ section: headerSection, y: currentY, height: hHeight });
          currentY += hHeight + 2;
        }

        const pageTableHeight = Math.min(
          remainingHeight - i * continuationContentHeight,
          continuationContentHeight,
        );
        currentPage.entries.push({ section, y: currentY, height: pageTableHeight });
        currentY += pageTableHeight;
      }
      continue;
    }

    currentPage.entries.push({ section, y: currentY, height: sectionHeight });
    currentY += sectionHeight + 2; // 2mm gap between sections
  }

  // Push the last page
  if (currentPage.entries.length > 0) {
    pages.push(currentPage);
  }

  return pages;
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
  const contentHeight = PAGE_CONTENT_HEIGHT_MM - FOOTER_HEIGHT;

  for (const section of sections) {
    if (section.type === "page-break") {
      breaks.push(cumulativeY);
      cumulativeY = 0;
      continue;
    }

    const height = estimateSectionHeight(section, data);
    if (cumulativeY + height > contentHeight && cumulativeY > 0) {
      breaks.push(cumulativeY);
      cumulativeY = height + 2;
    } else {
      cumulativeY += height + 2;
    }
  }

  return breaks;
}

// ─── Schema & Input Generation ───────────────────────────────────────────────

/**
 * Build the pdfme schema entry for a section at a given Y position.
 */
function buildSectionSchema(
  section: TemplateSection,
  y: number,
  height: number,
  pageIndex: number,
): Schema & Record<string, unknown> {
  const uniqueName = `${section.type}_${section.id}_p${pageIndex}`;
  const base = {
    name: uniqueName,
    content: "",
    position: { x: MARGIN, y },
    width: CONTENT_W,
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
        width: CONTENT_W / 2 - 4,
        fontSize: cs.styling?.fontSize || 9,
        fontColor: cs.styling?.textColor || "#1a1a1a",
      };
    }

    case "project-details": {
      const ps = section.settings as ProjectDetailsSectionSettings;
      return {
        ...base,
        type: "text",
        position: { x: MARGIN + CONTENT_W / 2 + 4, y },
        width: CONTENT_W / 2 - 4,
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
      // Spacer is just empty space — no actual schema element
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
): string {
  switch (section.type) {
    case "header": {
      const s = section.settings as HeaderSectionSettings;
      const orgDetailParts: string[] = [];
      if (s.showOrgAddress && data.org_address) orgDetailParts.push(data.org_address);
      if (s.showOrgPhone && data.org_phone) orgDetailParts.push(data.org_phone);
      if (s.showOrgEmail && data.org_email) orgDetailParts.push(data.org_email);
      if (s.showOrgWebsite && data.org_website) orgDetailParts.push(data.org_website);

      // Resolve tokens in document title (e.g. "{project_name} Quote")
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
      // Append custom fields with token resolution
      if (s.customFields) {
        for (const cf of s.customFields) {
          const resolvedValue = resolveTokensInText(cf.value, data);
          if (resolvedValue) lines.push(`${cf.label}: ${resolvedValue}`);
        }
      }
      // Append section content if present
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
      // Append custom fields with token resolution
      if (s.customFields) {
        for (const cf of s.customFields) {
          const resolvedValue = resolveTokensInText(cf.value, data);
          if (resolvedValue) lines.push(`${cf.label}: ${resolvedValue}`);
        }
      }
      // Append section content if present
      if (section.content) {
        lines.push(resolveTokensInText(section.content, data));
      }
      return lines.length > 0 ? lines.join("\n") : "-";
    }

    case "table": {
      const s = section.settings as TableSectionSettings;
      const config: { items: typeof data.line_items; config: TablePluginConfig } = {
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
      return JSON.stringify(config);
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
        crew: data.crew,
        documentColor: docColor,
      });
    }

    case "spacer":
      return "";

    default:
      return "";
  }
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
 * @param sections - The ordered section list (from DocumentTemplate.sections)
 * @param data - The assembled document data
 * @param docType - The document type being generated
 * @param docColor - The accent color for the document
 * @param footerText - Footer text (from brand template or defaults)
 * @param footerSecondLine - Footer second line text
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
    // Return a single empty page
    return {
      template: {
        basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
        schemas: [[]],
      },
      inputs: [{}],
    };
  }

  // 2. Compute page layout
  const pages = computePageLayout(visibleSections, data);

  // 3. Build pdfme schemas and inputs per page
  const allSchemas: (Schema & Record<string, unknown>)[][] = [];
  const allInputs: Record<string, string>[] = [];

  // Footer config (same on every page)
  const footerConfig: FooterConfig = {
    text: footerText || `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: footerSecondLine || "",
  };

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageSchemas: (Schema & Record<string, unknown>)[] = [];
    const pageInputs: Record<string, string> = {};

    // Build schemas + inputs for each section on this page
    for (const entry of page.entries) {
      const schema = buildSectionSchema(entry.section, entry.y, entry.height, pageIdx);
      const input = buildSectionInput(entry.section, data, docType, docColor);
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
      width: CONTENT_W,
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
