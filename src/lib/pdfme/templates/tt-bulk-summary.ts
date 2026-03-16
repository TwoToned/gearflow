/**
 * Bulk Asset T&T Summary template — portrait A4.
 * Shows details for a single bulk asset with its registered test-tagged items.
 * Includes asset details text block, summary metrics, and item table.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableConfig, DataTableColumn } from "../plugins/gearflow-data-table";
import type { SummaryBoxConfig } from "../plugins/gearflow-summary-box";
import type { TextBlockConfig } from "../plugins/gearflow-text-block";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm

const STATUS_LABELS: Record<string, string> = {
  CURRENT: "Current",
  DUE_SOON: "Due Soon",
  OVERDUE: "Overdue",
  FAILED: "Failed",
  NOT_YET_TESTED: "Not Tested",
  RETIRED: "Retired",
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

interface BulkSummaryItem {
  testTagId: string;
  description: string;
  serialNumber: string | null;
  location: string | null;
  lastTestDate: string | Date | null;
  nextDueDate: string | Date | null;
  status: string;
}

interface BulkSummaryData {
  bulkAsset: {
    assetTag: string;
    totalQuantity: number;
    modelName: string;
    manufacturer: string;
  };
  items: BulkSummaryItem[];
  statusCounts: Record<string, number>;
  complianceRate: number;
  registeredCount: number;
}

export function buildTtBulkSummaryTemplate(): Template {
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
          name: "assetDetails",
          type: "gearflowTextBlock",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 30,
        },
        {
          name: "summaryBox",
          type: "gearflowSummaryBox",
          content: "",
          position: { x: MARGIN, y: 75 },
          width: CONTENT_W,
          height: 16,
        },
        {
          name: "dataTable",
          type: "gearflowDataTable",
          content: "",
          position: { x: MARGIN, y: 95 },
          width: CONTENT_W,
          height: 177,
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

export function buildTtBulkSummaryInputs(
  data: BulkSummaryData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "BULK ASSET T&T SUMMARY",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const textBlockConfig: TextBlockConfig = {
    title: "Asset Details",
    keyValues: [
      { label: "Asset Tag", value: data.bulkAsset.assetTag },
      { label: "Model", value: data.bulkAsset.modelName },
      { label: "Manufacturer", value: data.bulkAsset.manufacturer },
      { label: "Total Quantity", value: String(data.bulkAsset.totalQuantity) },
      { label: "Registered Count", value: String(data.registeredCount) },
    ],
    kvColumns: 3,
    documentColor: docColor,
  };

  if (data.registeredCount !== data.bulkAsset.totalQuantity) {
    textBlockConfig.paragraphs = [
      {
        text: `Warning: Registered count (${data.registeredCount}) does not match total quantity (${data.bulkAsset.totalQuantity})`,
        fontSize: 8,
        color: "#991b1b",
        bold: true,
        marginBottom: 2,
      },
    ];
  }

  const summaryConfig: SummaryBoxConfig = {
    items: [
      { label: "Total", value: data.registeredCount },
      { label: "Current", value: data.statusCounts["CURRENT"] ?? 0 },
      { label: "Due Soon", value: data.statusCounts["DUE_SOON"] ?? 0 },
      { label: "Overdue", value: data.statusCounts["OVERDUE"] ?? 0 },
      { label: "Failed", value: data.statusCounts["FAILED"] ?? 0 },
      { label: "Not Tested", value: data.statusCounts["NOT_YET_TESTED"] ?? 0 },
      { label: "Compliance %", value: `${data.complianceRate}%` },
    ],
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "tagId", label: "Tag ID", width: 55 },
    { key: "description", label: "Description", width: 90 },
    { key: "serial", label: "Serial", width: 50 },
    { key: "location", label: "Location", width: 55 },
    { key: "lastTest", label: "Last Test", width: 50 },
    { key: "nextDue", label: "Next Due", width: 50 },
    { key: "status", label: "Status", width: 35, badge: "status" },
  ];

  const rows = data.items.map((item) => ({
    tagId: item.testTagId,
    description: item.description,
    serial: item.serialNumber || "-",
    location: item.location || "-",
    lastTest: formatDate(item.lastTestDate),
    nextDue: formatDate(item.nextDueDate),
    status: item.status,
  }));

  const dataTableConfig: DataTableConfig = {
    columns,
    rows,
    documentColor: docColor,
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Bulk Asset T&T Summary | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    assetDetails: JSON.stringify(textBlockConfig),
    summaryBox: JSON.stringify(summaryConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
