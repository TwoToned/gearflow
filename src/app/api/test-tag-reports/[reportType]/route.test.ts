// @vitest-environment node
//
// The Test & tag report route is the Reports dialog's backend: a signed-in member of the org is not enough, the caller
// needs `reports:view` (the same `requirePermission` the finance document routes use), else 403 before any report is built.
import { describe, expect, test, vi, beforeEach } from "vitest";

const requireOrganization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-server", () => ({ requireOrganization }));
const requirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-context", () => ({ requirePermission }));
const exportRegisterCSV = vi.hoisted(() => vi.fn(async () => "a,b"));
vi.mock("@/server/test-tag-reports", () => ({
  exportRegisterCSV,
  getRegisterReportData: vi.fn(), exportOverdueCSV: vi.fn(), getOverdueReportData: vi.fn(), exportSessionCSV: vi.fn(), getSessionReportData: vi.fn(),
  getItemHistoryReportData: vi.fn(), getDueScheduleReportData: vi.fn(), exportDueScheduleCSV: vi.fn(), getClassSummaryReportData: vi.fn(), exportClassSummaryCSV: vi.fn(),
  getTesterActivityReportData: vi.fn(), exportTesterActivityCSV: vi.fn(), getFailedItemsReportData: vi.fn(), exportFailedItemsCSV: vi.fn(),
  getBulkSummaryReportData: vi.fn(), exportBulkSummaryCSV: vi.fn(), getComplianceCertificateData: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/org-settings-read", () => ({ readOrgSettingsBlob: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getFileAsDataUri: vi.fn() }));
vi.mock("@/lib/pdfme/generate-pdf", () => ({ generateTestTagReport: vi.fn() }));

const { GET } = await import("./route");
const call = (type: string, qs = "format=csv") => GET(new Request(`http://localhost/api/test-tag-reports/${type}?${qs}`) as never, { params: Promise.resolve({ reportType: type }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganization.mockResolvedValue({ organizationId: "org_1" });
  requirePermission.mockResolvedValue({ organizationId: "org_1" });
});

describe("GET /api/test-tag-reports/[reportType]", () => {
  test("a signed-in caller without reports:view gets 403 and no report is built (CSV and PDF)", async () => {
    requirePermission.mockRejectedValue(new Error("Forbidden"));
    for (const [type, qs] of [["register", "format=csv"], ["compliance-certificate", "format=pdf"]]) {
      const res = await call(type, qs);
      expect(res.status).toBe(403);
    }
    expect(requirePermission).toHaveBeenCalledWith("reports", "view");
    expect(exportRegisterCSV).not.toHaveBeenCalled();
  });

  test("no session is still 401, and a caller with reports:view gets the report", async () => {
    requireOrganization.mockRejectedValueOnce(new Error("no session"));
    expect((await call("register")).status).toBe(401);
    const ok = await call("register");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("a,b");
  });
});
