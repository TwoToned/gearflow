/**
 * Failed Items Report template — landscape A4.
 * Lists all failed test records with failure breakdown summary.
 * Columns include which specific tests failed and the action taken.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableConfig, DataTableColumn } from "../plugins/gearflow-data-table";
import type { SummaryBoxConfig } from "../plugins/gearflow-summary-box";
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

interface FailedRecord {
  testDate: string | Date | null;
  testTagAsset: {
    testTagId: string;
    description: string;
    equipmentClass: string;
    applianceType: string;
  };
  testerName: string;
  visualInspectionResult: string;
  earthContinuityResult: string;
  insulationResult: string;
  leakageCurrentResult: string;
  polarityResult: string;
  rcdTripTimeResult: string;
  failureAction: string;
  failureNotes: string | null;
}

interface FailedItemsData {
  records: FailedRecord[];
  failureBreakdown: {
    visual: number;
    earthContinuity: number;
    insulation: number;
    leakage: number;
    polarity: number;
    rcd: number;
    functional: number;
  };
  total: number;
}

function getFailedTests(record: FailedRecord): string {
  const failed: string[] = [];
  if (record.visualInspectionResult === "FAIL") failed.push("Visual");
  if (record.earthContinuityResult === "FAIL") failed.push("Earth");
  if (record.insulationResult === "FAIL") failed.push("Insulation");
  if (record.leakageCurrentResult === "FAIL") failed.push("Leakage");
  if (record.polarityResult === "FAIL") failed.push("Polarity");
  if (record.rcdTripTimeResult === "FAIL") failed.push("RCD");
  return failed.length > 0 ? failed.join(", ") : "Other";
}

export function buildTtFailedItemsTemplate(): Template {
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

export function buildTtFailedItemsInputs(
  data: FailedItemsData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "FAILED ITEMS REPORT",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const summaryConfig: SummaryBoxConfig = {
    items: [
      { label: "Total Failed", value: data.total },
      { label: "Visual", value: data.failureBreakdown.visual },
      { label: "Earth", value: data.failureBreakdown.earthContinuity },
      { label: "Insulation", value: data.failureBreakdown.insulation },
      { label: "Leakage", value: data.failureBreakdown.leakage },
      { label: "Polarity", value: data.failureBreakdown.polarity },
      { label: "RCD", value: data.failureBreakdown.rcd },
    ],
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "date", label: "Date", width: 45 },
    { key: "tagId", label: "Tag ID", width: 45 },
    { key: "description", label: "Description", width: 70 },
    { key: "equipmentClass", label: "Class", width: 35 },
    { key: "applianceType", label: "Type", width: 40 },
    { key: "tester", label: "Tester", width: 45 },
    { key: "failedTests", label: "Failed Tests", width: 55 },
    { key: "action", label: "Action", width: 40 },
    { key: "notes", label: "Notes", width: 0 }, // flex — takes remaining width
  ];

  const rows = data.records.map((record) => ({
    date: formatDate(record.testDate),
    tagId: record.testTagAsset.testTagId,
    description: record.testTagAsset.description,
    equipmentClass: CLASS_LABELS[record.testTagAsset.equipmentClass] ?? record.testTagAsset.equipmentClass,
    applianceType: TYPE_LABELS[record.testTagAsset.applianceType] ?? record.testTagAsset.applianceType,
    tester: record.testerName,
    failedTests: getFailedTests(record),
    action: record.failureAction || "-",
    notes: record.failureNotes || "-",
  }));

  const dataTableConfig: DataTableConfig = {
    columns,
    rows,
    documentColor: docColor,
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Failed Items Report | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    summaryBox: JSON.stringify(summaryConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
