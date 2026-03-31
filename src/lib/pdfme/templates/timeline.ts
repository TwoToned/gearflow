/**
 * System default template for Project Timeline PDF.
 * Portrait A4 (210mm x 297mm). Date-grouped service rows with type/title/time/crew/cost.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, PageHeaderConfig, FooterConfig } from "../types";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm

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
}

export function buildTimelineTemplate(): Template {
  return {
    basePdf: {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      padding: [MARGIN, MARGIN, MARGIN, MARGIN],
    },
    schemas: [
      [
        {
          name: "header",
          type: "gearflowPageHeader",
          content: "",
          position: { x: MARGIN, y: MARGIN },
          width: CONTENT_W,
          height: 25,
        },
        // Project + venue info
        {
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W / 2 - 4,
          height: 20,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "venueInfo",
          type: "text",
          content: "",
          position: { x: MARGIN + CONTENT_W / 2, y: 42 },
          width: CONTENT_W / 2 - 4,
          height: 20,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        // Timeline body (multi-line text)
        {
          name: "timelineBody",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 66 },
          width: CONTENT_W,
          height: 200,
          fontSize: 8.5,
          fontColor: "#1a1a1a",
          lineHeight: 1.4,
        },
        {
          name: "footer",
          type: "gearflowPageFooter",
          content: "",
          position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 10 },
          width: CONTENT_W,
          height: 10,
        },
      ],
    ],
  };
}

export function buildTimelineInputs(
  data: DocumentData,
  services: TimelineService[],
): Record<string, string> {
  const docColor = data.org_document_color;

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

  // Group services by date
  const groups = new Map<string, TimelineService[]>();
  for (const s of services) {
    const key = s.date ? new Date(s.date).toISOString().slice(0, 10) : "no-date";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  // Sort date keys
  const sortedKeys = Array.from(groups.keys()).sort();

  // Build timeline body text
  const bodyLines: string[] = [];
  for (const key of sortedKeys) {
    const dateLabel =
      key === "no-date"
        ? "Unscheduled"
        : formatDate(new Date(key + "T00:00:00").toISOString());

    // Date header
    bodyLines.push(`--- ${dateLabel.toUpperCase()} ---`);
    bodyLines.push("");

    for (const s of groups.get(key)!) {
      const typeLabel = SERVICE_TYPE_LABELS[s.type] || s.type;
      const time = [s.startTime, s.endTime].filter(Boolean).join(" - ");
      const title = s.title || typeLabel;
      const crew = s.crewAssignments
        .map((ca) => `${ca.crewMember.firstName} ${ca.crewMember.lastName}`)
        .join(", ");
      const cost =
        s.lineTotal != null
          ? `$${Number(s.lineTotal).toFixed(2)}`
          : "";

      // Service row: time | type | title | crew | cost
      const parts = [
        time ? `[${time}]` : "",
        typeLabel,
        title !== typeLabel ? `- ${title}` : "",
      ]
        .filter(Boolean)
        .join("  ");

      bodyLines.push(parts);
      if (crew) bodyLines.push(`  Crew: ${crew}`);
      if (s.address) bodyLines.push(`  Location: ${s.address}`);
      if (cost) bodyLines.push(`  Cost: ${cost}`);
      if (s.notes) bodyLines.push(`  Notes: ${s.notes}`);
      bodyLines.push("");
    }
  }

  // Footer
  const footerConfig: FooterConfig = {
    text: data.org_name,
    pageNumber: "Page 1",
  };

  return {
    header: JSON.stringify(headerConfig),
    projectInfo: projectLines.join("\n"),
    venueInfo: venueLines.join("\n") || "-",
    timelineBody: bodyLines.join("\n"),
    footer: JSON.stringify(footerConfig),
  };
}
