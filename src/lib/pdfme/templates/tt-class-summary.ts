/**
 * Equipment Class Summary template — landscape A4.
 * Groups items by equipment class with appliance type breakdowns per section.
 * Shows compliance percentage per row.
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

interface ClassSummaryData {
  groups: Record<string, Record<string, Record<string, number>>>;
  total: number;
}

export function buildTtClassSummaryTemplate(): Template {
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

export function buildTtClassSummaryInputs(
  data: ClassSummaryData,
  orgData: OrgData
): Record<string, string> {
  const docColor = orgData.branding?.documentColor || "#0d9488";

  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: "EQUIPMENT CLASS SUMMARY",
    docMeta: formatDate(new Date()),
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const columns: DataTableColumn[] = [
    { key: "applianceType", label: "Appliance Type", width: 80 },
    { key: "total", label: "Total", width: 35, align: "center" },
    { key: "current", label: "Current", width: 35, align: "center" },
    { key: "dueSoon", label: "Due Soon", width: 40, align: "center" },
    { key: "overdue", label: "Overdue", width: 40, align: "center" },
    { key: "failed", label: "Failed", width: 35, align: "center" },
    { key: "notTested", label: "Not Tested", width: 45, align: "center" },
    { key: "compliance", label: "Compliance %", width: 45, align: "center" },
  ];

  const sections: DataTableSection[] = [];

  for (const [equipmentClass, applianceTypes] of Object.entries(data.groups)) {
    const rows: Record<string, string | number | null>[] = [];

    for (const [applianceType, counts] of Object.entries(applianceTypes)) {
      const total = counts.total ?? 0;
      const current = counts.CURRENT ?? 0;
      const dueSoon = counts.DUE_SOON ?? 0;
      const overdue = counts.OVERDUE ?? 0;
      const failed = counts.FAILED ?? 0;
      const notTested = counts.NOT_YET_TESTED ?? 0;
      const compliance = total > 0
        ? Math.round(((current + dueSoon) / total) * 100)
        : 0;

      rows.push({
        applianceType: TYPE_LABELS[applianceType] ?? applianceType,
        total,
        current,
        dueSoon,
        overdue,
        failed,
        notTested,
        compliance: `${compliance}%`,
      });
    }

    sections.push({
      title: CLASS_LABELS[equipmentClass] ?? equipmentClass,
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
    secondLine: `Equipment Class Summary | Generated ${formatDate(new Date())}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    dataTable: JSON.stringify(dataTableConfig),
    footer: JSON.stringify(footerConfig),
  };
}
