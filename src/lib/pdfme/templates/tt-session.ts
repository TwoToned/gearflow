/**
 * Test Session Report template — landscape A4.
 * Shows results of a testing session with summary metrics,
 * detailed test readings, and signature for the tester.
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

interface TestRecord {
  testTagId: string;
  description: string;
  equipmentClass: string;
  visualInspection: string; // "PASS" | "FAIL"
  earthContinuityReading: number | null;
  earthContinuityResult: string | null; // "PASS" | "FAIL" | null
  insulationResistanceReading: number | null;
  insulationResistanceResult: string | null;
  leakageCurrentReading: number | null;
  leakageCurrentResult: string | null;
  polarityResult: string | null;
  rcdTripTimeReading: number | null;
  rcdTripTimeResult: string | null;
  result: string; // "PASS" | "FAIL"
  failureNotes?: string | null;
  subTestRecords?: SubTestRecord[];
}

interface SessionData {
  records: TestRecord[];
  passCount: number;
  failCount: number;
  total: number;
}

const CLASS_LABELS: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (DI)",
  LEAD_CORD_ASSEMBLY: "Lead/Cord",
};

function formatReading(
  reading: number | null,
  result: string | null
): string {
  if (reading == null && result == null) return "N/A";
  if (reading == null) return result ?? "N/A";
  const formatted = reading.toFixed(2);
  const suffix = result === "PASS" ? " P" : result === "FAIL" ? " F" : "";
  return `${formatted}${suffix}`;
}

function formatResultOnly(result: string | null): string {
  if (!result) return "N/A";
  return result === "PASS" ? "P" : result === "FAIL" ? "F" : result;
}

export function buildTtSessionTemplate(): Template {
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
          height: 105,
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 172 },
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

export function buildTtSessionInputs(
  data: SessionData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";
  const passRate = data.total > 0 ? Math.round((data.passCount / data.total) * 100) : 0;

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "TEST SESSION REPORT",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const summaryConfig: SummaryBoxConfig = {
    items: [
      { label: "Total Tested", value: data.total },
      { label: "Passed", value: data.passCount },
      { label: "Failed", value: data.failCount },
      { label: "Pass Rate", value: `${passRate}%` },
    ],
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "testTagId", label: "Tag ID", width: 50 },
    { key: "description", label: "Description", width: 85 },
    { key: "equipmentClass", label: "Class", width: 36 },
    { key: "visual", label: "Visual", width: 30 },
    { key: "earth", label: "Earth", width: 42 },
    { key: "insulation", label: "Insulation", width: 42 },
    { key: "leakage", label: "Leakage", width: 42 },
    { key: "polarity", label: "Polarity", width: 30 },
    { key: "rcd", label: "RCD", width: 30 },
    { key: "result", label: "Result", width: 32, badge: "result" },
  ];

  const rows = data.records.map((rec) => ({
    testTagId: rec.testTagId,
    description: rec.description,
    equipmentClass: CLASS_LABELS[rec.equipmentClass] ?? rec.equipmentClass,
    visual: formatResultOnly(rec.visualInspection),
    earth: formatReading(rec.earthContinuityReading, rec.earthContinuityResult),
    insulation: formatReading(rec.insulationResistanceReading, rec.insulationResistanceResult),
    leakage: formatReading(rec.leakageCurrentReading, rec.leakageCurrentResult),
    polarity: formatResultOnly(rec.polarityResult),
    rcd: formatReading(rec.rcdTripTimeReading, rec.rcdTripTimeResult),
    result: rec.result,
  }));

  // Build expanded notes for failed items and sub-tests
  const expandedNotes: { rowIndex: number; text: string; bgColor?: string; textColor?: string }[] = [];
  data.records.forEach((rec, i) => {
    if (rec.result === "FAIL" && rec.failureNotes) {
      expandedNotes.push({
        rowIndex: i,
        text: `Failure: ${rec.failureNotes}`,
        bgColor: "#fef2f2",
        textColor: "#991b1b",
      });
    }
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

  const signatureConfig: SignatureLineConfig = {
    columns: [
      { label: "Tested By", subLabel: "Name / Signature" },
      { label: "Licence Number" },
      { label: "Date" },
    ],
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Test Session Report | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    summaryBox: JSON.stringify(summaryConfig),
    dataTable: JSON.stringify(dataTableConfig),
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
