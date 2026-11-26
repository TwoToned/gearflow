/**
 * The Test & tag reports (UX Phase 14, 14a-3b): the one table of report kinds, what each one asks for, and the URL it is
 * fetched from (`/api/test-tag-reports/<key>`). Pure, so the Reports dialog, the per-item `Export report` verb and the tests
 * share ONE definition (the page this replaced had its own copy).
 */
export type ReportKey = "register" | "overdue" | "session" | "item-history" | "due-schedule" | "class-summary" | "tester-activity" | "failed-items" | "bulk-summary" | "compliance-certificate";
export type ReportFormat = "pdf" | "csv";
export type ReportFilter = "dateFrom" | "dateTo" | "search" | "testTagAssetId" | "bulkAssetId";

export interface ReportConfig {
  key: ReportKey;
  title: string;
  description: string;
  formats: readonly ReportFormat[];
  filters: readonly ReportFilter[];
}

const BOTH = ["pdf", "csv"] as const;
const DATES = ["dateFrom", "dateTo"] as const;

export const REPORT_CONFIGS: readonly ReportConfig[] = [
  { key: "register", title: "Full register", description: "Complete T&T inventory with current status. Ideal for auditors or insurers.", formats: BOTH, filters: ["search"] },
  { key: "overdue", title: "Overdue / non-compliant", description: "Items needing immediate action: overdue, failed, or not yet tested.", formats: BOTH, filters: [] },
  { key: "session", title: "Test session report", description: "Results from a testing session within a date range.", formats: BOTH, filters: DATES },
  { key: "item-history", title: "Item history", description: "Full test history for a single item. Search by tag ID.", formats: ["pdf"], filters: ["testTagAssetId"] },
  { key: "due-schedule", title: "Due for testing", description: "Upcoming testing schedule for a date range.", formats: BOTH, filters: DATES },
  { key: "class-summary", title: "Class summary", description: "Fleet breakdown by equipment class and appliance type.", formats: BOTH, filters: [] },
  { key: "tester-activity", title: "Tester activity", description: "Tests performed by each tester over a period.", formats: BOTH, filters: DATES },
  { key: "failed-items", title: "Failed items", description: "Detailed log of failures with reasons and actions taken.", formats: BOTH, filters: DATES },
  { key: "bulk-summary", title: "Bulk asset T&T summary", description: "Status of all T&T items for a specific bulk asset type.", formats: BOTH, filters: ["bulkAssetId"] },
  { key: "compliance-certificate", title: "Compliance certificate", description: "Formal AS/NZS 3760 compliance statement for clients or venues.", formats: ["pdf"], filters: [] },
];

export const reportConfig = (key: ReportKey): ReportConfig => REPORT_CONFIGS.find((r) => r.key === key)!;

/** `format=pdf&dateFrom=…`: only the filters that were filled in. */
export function reportQuery(filters: Record<string, string | undefined>, format: ReportFormat): string {
  const params = new URLSearchParams();
  params.set("format", format);
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  return params.toString();
}

export const reportUrl = (key: ReportKey, filters: Record<string, string | undefined>, format: ReportFormat): string => `/api/test-tag-reports/${key}?${reportQuery(filters, format)}`;

/** The one message that says what to pick before a report can be generated, or `null` when it can. */
export function reportFilterError(key: ReportKey, filters: Record<string, string | undefined>): string | null {
  if (key === "item-history" && !filters.testTagAssetId) return "Please select a test tag item";
  if (key === "bulk-summary" && !filters.bulkAssetId) return "Please select a bulk asset";
  return null;
}

/** The per-item `Export report`: that item's history as a PDF. */
export const itemHistoryReportUrl = (testTagAssetId: string): string => reportUrl("item-history", { testTagAssetId }, "pdf");
