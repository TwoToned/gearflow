/**
 * System default template for Project Timeline PDF.
 * Portrait A4 (210mm x 297mm). Date-grouped service rows rendered via gearflowDataTable.
 * Multi-page: rows are split across pages when content overflows.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableColumn, DataTableSection } from "../plugins/gearflow-data-table";
import { formatDate, formatCurrency } from "../plugins/helpers";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm

// Data table row/header heights in mm (must match gearflow-data-table.ts constants converted to mm)
const TABLE_ROW_HEIGHT_MM = 5; // ~14pt row height in mm
const TABLE_HEADER_HEIGHT_MM = 5.6; // ~16pt header in mm
const SECTION_HEADER_HEIGHT_MM = 6.3; // ~18pt section header in mm

// Layout positions
const HEADER_Y = MARGIN;
const HEADER_H = 25;
const INFO_Y = 42;
const INFO_H = 20;
const TABLE_START_Y = 66; // below header + info
const FOOTER_H = 10;
const TABLE_END_Y = PAGE_HEIGHT - MARGIN - FOOTER_H - 2; // leave room for footer
const TABLE_CONTENT_HEIGHT = TABLE_END_Y - TABLE_START_Y;

// Continuation pages start higher (no info block)
const CONT_TABLE_START_Y = HEADER_Y + HEADER_H + 4;
const CONT_TABLE_CONTENT_HEIGHT = TABLE_END_Y - CONT_TABLE_START_Y;

// Service types for display
const SERVICE_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

export interface TimelineService {
  id: string;
  type: string;
  title: string;
  status: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  address: string | null;
  notes: string | null;
  crewAssignments: Array<{
    crewMember: { firstName: string; lastName: string };
    status: string;
  }>;
  lineTotal: number | null;
  costTotal: number | null;
}

export interface TimelineSettings {
  showCrew: boolean;
  showLocation: boolean;
  showNotes: boolean;
  showCharge: boolean;
  showCost: boolean;
  showStatus: boolean;
}

export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
  showCrew: true,
  showLocation: true,
  showNotes: false,
  showCharge: false,
  showCost: false,
  showStatus: true,
};

/**
 * Build the columns array based on settings.
 */
function buildColumns(settings: TimelineSettings): DataTableColumn[] {
  const cols: DataTableColumn[] = [
    { key: "time", label: "Time", width: 2.5 },
    { key: "type", label: "Type", width: 1.5 },
    { key: "title", label: "Service", width: 3 },
  ];

  if (settings.showCrew) {
    cols.push({ key: "crew", label: "Crew", width: 3 });
  }
  if (settings.showLocation) {
    cols.push({ key: "location", label: "Location", width: 2.5 });
  }
  if (settings.showStatus) {
    cols.push({ key: "status", label: "Status", width: 1.5 });
  }
  if (settings.showCharge) {
    cols.push({ key: "charge", label: "Charge", width: 1.5, align: "right" });
  }
  if (settings.showCost) {
    cols.push({ key: "cost", label: "Cost", width: 1.5, align: "right" });
  }
  if (settings.showNotes) {
    cols.push({ key: "notes", label: "Notes", width: 2.5 });
  }

  return cols;
}

/**
 * Build date-grouped sections from services.
 */
