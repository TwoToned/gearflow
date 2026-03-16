/**
 * Tester Activity Report template — portrait A4.
 * Sections grouped by tester, each showing their test records.
 * Section titles include test count and pass rate.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableConfig, DataTableColumn, DataTableSection } from "../plugins/gearflow-data-table";
import { formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm

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

interface TesterRecord {
  testDate: string | Date | null;
  testTagAsset: {
    testTagId: string;
    description: string;
  };
  result: string;
}

interface TesterData {
  name: string;
  totalTests: number;
  passCount: number;
  failCount: number;
  records: TesterRecord[];
}

interface TesterActivityData {
  testers: Record<string, TesterData>;
  totalRecords: number;
}

export function buildTtTesterActivityTemplate(): Template {
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
          height: 230,
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

export function buildTtTesterActivityInputs(
  data: TesterActivityData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "TESTER ACTIVITY REPORT",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "date", label: "Date", width: 55 },
    { key: "tagId", label: "Tag ID", width: 55 },
    { key: "description", label: "Description", width: 130 },
    { key: "result", label: "Result", width: 40, badge: "result" },
  ];

  const sections: DataTableSection[] = [];

  for (const [, tester] of Object.entries(data.testers)) {
    const passRate = tester.totalTests > 0
      ? Math.round((tester.passCount / tester.totalTests) * 100)
      : 0;

    const rows = tester.records.map((record) => ({
      date: formatDate(record.testDate),
      tagId: record.testTagAsset.testTagId,
      description: record.testTagAsset.description,
      result: record.result,
    }));

    sections.push({
      title: `${tester.name} \u2014 ${tester.totalTests} tests (${passRate}% pass rate)`,
      rows,
    });
  }

  const dataTableConfig: DataTableConfig = {
    columns,
    sections,
    documentColor: docColor,
  };

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `Tester Activity Report | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
