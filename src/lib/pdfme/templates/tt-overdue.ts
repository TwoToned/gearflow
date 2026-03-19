/**
 * Non-Compliant Equipment Report template — portrait A4.
 * Shows overdue, failed, and not-yet-tested items in separate sections
 * with a signature line for acknowledgement.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig, SignatureLineConfig } from "../types";
import type { DataTableConfig, DataTableColumn, DataTableSection } from "../plugins/gearflow-data-table";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm

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

interface OverdueItem {
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  location?: string | null;
  lastTestDate: string | Date | null;
  nextDueDate: string | Date | null;
  status: string;
  failureNotes?: string | null;
}

interface OverdueData {
  overdueItems: OverdueItem[];
  failedItems: OverdueItem[];
  notTestedItems: OverdueItem[];
}

export function buildTtOverdueTemplate(): Template {
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
          height: 205,
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 252 },
          width: CONTENT_W,
          height: 20,
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

function calcDaysOverdue(nextDueDate: string | Date | null): number {
  if (!nextDueDate) return 0;
  const due = new Date(nextDueDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function mapItemRow(item: OverdueItem): Record<string, string | number | null> {
  return {
    testTagId: item.testTagId,
    description: item.description,
    equipmentClass: CLASS_LABELS[item.equipmentClass] ?? item.equipmentClass,
    applianceType: TYPE_LABELS[item.applianceType] ?? item.applianceType,
    location: item.location ?? "-",
    lastTestDate: formatDate(item.lastTestDate),
    nextDueDate: formatDate(item.nextDueDate),
    status: item.status,
  };
}

export function buildTtOverdueInputs(
  data: OverdueData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "NON-COMPLIANT EQUIPMENT REPORT",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "testTagId", label: "Tag ID", width: 50 },
    { key: "description", label: "Description", width: 90 },
    { key: "equipmentClass", label: "Class", width: 40 },
    { key: "applianceType", label: "Type", width: 45 },
    { key: "location", label: "Location", width: 50 },
    { key: "lastTestDate", label: "Last Test", width: 45 },
    { key: "nextDueDate", label: "Next Due", width: 45 },
    { key: "status", label: "Status", width: 35, badge: "status" },
  ];

  // Build sections
  const sections: DataTableSection[] = [];

  if (data.overdueItems.length > 0) {
    sections.push({
      title: `Overdue Items (${data.overdueItems.length})`,
      rows: data.overdueItems.map((item) => {
        const row = mapItemRow(item);
        const days = calcDaysOverdue(item.nextDueDate);
        if (days > 0) {
          row.nextDueDate = `${formatDate(item.nextDueDate)} (${days}d)`;
        }
        return row;
      }),
    });
  }

  if (data.failedItems.length > 0) {
    // Build expanded notes for failed items with failure notes
    const failedRows = data.failedItems.map(mapItemRow);
    sections.push({
      title: `Failed Items (${data.failedItems.length})`,
      rows: failedRows,
    });
  }

  if (data.notTestedItems.length > 0) {
    sections.push({
      title: `Not Yet Tested (${data.notTestedItems.length})`,
      rows: data.notTestedItems.map(mapItemRow),
    });
  }

  // Collect expanded notes for failed items with failureNotes
  const expandedNotes: { rowIndex: number; text: string; bgColor?: string; textColor?: string }[] = [];
  // Calculate the row offset for failed items section
  const rowOffset = data.overdueItems.length;
  data.failedItems.forEach((item, i) => {
    if (item.failureNotes) {
      expandedNotes.push({
        rowIndex: rowOffset + i,
        text: `Failure: ${item.failureNotes}`,
        bgColor: "#fef2f2",
        textColor: "#991b1b",
      });
    }
  });

  const dataTableConfig: DataTableConfig = {
    columns,
    sections,
    documentColor: docColor,
    expandedNotes: expandedNotes.length > 0 ? expandedNotes : undefined,
  };

  const signatureConfig: SignatureLineConfig = {
    columns: [
      { label: "Reviewed By", subLabel: "Name / Signature" },
      { label: "Action Required By", subLabel: "Name / Signature" },
      { label: "Date" },
    ],
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Non-Compliant Equipment Report | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    dataTable: JSON.stringify(dataTableConfig),
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