function buildSections(
  services: TimelineService[],
  settings: TimelineSettings,
): DataTableSection[] {
  // Group services by date
  const groups = new Map<string, TimelineService[]>();
  for (const s of services) {
    const key = s.date ? new Date(s.date).toISOString().slice(0, 10) : "no-date";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const sortedKeys = Array.from(groups.keys()).sort();
  const sections: DataTableSection[] = [];

  for (const key of sortedKeys) {
    const dateLabel =
      key === "no-date"
        ? "Unscheduled"
        : formatDate(new Date(key + "T00:00:00").toISOString());

    const rows = groups.get(key)!.map((s) => {
      const typeLabel = SERVICE_TYPE_LABELS[s.type] || s.type;
      const time = [s.startTime, s.endTime].filter(Boolean).join(" - ");
      const crew = s.crewAssignments
        .map((ca) => `${ca.crewMember.firstName} ${ca.crewMember.lastName}`)
        .join(", ");

      const row: Record<string, string | number | null> = {
        time: time || "-",
        type: typeLabel,
        title: s.title || typeLabel,
        crew: crew || "-",
        location: s.address || "-",
        status: s.status.charAt(0) + s.status.slice(1).toLowerCase().replace(/_/g, " "),
        charge: s.lineTotal != null ? formatCurrency(Number(s.lineTotal)) : "-",
        cost: s.costTotal != null ? formatCurrency(Number(s.costTotal)) : "-",
        notes: s.notes || "-",
      };
      return row;
    });

    sections.push({ title: dateLabel, rows });
  }

  return sections;
}

/**
 * Split sections across pages. Each page gets a subset of sections/rows
 * that fit within the available height.
 */
function paginateSections(
  sections: DataTableSection[],
): DataTableSection[][] {
  const pages: DataTableSection[][] = [];
  let currentPageSections: DataTableSection[] = [];
  let currentHeight = TABLE_HEADER_HEIGHT_MM; // account for column headers
  let isFirstPage = true;
  const maxHeight = () => isFirstPage ? TABLE_CONTENT_HEIGHT : CONT_TABLE_CONTENT_HEIGHT;

  for (const section of sections) {
    const sectionHeaderH = SECTION_HEADER_HEIGHT_MM;
    const sectionRowsH = section.rows.length * TABLE_ROW_HEIGHT_MM;
    const totalSectionH = sectionHeaderH + sectionRowsH;

    // Does the whole section fit on the current page?
    if (currentHeight + totalSectionH <= maxHeight()) {
      currentPageSections.push(section);
      currentHeight += totalSectionH;
      continue;
    }

    // Section doesn't fit entirely. Split rows across pages.
    const availableForRows = maxHeight() - currentHeight - sectionHeaderH;
    const rowsThatFit = Math.max(0, Math.floor(availableForRows / TABLE_ROW_HEIGHT_MM));

    if (rowsThatFit > 0) {
      // Put some rows on this page
      currentPageSections.push({
        title: section.title,
        rows: section.rows.slice(0, rowsThatFit),
      });
      currentHeight += sectionHeaderH + rowsThatFit * TABLE_ROW_HEIGHT_MM;
    }

    // Start new page(s) for remaining rows
    let remainingRows = section.rows.slice(rowsThatFit);

    // Flush current page
    if (currentPageSections.length > 0) {
      pages.push(currentPageSections);
      currentPageSections = [];
      currentHeight = TABLE_HEADER_HEIGHT_MM;
      isFirstPage = false;
    }

    while (remainingRows.length > 0) {
      const contMaxH = CONT_TABLE_CONTENT_HEIGHT;
      const contAvailable = contMaxH - TABLE_HEADER_HEIGHT_MM - SECTION_HEADER_HEIGHT_MM;
      const contRowsFit = Math.max(1, Math.floor(contAvailable / TABLE_ROW_HEIGHT_MM));
      const batch = remainingRows.slice(0, contRowsFit);
      remainingRows = remainingRows.slice(contRowsFit);

      currentPageSections.push({
        title: remainingRows.length > 0 ? `${section.title} (cont.)` : section.title + (rowsThatFit > 0 ? " (cont.)" : ""),
        rows: batch,
      });
      currentHeight = TABLE_HEADER_HEIGHT_MM + SECTION_HEADER_HEIGHT_MM + batch.length * TABLE_ROW_HEIGHT_MM;

      if (remainingRows.length > 0) {
        pages.push(currentPageSections);
        currentPageSections = [];
        currentHeight = TABLE_HEADER_HEIGHT_MM;
      }
    }
  }

  // Flush last page
  if (currentPageSections.length > 0) {
    pages.push(currentPageSections);
  }

  return pages.length > 0 ? pages : [[]];
}

export function buildTimelineTemplate(pageCount: number): Template {
  const schemas: Template["schemas"] = [];

  for (let i = 0; i < pageCount; i++) {
    const isFirstPage = i === 0;
    const tableY = isFirstPage ? TABLE_START_Y : CONT_TABLE_START_Y;
    const tableH = isFirstPage ? TABLE_CONTENT_HEIGHT : CONT_TABLE_CONTENT_HEIGHT;

    const pageSchemas: Template["schemas"][number] = [
      {
        name: `header_${i}`,
        type: "gearflowPageHeader",
        content: "",
        position: { x: MARGIN, y: HEADER_Y },
        width: CONTENT_W,
        height: HEADER_H,
      },
    ];

    // Project + venue info only on first page
    if (isFirstPage) {
      pageSchemas.push(
        {
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: INFO_Y },
          width: CONTENT_W / 2 - 4,
          height: INFO_H,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "venueInfo",
          type: "text",
          content: "",
          position: { x: MARGIN + CONTENT_W / 2, y: INFO_Y },
          width: CONTENT_W / 2 - 4,
          height: INFO_H,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
      );
    }

    // Data table for this page
    pageSchemas.push({
      name: `table_${i}`,
      type: "gearflowDataTable",
      content: "",
      position: { x: MARGIN, y: tableY },
      width: CONTENT_W,
      height: tableH,
    });

    // Footer
    pageSchemas.push({
      name: `footer_${i}`,
      type: "gearflowPageFooter",
      content: "",
      position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - FOOTER_H },
      width: CONTENT_W,
      height: FOOTER_H,
    });

    schemas.push(pageSchemas);
  }

  return {
    basePdf: {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      padding: [MARGIN, MARGIN, MARGIN, MARGIN],
    },
    schemas,
  };
}

