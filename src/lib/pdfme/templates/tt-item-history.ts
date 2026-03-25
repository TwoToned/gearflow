/**
 * Item Test History template — portrait A4.
 * Shows detailed info for a single test-tagged item with its full test record history.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableConfig, DataTableColumn } from "../plugins/gearflow-data-table";
import type { TextBlockConfig } from "../plugins/gearflow-text-block";
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
  MICROWAVE: "Microwave",
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

interface SubTestRecord {
  label: string;
  result: string;
  earthContinuityReading: number | null;
  insulationReading: number | null;
  leakageCurrentReading: number | null;
}

interface TestRecordEntry {
  testDate: string | Date;
  testerName: string;
  result: string; // "PASS" | "FAIL"
  visualInspection: string;
  earthContinuityReading: number | null;
  earthContinuityResult: string | null;
  insulationResistanceReading: number | null;
  insulationResistanceResult: string | null;
  leakageCurrentReading: number | null;
  leakageCurrentResult: string | null;
  polarityResult: string | null;
  rcdTripTimeReading: number | null;
  rcdTripTimeResult: string | null;
  notes?: string | null;
  subTestRecords?: SubTestRecord[];
}

interface ItemHistoryData {
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  make: string;
  modelName: string;
  serialNumber: string | null;
  location: string | null;
  testInterval: number | string | null;
  lastTestDate: string | Date | null;
  nextDueDate: string | Date | null;
  status: string;
  testRecords: TestRecordEntry[];
}

function formatReading(reading: number | null): string {
  if (reading == null) return "-";
  return reading.toFixed(2);
}

function formatResultOnly(result: string | null): string {
  if (!result) return "N/A";
  return result === "PASS" ? "P" : result === "FAIL" ? "F" : result;
}

export function buildTtItemHistoryTemplate(): Template {
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
          name: "itemDetails",
          type: "gearflowTextBlock",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 50,
        },
        {
          name: "dataTable",
          type: "gearflowDataTable",
          content: "",
          position: { x: MARGIN, y: 96 },
          width: CONTENT_W,
          height: 170,
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

export function buildTtItemHistoryInputs(
  data: ItemHistoryData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "ITEM TEST HISTORY",
    docMeta: `${data.testTagId}\n${formatDate(new Date())}`,
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const testIntervalStr = data.testInterval
    ? `${data.testInterval} months`
    : "-";

  const textBlockConfig: TextBlockConfig = {
    title: "Item Details",
    keyValues: [
      { label: "Tag ID", value: data.testTagId },
      { label: "Description", value: data.description },
      { label: "Class", value: CLASS_LABELS[data.equipmentClass] ?? data.equipmentClass },
      { label: "Type", value: TYPE_LABELS[data.applianceType] ?? data.applianceType },
      { label: "Make", value: data.make || "-" },
      { label: "Model", value: data.modelName || "-" },
      { label: "Serial No.", value: data.serialNumber || "-" },
      { label: "Location", value: data.location || "-" },
      { label: "Test Interval", value: testIntervalStr },
      { label: "Last Test", value: formatDate(data.lastTestDate) },
      { label: "Next Due", value: formatDate(data.nextDueDate) },
      { label: "Status", value: data.status },
    ],
    kvColumns: 3,
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "testDate", label: "Date", width: 50 },
    { key: "testerName", label: "Tester", width: 60 },
    { key: "result", label: "Result", width: 30, badge: "result" },
    { key: "visual", label: "Visual", width: 25, badge: "result" },
    { key: "earth", label: "Earth", width: 40 },
    { key: "insulation", label: "Insul", width: 40 },
    { key: "leakage", label: "Leak", width: 40 },
    { key: "polarity", label: "Polar", width: 25, badge: "result" },
    { key: "rcd", label: "RCD", width: 35 },
    { key: "notes", label: "Notes", width: 55 },
  ];

  const rows = data.testRecords.map((rec) => ({
    testDate: formatDate(rec.testDate),
    testerName: rec.testerName,
    result: rec.result,
    visual: formatResultOnly(rec.visualInspection),
    earth: formatReading(rec.earthContinuityReading),
    insulation: formatReading(rec.insulationResistanceReading),
    leakage: formatReading(rec.leakageCurrentReading),
    polarity: formatResultOnly(rec.polarityResult),
    rcd: formatReading(rec.rcdTripTimeReading),
    notes: rec.notes ?? "-",
  }));

  // Add expanded notes for sub-tests
  const expandedNotes: { rowIndex: number; text: string; bgColor?: string; textColor?: string }[] = [];
  data.testRecords.forEach((rec, i) => {
    if (rec.subTestRecords && rec.subTestRecords.length > 0) {
      const subLines = rec.subTestRecords.map((st) => {
        const parts = [st.label, st.result];
        if (st.earthContinuityReading != null) parts.push(`Earth: ${st.earthContinuityReading.toFixed(2)}`);
        if (st.insulationReading != null) parts.push(`Insul: ${st.insulationReading.toFixed(2)}`);
        if (st.leakageCurrentReading != null) parts.push(`Leak: ${st.leakageCurrentReading.toFixed(2)}`);
        return parts.join(" | ");
      });
      expandedNotes.push({
        rowIndex: i,
        text: `Sub-tests: ${subLines.join("  //  ")}`,
        bgColor: "#f0fdfa",
        textColor: "#115e59",
      });
    }
  });

  const dataTableConfig: DataTableConfig = {
    columns,
    rows,
    documentColor: docColor,
    expandedNotes: expandedNotes.length > 0 ? expandedNotes : undefined,
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Item Test History — ${data.testTagId} | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    itemDetails: JSON.stringify(textBlockConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
