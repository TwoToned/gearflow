/**
 * Service-based call sheet PDF generator.
 * Queries project services directly, groups by date, shows crew per service.
 * Each date gets a section header in the data table.
 * Columns: Crew Member, Service, Role, Call, Wrap, Notes.
 * Auto-paginates across multiple pages using gearflowDataTable.
 */
import { generate } from "@pdfme/generator";
import type { Template } from "@pdfme/common";
import { prisma } from "@/lib/prisma";
import { gearflowPlugins } from "../plugins";
import { getPdfmeFonts } from "../fonts";
import { buildDocumentData } from "../build-document-data";
import type { DocumentData, PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableColumn, DataTableSection } from "../plugins/gearflow-data-table";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 297; // landscape A4
const PAGE_HEIGHT = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 269mm

// Row heights in mm (match gearflow-data-table.ts)
const TABLE_ROW_HEIGHT_MM = 5;
const TABLE_HEADER_HEIGHT_MM = 5.6;
const SECTION_HEADER_HEIGHT_MM = 6.3;

// Layout
const HEADER_Y = MARGIN;
const HEADER_H = 25;
const INFO_Y = 42;
const INFO_H = 18;
const TABLE_START_Y = 63;
const FOOTER_H = 10;
const TABLE_END_Y = PAGE_HEIGHT - MARGIN - FOOTER_H - 2;
const TABLE_CONTENT_HEIGHT = TABLE_END_Y - TABLE_START_Y;

// Continuation pages (no info block)
const CONT_TABLE_START_Y = HEADER_Y + HEADER_H + 4;
const CONT_TABLE_CONTENT_HEIGHT = TABLE_END_Y - CONT_TABLE_START_Y;

const SERVICE_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

interface ServiceRow {
  crewName: string;
  service: string;
  role: string;
  call: string;
  wrap: string;
  notes: string;
}

function buildColumns(): DataTableColumn[] {
  return [
    { key: "crewName", label: "Crew Member", width: 3 },
    { key: "service", label: "Service", width: 2 },
    { key: "role", label: "Role", width: 2 },
    { key: "call", label: "Call", width: 1.2, align: "center" },
    { key: "wrap", label: "Wrap", width: 1.2, align: "center" },
    { key: "notes", label: "Notes", width: 2.5 },
  ];
}

/**
 * Paginate sections across pages.
 */
