/**
 * Electrical Equipment Compliance Statement template — portrait A4.
 * Formal compliance certificate referencing AS/NZS 3760:2022.
 * Includes legal statement, item table, totals, disclaimer, and signature block.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig, SignatureLineConfig } from "../types";
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

interface ComplianceItem {
  testTagId: string;
  description: string;
  equipmentClass: string;
  lastTestDate: string | Date | null;
  nextDueDate: string | Date | null;
  testRecords: {
    testedBy?: { name: string } | null;
    testerName?: string | null;
  }[];
}

interface ComplianceCertData {
  items: ComplianceItem[];
  total: number;
  generatedDate: string | Date;
}

function getTesterName(item: ComplianceItem): string {
  if (item.testRecords.length === 0) return "-";
  const latest = item.testRecords[0];
  return latest.testedBy?.name || latest.testerName || "-";
}

export function buildTtComplianceCertTemplate(): Template {
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
          name: "legalStatement",
          type: "gearflowTextBlock",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 16,
        },
        {
          name: "dataTable",
          type: "gearflowDataTable",
          content: "",
          position: { x: MARGIN, y: 61 },
          width: CONTENT_W,
          height: 165,
        },
        {
          name: "totalsText",
          type: "gearflowTextBlock",
          content: "",
          position: { x: MARGIN, y: 229 },
          width: CONTENT_W,
          height: 20,
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 252 },
          width: CONTENT_W,
          height: 25,
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

export function buildTtComplianceCertInputs(
  data: ComplianceCertData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";
  const generatedDateStr = formatDate(data.generatedDate);

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "ELECTRICAL EQUIPMENT COMPLIANCE STATEMENT",
    docMeta: generatedDateStr,
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const legalStatementConfig: TextBlockConfig = {
    paragraphs: [
      {
        text: `This is to certify that the following electrical equipment owned by ${orgData.name} has been inspected and tested in accordance with AS/NZS 3760:2022 and found to be safe for use.`,
        fontSize: 9,
      },
    ],
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "tagId", label: "Tag ID", width: 60 },
    { key: "description", label: "Description", width: 130 },
    { key: "equipmentClass", label: "Class", width: 50 },
    { key: "lastTest", label: "Last Test", width: 60 },
    { key: "nextDue", label: "Next Due", width: 60 },
    { key: "tester", label: "Tester", width: 70 },
  ];

  const rows = data.items.map((item) => ({
    tagId: item.testTagId,
    description: item.description,
    equipmentClass: CLASS_LABELS[item.equipmentClass] ?? item.equipmentClass,
    lastTest: formatDate(item.lastTestDate),
    nextDue: formatDate(item.nextDueDate),
    tester: getTesterName(item),
  }));

  const dataTableConfig: DataTableConfig = {
    columns,
    rows,
    documentColor: docColor,
  };

  const totalsConfig: TextBlockConfig = {
    paragraphs: [
      {
        text: `${data.total} items listed. All items held a current test tag as of ${generatedDateStr}.`,
        bold: true,
        fontSize: 9,
        marginBottom: 4,
      },
      {
        text: "This statement covers only the items listed above. It does not constitute a guarantee of ongoing safety beyond the stated test dates. Equipment should be visually inspected before each use regardless of test tag status.",
        fontSize: 8,
        color: "#666666",
      },
    ],
    documentColor: docColor,
  };

  const signatureConfig: SignatureLineConfig = {
    columns: [
      { label: "Signature" },
      { label: "Date" },
      { label: "Name / Position" },
    ],
  };

  const footerConfig: FooterConfig = {
    text: "Generated by GearFlow | AS/NZS 3760:2022 Compliance",
  };

  return {
    header: JSON.stringify(headerConfig),
    legalStatement: JSON.stringify(legalStatementConfig),
    dataTable: JSON.stringify(dataTableConfig),
    totalsText: JSON.stringify(totalsConfig),
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
