/**
 * Test & Tag Register template — landscape A4 overview of all tagged equipment.
 * Shows summary metrics and a comprehensive table of every test-tagged item.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig, SignatureLineConfig } from "../types";
import type { DataTableConfig, DataTableColumn } from "../plugins/gearflow-data-table";
import type { SummaryBoxConfig } from "../plugins/gearflow-summary-box";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 297; // landscape A4
const PAGE_HEIGHT = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 269mm

// Label maps
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

interface RegisterItem {
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  make: string;
  modelName: string;
  lastTestDate: string | Date | null;
  nextDueDate: string | Date | null;
  status: string;
}

interface RegisterData {
  items: RegisterItem[];
  statusCounts: Record<string, number>;
  complianceRate: number;
  total: number;
}

export function buildTtRegisterTemplate(): Template {
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
          name: "summaryBox",
          type: "gearflowSummaryBox",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 16,
        },
        {
          name: "dataTable",
          type: "gearflowDataTable",
          content: "",
          position: { x: MARGIN, y: 62 },
          width: CONTENT_W,
          height: 125,
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

export function buildTtRegisterInputs(
  data: RegisterData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "TEST & TAG REGISTER",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const summaryConfig: SummaryBoxConfig = {
    items: [
      { label: "Total", value: data.total },
      { label: "Current", value: data.statusCounts["CURRENT"] ?? 0 },
      { label: "Due Soon", value: data.statusCounts["DUE_SOON"] ?? 0 },
      { label: "Overdue", value: data.statusCounts["OVERDUE"] ?? 0 },
      { label: "Failed", value: data.statusCounts["FAILED"] ?? 0 },
      { label: "Not Tested", value: data.statusCounts["NOT_TESTED"] ?? 0 },
      { label: "Compliance %", value: `${data.complianceRate}%` },
    ],
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "testTagId", label: "Tag ID", width: 58 },
    { key: "description", label: "Description", width: 100 },
    { key: "equipmentClass", label: "Class", width: 42 },
    { key: "applianceType", label: "Type", width: 50 },
    { key: "makeModel", label: "Make/Model", width: 55 },
    { key: "lastTestDate", label: "Last Test", width: 50 },
    { key: "nextDueDate", label: "Next Due", width: 50 },
    { key: "status", label: "Status", width: 45, badge: "status" },
  ];

  const rows = data.items.map((item) => ({
    testTagId: item.testTagId,
    description: item.description,
    equipmentClass: CLASS_LABELS[item.equipmentClass] ?? item.equipmentClass,
    applianceType: TYPE_LABELS[item.applianceType] ?? item.applianceType,
    makeModel: [item.make, item.modelName].filter(Boolean).join(" "),
    lastTestDate: formatDate(item.lastTestDate),
    nextDueDate: formatDate(item.nextDueDate),
    status: item.status,
  }));

  const dataTableConfig: DataTableConfig = {
    columns,
    rows,
    documentColor: docColor,
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Test & Tag Register | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    summaryBox: JSON.stringify(summaryConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
