/**
 * Due for Testing Schedule template — landscape A4.
 * Shows items that are overdue or due within a date range, in two sections.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableConfig, DataTableColumn, DataTableSection } from "../plugins/gearflow-data-table";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 297; // landscape A4
const PAGE_HEIGHT = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 269mm

const CLASS_LABELS: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (DI)",
  LEAD_CORD_ASSEMBLY: "Lead/Cord",
};

const TYPE_LABELS: Record<string, string> = {
  APPLIANCE: "Appliance",
  CORD_SET: "Cord Set",
  EXTENSION_LEAD: "Ext Lead",
  POWER_BOARD: "Power Board",
  RCD_PORTABLE: "RCD (P)",
  RCD_FIXED: "RCD (F)",
  THREE_PHASE: "3-Phase",
  OTHER: "Other",
};

interface OrgData {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  branding?: {
    primaryColor?: string;
    documentColor?: string;
    logoUrl?: string;
    iconUrl?: string;
    documentLogoMode?: "logo" | "icon" | "none";
    showOrgNameOnDocuments?: boolean;
  };
  logoData?: string | null;
  iconData?: string | null;
}

interface DueItem {
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  location?: string | null;
  nextDueDate: string | Date | null;
  status: string;
}

interface DueScheduleData {
  items: DueItem[];
  overdueItems: DueItem[];
  dateFrom: string | Date;
  dateTo: string | Date;
}

function mapItemRow(item: DueItem): Record<string, string | number | null> {
  return {
    testTagId: item.testTagId,
    description: item.description,
    equipmentClass: CLASS_LABELS[item.equipmentClass] ?? item.equipmentClass,
    applianceType: TYPE_LABELS[item.applianceType] ?? item.applianceType,
    location: item.location ?? "-",
    nextDueDate: formatDate(item.nextDueDate),
    status: item.status,
  };
}

export function buildTtDueScheduleTemplate(): Template {
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
        {
          name: "dataTable",
          type: "gearflowDataTable",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 145,
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

export function buildTtDueScheduleInputs(
  data: DueScheduleData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const dateRange = `${formatDate(data.dateFrom)} — ${formatDate(data.dateTo)}`;

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "DUE FOR TESTING SCHEDULE",
    docMeta: `${dateRange}\n${formatDate(new Date())}`,
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "testTagId", label: "Tag ID", width: 55 },
    { key: "description", label: "Description", width: 100 },
    { key: "equipmentClass", label: "Class", width: 45 },
    { key: "applianceType", label: "Type", width: 55 },
    { key: "location", label: "Location", width: 65 },
    { key: "nextDueDate", label: "Due Date", width: 50 },
    { key: "status", label: "Status", width: 35, badge: "status" },
  ];

  // Filter items that are due within range (not overdue)
  const dueWithinRange = data.items.filter(
    (item) => !data.overdueItems.some((o) => o.testTagId === item.testTagId)
  );

  const sections: DataTableSection[] = [];

  if (data.overdueItems.length > 0) {
    sections.push({
      title: `Overdue (${data.overdueItems.length})`,
      rows: data.overdueItems.map(mapItemRow),
    });
  }

  if (dueWithinRange.length > 0) {
    sections.push({
      title: `Due Within Range (${dueWithinRange.length})`,
      rows: dueWithinRange.map(mapItemRow),
    });
  }

  const dataTableConfig: DataTableConfig = {
    columns,
    sections,
    documentColor: docColor,
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Due for Testing Schedule | ${dateRange} | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