function paginateSections(
  sections: DataTableSection[],
): DataTableSection[][] {
  const pages: DataTableSection[][] = [];
  let currentPageSections: DataTableSection[] = [];
  let currentHeight = TABLE_HEADER_HEIGHT_MM;
  let isFirstPage = true;
  const maxHeight = () => isFirstPage ? TABLE_CONTENT_HEIGHT : CONT_TABLE_CONTENT_HEIGHT;

  for (const section of sections) {
    const sectionHeaderH = SECTION_HEADER_HEIGHT_MM;
    const sectionRowsH = section.rows.length * TABLE_ROW_HEIGHT_MM;
    const totalSectionH = sectionHeaderH + sectionRowsH;

    if (currentHeight + totalSectionH <= maxHeight()) {
      currentPageSections.push(section);
      currentHeight += totalSectionH;
      continue;
    }

    // Split rows across pages
    const availableForRows = maxHeight() - currentHeight - sectionHeaderH;
    const rowsThatFit = Math.max(0, Math.floor(availableForRows / TABLE_ROW_HEIGHT_MM));

    if (rowsThatFit > 0) {
      currentPageSections.push({
        title: section.title,
        rows: section.rows.slice(0, rowsThatFit),
      });
    }

    let remainingRows = section.rows.slice(rowsThatFit);

    if (currentPageSections.length > 0) {
      pages.push(currentPageSections);
      currentPageSections = [];
      currentHeight = TABLE_HEADER_HEIGHT_MM;
      isFirstPage = false;
    }

    while (remainingRows.length > 0) {
      const contAvailable = CONT_TABLE_CONTENT_HEIGHT - TABLE_HEADER_HEIGHT_MM - SECTION_HEADER_HEIGHT_MM;
      const contRowsFit = Math.max(1, Math.floor(contAvailable / TABLE_ROW_HEIGHT_MM));
      const batch = remainingRows.slice(0, contRowsFit);
      remainingRows = remainingRows.slice(contRowsFit);

      currentPageSections.push({
        title: remainingRows.length > 0
          ? `${section.title} (cont.)`
          : section.title + (rowsThatFit > 0 ? " (cont.)" : ""),
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

  if (currentPageSections.length > 0) {
    pages.push(currentPageSections);
  }

  return pages.length > 0 ? pages : [[]];
}

function buildTemplate(pageCount: number): Template {
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

    pageSchemas.push({
      name: `table_${i}`,
      type: "gearflowDataTable",
      content: "",
      position: { x: MARGIN, y: tableY },
      width: CONTENT_W,
      height: tableH,
    });

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

export async function buildCallSheetFromServices(
  projectId: string,
  organizationId: string,
  options: {
    callSheetDates?: Date[];
    allDates?: boolean;
    crewMemberId?: string;
    crewRoleId?: string;
    templateId?: string;
  },
): Promise<Uint8Array> {
  // 1. Get org/project data for header/footer
  const data = await buildDocumentData(projectId, organizationId, "quote");

  // 2. Query services with crew assignments
  const services = await prisma.projectService.findMany({
    where: {
      organizationId,
      projectId,
      status: { not: "CANCELLED" },
    },
    include: {
      crewAssignments: {
        where: {
          status: { notIn: ["CANCELLED", "DECLINED"] },
          ...(options.crewMemberId ? { crewMemberId: options.crewMemberId } : {}),
          ...(options.crewRoleId ? { crewRoleId: options.crewRoleId } : {}),
        },
        include: {
          crewMember: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
          crewRole: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
  });

  // 3. Group by date, build rows
  const groups = new Map<string, { dateLabel: string; rows: ServiceRow[] }>();

  for (const s of services) {
    const dateKey = s.date
      ? new Date(s.date).toISOString().slice(0, 10)
      : "no-date";

    if (!groups.has(dateKey)) {
      const dateLabel = dateKey === "no-date"
        ? "Unscheduled"
        : formatCallSheetDate(dateKey);
      groups.set(dateKey, { dateLabel, rows: [] });
    }

    const group = groups.get(dateKey)!;
    const serviceLabel = s.title || SERVICE_TYPE_LABELS[s.type] || s.type;

    if (s.crewAssignments.length === 0) {
      // Service with no crew assigned
      group.rows.push({
        crewName: "-",
        service: serviceLabel,
        role: "-",
        call: s.startTime || "-",
        wrap: s.endTime || "-",
        notes: s.notes || "",
      });
    } else {
      // Deduplicate crew per service (same person, different assignments)
      const seenCrew = new Map<string, ServiceRow>();
      for (const ca of s.crewAssignments) {
        const crewId = ca.crewMember.id;
        const name = `${ca.crewMember.firstName} ${ca.crewMember.lastName}`;
        const role = ca.crewRole?.name || "-";

        if (seenCrew.has(crewId)) {
          const existing = seenCrew.get(crewId)!;
          if (role !== "-" && existing.role !== role && !existing.role.split(", ").includes(role)) {
            existing.role = `${existing.role}, ${role}`;
          }
        } else {
          seenCrew.set(crewId, {
            crewName: name,
            service: serviceLabel,
            role,
            call: s.startTime || "-",
            wrap: s.endTime || "-",
            notes: s.notes || "",
          });
        }
      }
      group.rows.push(...seenCrew.values());
    }
  }

  // 4. Build sections sorted by date
  const sortedKeys = Array.from(groups.keys()).sort();
  const sections: DataTableSection[] = sortedKeys.map(key => {
    const group = groups.get(key)!;
    return {
      title: group.dateLabel,
      rows: group.rows.map(r => ({
        crewName: r.crewName,
        service: r.service,
        role: r.role,
        call: r.call,
        wrap: r.wrap,
        notes: r.notes,
      })),
    };
  });

  // 5. Build title
  const docColor = data.org_document_color;
  let docTitle = "Call Sheet";
  if (options.crewMemberId && services.length > 0) {
    const firstCrew = services
      .flatMap(s => s.crewAssignments)
      .find(ca => ca.crewMember.id === options.crewMemberId);
    if (firstCrew) {
      docTitle = `Call Sheet - ${firstCrew.crewMember.firstName} ${firstCrew.crewMember.lastName}`;
    }
  }

  // 6. Paginate and build template
  const columns = buildColumns();
  const paginatedSections = paginateSections(sections);
  const pageCount = paginatedSections.length;
  const template = buildTemplate(pageCount);

  // 7. Build header config
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_phone, data.org_email].filter(Boolean).join("\n"),
    docTitle,
    docMeta: `${data.project_number}\n${data.document_date}`,
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: "icon",
    showOrgNameOnDocuments: true,
    documentColor: docColor,
  };

  // 8. Build info
  const projectLines = [data.project_name];
  if (data.rental_start !== "-") {
    projectLines.push(`${data.rental_start} - ${data.rental_end}`);
  }

  const venueLines: string[] = [];
  if (data.venue_name) venueLines.push(data.venue_name);
  if (data.venue_address) venueLines.push(data.venue_address);
  if (data.site_contact_name) {
    venueLines.push(`Contact: ${data.site_contact_name}`);
    if (data.site_contact_phone) venueLines.push(`Ph: ${data.site_contact_phone}`);
  }

  // 9. Build inputs per page
  const inputs: Record<string, string>[] = [];

  for (let i = 0; i < pageCount; i++) {
    const pageInput: Record<string, string> = {};

    pageInput[`header_${i}`] = JSON.stringify(headerConfig);

    if (i === 0) {
      pageInput.projectInfo = projectLines.join("\n");
      pageInput.venueInfo = venueLines.join("\n") || "-";
    }

    pageInput[`table_${i}`] = JSON.stringify({
      columns,
      sections: paginatedSections[i],
      documentColor: docColor,
    });

    const footerConfig: FooterConfig = {
      text: data.org_name,
      pageNumber: pageCount > 1 ? `Page ${i + 1} of ${pageCount}` : "",
    };
    pageInput[`footer_${i}`] = JSON.stringify(footerConfig);

    inputs.push(pageInput);
  }

  // 10. Generate PDF
  const pdf = await generate({
    template,
    inputs,
    plugins: gearflowPlugins,
    options: { font: getPdfmeFonts() },
  });

  return pdf;
}

/** Format date as "Monday, 7 April 2026" */
function formatCallSheetDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