export function buildTimelineInputs(
  data: DocumentData,
  services: TimelineService[],
  settings: TimelineSettings = DEFAULT_TIMELINE_SETTINGS,
): Record<string, string>[] {
  const docColor = data.org_document_color;
  const columns = buildColumns(settings);
  const sections = buildSections(services, settings);
  const paginatedSections = paginateSections(sections);
  const pageCount = paginatedSections.length;

  // Header config
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_phone, data.org_email].filter(Boolean).join("\n"),
    docTitle: "Project Timeline",
    docMeta: `${data.project_number}\n${data.document_date}`,
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: "icon",
    showOrgNameOnDocuments: true,
    documentColor: docColor,
  };

  // Project info
  const projectLines = [
    data.project_name,
    `Rental: ${data.rental_start} - ${data.rental_end}`,
  ];
  if (data.event_start !== "-") {
    projectLines.push(`Event: ${data.event_start} - ${data.event_end}`);
  }

  // Venue info
  const venueLines: string[] = [];
  if (data.venue_name) venueLines.push(data.venue_name);
  if (data.venue_address) venueLines.push(data.venue_address);
  if (data.site_contact_name) {
    venueLines.push(`Contact: ${data.site_contact_name}`);
    if (data.site_contact_phone) venueLines.push(`Ph: ${data.site_contact_phone}`);
  }

  const inputs: Record<string, string>[] = [];

  for (let i = 0; i < pageCount; i++) {
    const pageInput: Record<string, string> = {};

    // Header on every page
    pageInput[`header_${i}`] = JSON.stringify(headerConfig);

    // Project/venue info only on first page
    if (i === 0) {
      pageInput.projectInfo = projectLines.join("\n");
      pageInput.venueInfo = venueLines.join("\n") || "-";
    }

    // Data table for this page
    const tableConfig = {
      columns,
      sections: paginatedSections[i],
      documentColor: docColor,
    };
    pageInput[`table_${i}`] = JSON.stringify(tableConfig);

    // Footer with page number
    const footerConfig: FooterConfig = {
      text: data.org_name,
      pageNumber: pageCount > 1 ? `Page ${i + 1} of ${pageCount}` : "",
    };
    pageInput[`footer_${i}`] = JSON.stringify(footerConfig);

    inputs.push(pageInput);
  }

  return inputs;
}
