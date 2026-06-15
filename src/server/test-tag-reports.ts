"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getModelById } from "@/lib/models-read";
import type { Prisma } from "@/generated/prisma/client";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  statuses?: string[];
  equipmentClasses?: string[];
  applianceTypes?: string[];
  results?: string[];
  assetLinkType?: "all" | "serialized" | "bulk" | "standalone";
  locations?: string[];
  testedBy?: string[];
  testTagIds?: string[];
  bulkAssetId?: string;
  searchQuery?: string;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function buildAssetWhere(filters: ReportFilters, organizationId: string): Prisma.TestTagAssetWhereInput {
  const where: Prisma.TestTagAssetWhereInput = {
    organizationId,
    isActive: true,
  };

  if (filters.statuses?.length) {
    where.status = { in: filters.statuses as Prisma.EnumTestTagStatusFilter["in"] };
  }
  if (filters.equipmentClasses?.length) {
    where.equipmentClass = { in: filters.equipmentClasses as Prisma.EnumEquipmentClassFilter["in"] };
  }
  if (filters.applianceTypes?.length) {
    where.applianceType = { in: filters.applianceTypes as Prisma.EnumApplianceTypeFilter["in"] };
  }
  if (filters.assetLinkType === "serialized") {
    where.assetId = { not: null };
  } else if (filters.assetLinkType === "bulk") {
    where.bulkAssetId = { not: null };
    where.assetId = null;
  } else if (filters.assetLinkType === "standalone") {
    where.assetId = null;
    where.bulkAssetId = null;
  }
  if (filters.locations?.length) {
    where.location = { in: filters.locations };
  }
  if (filters.searchQuery) {
    where.OR = [
      { testTagId: { contains: filters.searchQuery, mode: "insensitive" } },
      { description: { contains: filters.searchQuery, mode: "insensitive" } },
      { make: { contains: filters.searchQuery, mode: "insensitive" } },
      { modelName: { contains: filters.searchQuery, mode: "insensitive" } },
      { serialNumber: { contains: filters.searchQuery, mode: "insensitive" } },
    ];
  }

  return where;
}

function buildRecordWhere(filters: ReportFilters, organizationId: string): Prisma.TestTagRecordWhereInput {
  const where: Prisma.TestTagRecordWhereInput = { organizationId };

  if (filters.dateFrom || filters.dateTo) {
    where.testDate = {};
    if (filters.dateFrom) where.testDate.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.testDate.lte = new Date(filters.dateTo);
  }
  if (filters.results?.length) {
    where.result = { in: filters.results as Prisma.EnumTestResultFilter["in"] };
  }
  if (filters.testedBy?.length) {
    where.testedById = { in: filters.testedBy };
  }

  return where;
}

const equipmentClassLabels: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (Double Insulated)",
  LEAD_CORD_ASSEMBLY: "Lead / Cord Assembly",
};

const applianceTypeLabels: Record<string, string> = {
  APPLIANCE: "Appliance",
  CORD_SET: "Cord Set",
  EXTENSION_LEAD: "Extension Lead",
  POWER_BOARD: "Power Board",
  RCD_PORTABLE: "RCD (Portable)",
  RCD_FIXED: "RCD (Fixed)",
  THREE_PHASE: "Three Phase",
  MICROWAVE: "Microwave",
  OTHER: "Other",
};

const statusLabels: Record<string, string> = {
  CURRENT: "Current",
  DUE_SOON: "Due Soon",
  OVERDUE: "Overdue",
  FAILED: "Failed",
  NOT_YET_TESTED: "Not Yet Tested",
  RETIRED: "Retired",
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ─── 1. FULL REGISTER ───────────────────────────────────────────────────────

export async function getRegisterReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const where = buildAssetWhere(filters, organizationId);

  const items = await prisma.testTagAsset.findMany({
    where,
    include: {
      asset: { select: { id: true, assetTag: true } },
      bulkAsset: { select: { id: true, assetTag: true } },
    },
    orderBy: { testTagId: "asc" },
  });

  const statusCounts: Record<string, number> = {};
  for (const item of items) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }

  const compliant = (statusCounts["CURRENT"] || 0) + (statusCounts["DUE_SOON"] || 0);
  const complianceRate = items.length > 0 ? Math.round((compliant / items.length) * 100) : 0;

  return serialize({ items, statusCounts, complianceRate, total: items.length });
}

export async function exportRegisterCSV(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const where = buildAssetWhere(filters, organizationId);

  const items = await prisma.testTagAsset.findMany({
    where,
    include: {
      asset: { select: { assetTag: true } },
      bulkAsset: { select: { assetTag: true } },
    },
    orderBy: { testTagId: "asc" },
  });

  const headers = ["testTagId", "description", "equipmentClass", "applianceType", "make", "modelName", "serialNumber", "location", "testIntervalMonths", "lastTestDate", "nextDueDate", "status", "linkedAssetTag", "linkedBulkAsset"];

  const rows = items.map((i) => [
    i.testTagId, i.description, equipmentClassLabels[i.equipmentClass] || i.equipmentClass,
    applianceTypeLabels[i.applianceType] || i.applianceType, i.make || "", i.modelName || "",
    i.serialNumber || "", i.location || "", String(i.testIntervalMonths),
    fmtDate(i.lastTestDate), fmtDate(i.nextDueDate), statusLabels[i.status] || i.status,
    i.asset?.assetTag || "", i.bulkAsset?.assetTag || "",
  ]);

  return escapeCSV(headers, rows);
}

// ─── 2. OVERDUE & NON-COMPLIANT ─────────────────────────────────────────────

export async function getOverdueReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const baseWhere = buildAssetWhere({ ...filters, statuses: undefined }, organizationId);

  const [overdueItems, failedItems, notTestedItems] = await Promise.all([
    prisma.testTagAsset.findMany({
      where: { ...baseWhere, status: "OVERDUE" },
      include: {
        asset: { select: { assetTag: true } },
        bulkAsset: { select: { assetTag: true } },
      },
      orderBy: { nextDueDate: "asc" },
    }),
    prisma.testTagAsset.findMany({
      where: { ...baseWhere, status: "FAILED" },
      include: {
        asset: { select: { assetTag: true } },
        bulkAsset: { select: { assetTag: true } },
        testRecords: { orderBy: { testDate: "desc" }, take: 1 },
      },
      orderBy: { lastTestDate: "desc" },
    }),
    prisma.testTagAsset.findMany({
      where: { ...baseWhere, status: "NOT_YET_TESTED" },
      include: {
        asset: { select: { assetTag: true } },
        bulkAsset: { select: { assetTag: true } },
      },
      orderBy: { testTagId: "asc" },
    }),
  ]);

  return serialize({ overdueItems, failedItems, notTestedItems });
}

export async function exportOverdueCSV(filters: ReportFilters) {
  const data = await getOverdueReportData(filters);
  const allItems = [...data.overdueItems, ...data.failedItems, ...data.notTestedItems];

  const headers = ["testTagId", "description", "equipmentClass", "applianceType", "status", "lastTestDate", "nextDueDate", "location"];
  const rows = allItems.map((i: { testTagId: string; description: string; equipmentClass: string; applianceType: string; status: string; lastTestDate: Date | string | null; nextDueDate: Date | string | null; location: string | null }) => [
    i.testTagId, i.description, equipmentClassLabels[i.equipmentClass] || i.equipmentClass,
    applianceTypeLabels[i.applianceType] || i.applianceType, statusLabels[i.status] || i.status,
    fmtDate(i.lastTestDate), fmtDate(i.nextDueDate), i.location || "",
  ]);

  return escapeCSV(headers, rows);
}

// ─── 3. TEST SESSION ────────────────────────────────────────────────────────

export async function getSessionReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const recordWhere = buildRecordWhere(filters, organizationId);

  const records = await prisma.testTagRecord.findMany({
    where: recordWhere,
    include: {
      testTagAsset: { select: { testTagId: true, description: true, equipmentClass: true } },
      testedBy: { select: { name: true } },
      testProfile: { select: { id: true, name: true } },
      subTestRecords: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { testDate: "desc" },
  });

  const passCount = records.filter((r) => r.result === "PASS").length;
  const failCount = records.filter((r) => r.result === "FAIL").length;

  return serialize({ records, passCount, failCount, total: records.length });
}

export async function exportSessionCSV(filters: ReportFilters) {
  const data = await getSessionReportData(filters);

  const headers = ["testDate", "testTagId", "description", "equipmentClass", "visual", "earthContinuity", "insulation", "leakage", "polarity", "rcd", "result", "tester", "notes", "subTests"];
  const rows = data.records.map((r: { testDate: Date | string; testTagAsset: { testTagId: string; description: string; equipmentClass: string }; visualInspectionResult: string; earthContinuityResult: string; insulationResult: string; leakageCurrentResult: string; polarityResult: string; rcdTripTimeResult: string; result: string; testerName: string; failureNotes: string | null; functionalTestNotes: string | null; subTestRecords?: { label: string; result: string; earthContinuityReading: number | null; insulationReading: number | null; leakageCurrentReading: number | null }[] }) => {
    const subTestSummary = r.subTestRecords && r.subTestRecords.length > 0
      ? r.subTestRecords.map((st) => {
          const parts = [st.label, st.result];
          if (st.earthContinuityReading != null) parts.push(`Earth: ${st.earthContinuityReading.toFixed(2)}`);
          if (st.insulationReading != null) parts.push(`Insul: ${st.insulationReading.toFixed(2)}`);
          if (st.leakageCurrentReading != null) parts.push(`Leak: ${st.leakageCurrentReading.toFixed(2)}`);
          return parts.join(" | ");
        }).join(" // ")
      : "";
    return [
      fmtDate(r.testDate), r.testTagAsset.testTagId, r.testTagAsset.description,
      equipmentClassLabels[r.testTagAsset.equipmentClass] || r.testTagAsset.equipmentClass,
      r.visualInspectionResult, r.earthContinuityResult, r.insulationResult,
      r.leakageCurrentResult, r.polarityResult, r.rcdTripTimeResult,
      r.result, r.testerName, r.failureNotes || r.functionalTestNotes || "", subTestSummary,
    ];
  });

  return escapeCSV(headers, rows);
}

// ─── 4. ITEM HISTORY ────────────────────────────────────────────────────────

export async function getItemHistoryReportData(testTagAssetId: string) {
  const { organizationId } = await getOrgContext();

  const item = await prisma.testTagAsset.findFirst({
    where: { id: testTagAssetId, organizationId },
    include: {
      asset: { select: { assetTag: true, customName: true } },
      bulkAsset: { select: { assetTag: true } },
      testProfile: { select: { id: true, name: true } },
      testRecords: {
        orderBy: { testDate: "desc" },
        include: {
          testedBy: { select: { name: true } },
          testProfile: { select: { id: true, name: true } },
          subTestRecords: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (!item) throw new Error("Test tag asset not found");
  return serialize(item);
}

// ─── 5. DUE SCHEDULE ────────────────────────────────────────────────────────

export async function getDueScheduleReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date();
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })();

  const baseWhere = buildAssetWhere({ ...filters, statuses: undefined }, organizationId);

  const items = await prisma.testTagAsset.findMany({
    where: {
      ...baseWhere,
      nextDueDate: { gte: dateFrom, lte: dateTo },
      status: { in: ["CURRENT", "DUE_SOON"] },
    },
    orderBy: { nextDueDate: "asc" },
  });

  // Also include overdue items
  const overdueItems = await prisma.testTagAsset.findMany({
    where: {
      ...baseWhere,
      status: "OVERDUE",
    },
    orderBy: { nextDueDate: "asc" },
  });

  return serialize({ items, overdueItems, dateFrom, dateTo });
}

export async function exportDueScheduleCSV(filters: ReportFilters) {
  const data = await getDueScheduleReportData(filters);
  const allItems = [...data.overdueItems, ...data.items];

  const headers = ["testTagId", "description", "equipmentClass", "applianceType", "location", "nextDueDate", "status"];
  const rows = allItems.map((i: { testTagId: string; description: string; equipmentClass: string; applianceType: string; location: string | null; nextDueDate: Date | string | null; status: string }) => [
    i.testTagId, i.description, equipmentClassLabels[i.equipmentClass] || i.equipmentClass,
    applianceTypeLabels[i.applianceType] || i.applianceType, i.location || "",
    fmtDate(i.nextDueDate), statusLabels[i.status] || i.status,
  ]);

  return escapeCSV(headers, rows);
}

// ─── 6. CLASS SUMMARY ───────────────────────────────────────────────────────

export async function getClassSummaryReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const baseWhere = buildAssetWhere({ ...filters, statuses: undefined, equipmentClasses: undefined, applianceTypes: undefined }, organizationId);

  const items = await prisma.testTagAsset.findMany({
    where: baseWhere,
    select: { equipmentClass: true, applianceType: true, status: true },
  });

  // Group by class -> applianceType
  const groups: Record<string, Record<string, Record<string, number>>> = {};
  for (const item of items) {
    if (!groups[item.equipmentClass]) groups[item.equipmentClass] = {};
    if (!groups[item.equipmentClass][item.applianceType]) {
      groups[item.equipmentClass][item.applianceType] = { total: 0, CURRENT: 0, DUE_SOON: 0, OVERDUE: 0, FAILED: 0, NOT_YET_TESTED: 0 };
    }
    groups[item.equipmentClass][item.applianceType].total++;
    groups[item.equipmentClass][item.applianceType][item.status] = (groups[item.equipmentClass][item.applianceType][item.status] || 0) + 1;
  }

  return serialize({ groups, total: items.length });
}

export async function exportClassSummaryCSV(filters: ReportFilters) {
  const data = await getClassSummaryReportData(filters);

  const headers = ["equipmentClass", "applianceType", "total", "current", "dueSoon", "overdue", "failed", "notYetTested", "complianceRate"];
  const rows: string[][] = [];

  for (const [cls, types] of Object.entries(data.groups as Record<string, Record<string, Record<string, number>>>)) {
    for (const [type, counts] of Object.entries(types)) {
      const compliant = (counts.CURRENT || 0) + (counts.DUE_SOON || 0);
      const rate = counts.total > 0 ? Math.round((compliant / counts.total) * 100) : 0;
      rows.push([
        equipmentClassLabels[cls] || cls, applianceTypeLabels[type] || type,
        String(counts.total), String(counts.CURRENT || 0), String(counts.DUE_SOON || 0),
        String(counts.OVERDUE || 0), String(counts.FAILED || 0), String(counts.NOT_YET_TESTED || 0),
        `${rate}%`,
      ]);
    }
  }

  return escapeCSV(headers, rows);
}

// ─── 7. TESTER ACTIVITY ─────────────────────────────────────────────────────

export async function getTesterActivityReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const recordWhere = buildRecordWhere(filters, organizationId);

  const records = await prisma.testTagRecord.findMany({
    where: recordWhere,
    include: {
      testTagAsset: { select: { testTagId: true, description: true } },
      testedBy: { select: { id: true, name: true } },
    },
    orderBy: { testDate: "desc" },
  });

  // Group by tester
  const testers: Record<string, { name: string; totalTests: number; passCount: number; failCount: number; records: typeof records }> = {};
  for (const r of records) {
    const key = r.testedById || r.testerName;
    const name = r.testedBy?.name || r.testerName;
    if (!testers[key]) {
      testers[key] = { name, totalTests: 0, passCount: 0, failCount: 0, records: [] };
    }
    testers[key].totalTests++;
    if (r.result === "PASS") testers[key].passCount++;
    else testers[key].failCount++;
    testers[key].records.push(r);
  }

  return serialize({ testers, totalRecords: records.length });
}

export async function exportTesterActivityCSV(filters: ReportFilters) {
  const data = await getTesterActivityReportData(filters);

  const headers = ["tester", "testDate", "testTagId", "description", "result"];
  const rows: string[][] = [];

  for (const tester of Object.values(data.testers as Record<string, { name: string; records: { testDate: Date | string; testTagAsset: { testTagId: string; description: string }; result: string }[] }>)) {
    for (const r of tester.records) {
      rows.push([tester.name, fmtDate(r.testDate), r.testTagAsset.testTagId, r.testTagAsset.description, r.result]);
    }
  }

  return escapeCSV(headers, rows);
}

// ─── 8. FAILED ITEMS ────────────────────────────────────────────────────────

export async function getFailedItemsReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const recordWhere = buildRecordWhere({ ...filters, results: ["FAIL"] }, organizationId);

  // Also apply asset-level filters
  const assetWhere = buildAssetWhere(filters, organizationId);

  const records = await prisma.testTagRecord.findMany({
    where: {
      ...recordWhere,
      testTagAsset: assetWhere,
    },
    include: {
      testTagAsset: { select: { testTagId: true, description: true, equipmentClass: true, applianceType: true } },
      testedBy: { select: { name: true } },
      testProfile: { select: { id: true, name: true } },
      subTestRecords: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { testDate: "desc" },
  });

  // Breakdown by failure type
  const failureBreakdown = {
    visual: records.filter((r) => r.visualInspectionResult === "FAIL").length,
    earthContinuity: records.filter((r) => r.earthContinuityResult === "FAIL").length,
    insulation: records.filter((r) => r.insulationResult === "FAIL").length,
    leakage: records.filter((r) => r.leakageCurrentResult === "FAIL").length,
    polarity: records.filter((r) => r.polarityResult === "FAIL").length,
    rcd: records.filter((r) => r.rcdTripTimeResult === "FAIL").length,
    functional: records.filter((r) => r.functionalTestResult === "FAIL").length,
  };

  return serialize({ records, failureBreakdown, total: records.length });
}

export async function exportFailedItemsCSV(filters: ReportFilters) {
  const data = await getFailedItemsReportData(filters);

  const headers = ["testDate", "testTagId", "description", "equipmentClass", "applianceType", "tester", "failedTests", "failureAction", "failureNotes", "subTests"];
  const rows = data.records.map((r: { testDate: Date | string; testTagAsset: { testTagId: string; description: string; equipmentClass: string; applianceType: string }; testerName: string; visualInspectionResult: string; earthContinuityResult: string; insulationResult: string; leakageCurrentResult: string; polarityResult: string; rcdTripTimeResult: string; failureAction: string; failureNotes: string | null; subTestRecords?: { label: string; result: string; earthContinuityReading: number | null; insulationReading: number | null; leakageCurrentReading: number | null }[] }) => {
    const failed: string[] = [];
    if (r.visualInspectionResult === "FAIL") failed.push("Visual");
    if (r.earthContinuityResult === "FAIL") failed.push("Earth");
    if (r.insulationResult === "FAIL") failed.push("Insulation");
    if (r.leakageCurrentResult === "FAIL") failed.push("Leakage");
    if (r.polarityResult === "FAIL") failed.push("Polarity");
    if (r.rcdTripTimeResult === "FAIL") failed.push("RCD");
    const subTestSummary = r.subTestRecords && r.subTestRecords.length > 0
      ? r.subTestRecords.map((st) => {
          const parts = [st.label, st.result];
          if (st.earthContinuityReading != null) parts.push(`Earth: ${st.earthContinuityReading.toFixed(2)}`);
          if (st.insulationReading != null) parts.push(`Insul: ${st.insulationReading.toFixed(2)}`);
          if (st.leakageCurrentReading != null) parts.push(`Leak: ${st.leakageCurrentReading.toFixed(2)}`);
          return parts.join(" | ");
        }).join(" // ")
      : "";
    return [
      fmtDate(r.testDate), r.testTagAsset.testTagId, r.testTagAsset.description,
      equipmentClassLabels[r.testTagAsset.equipmentClass] || r.testTagAsset.equipmentClass,
      applianceTypeLabels[r.testTagAsset.applianceType] || r.testTagAsset.applianceType,
      r.testerName, failed.join("; "), r.failureAction || "", r.failureNotes || "", subTestSummary,
    ];
  });

  return escapeCSV(headers, rows);
}

// ─── 9. BULK ASSET SUMMARY ──────────────────────────────────────────────────

export async function getBulkSummaryReportData(bulkAssetId: string, filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  const bulkAsset = await prisma.bulkAsset.findFirst({
    where: { id: bulkAssetId, organizationId },
  });
  if (!bulkAsset) throw new Error("Bulk asset not found");
  const bulkModel = await getModelById(bulkAsset.modelId);

  const baseWhere = buildAssetWhere({ ...filters }, organizationId);
  const items = await prisma.testTagAsset.findMany({
    where: { ...baseWhere, bulkAssetId },
    orderBy: { testTagId: "asc" },
  });

  const statusCounts: Record<string, number> = {};
  for (const item of items) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }

  const compliant = (statusCounts["CURRENT"] || 0) + (statusCounts["DUE_SOON"] || 0);
  const complianceRate = items.length > 0 ? Math.round((compliant / items.length) * 100) : 0;

  return serialize({
    bulkAsset: { assetTag: bulkAsset.assetTag, totalQuantity: bulkAsset.totalQuantity, modelName: bulkModel?.name ?? "", manufacturer: bulkModel?.manufacturer ?? null },
    items,
    statusCounts,
    complianceRate,
    registeredCount: items.length,
  });
}

export async function exportBulkSummaryCSV(bulkAssetId: string, filters: ReportFilters) {
  const data = await getBulkSummaryReportData(bulkAssetId, filters);

  const headers = ["testTagId", "description", "serialNumber", "location", "lastTestDate", "nextDueDate", "status"];
  const rows = data.items.map((i: { testTagId: string; description: string; serialNumber: string | null; location: string | null; lastTestDate: Date | string | null; nextDueDate: Date | string | null; status: string }) => [
    i.testTagId, i.description, i.serialNumber || "", i.location || "",
    fmtDate(i.lastTestDate), fmtDate(i.nextDueDate), statusLabels[i.status] || i.status,
  ]);

  return escapeCSV(headers, rows);
}

// ─── 10. COMPLIANCE CERTIFICATE ──────────────────────────────────────────────

export async function getComplianceCertificateData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const baseWhere = buildAssetWhere({ ...filters, statuses: ["CURRENT"] }, organizationId);

  const items = await prisma.testTagAsset.findMany({
    where: baseWhere,
    include: {
      testRecords: {
        orderBy: { testDate: "desc" },
        take: 1,
        include: { testedBy: { select: { name: true } } },
      },
    },
    orderBy: { testTagId: "asc" },
  });

  return serialize({ items, total: items.length, generatedDate: new Date().toISOString() });
}

// ─── REPORT COUNTS (for preview) ────────────────────────────────────────────

export async function getReportPreviewCount(reportType: string, filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  if (reportType === "session" || reportType === "tester-activity" || reportType === "failed-items") {
    const recordWhere = buildRecordWhere(
      reportType === "failed-items" ? { ...filters, results: ["FAIL"] } : filters,
      organizationId
    );
    if (reportType === "failed-items") {
      const assetWhere = buildAssetWhere(filters, organizationId);
      return prisma.testTagRecord.count({ where: { ...recordWhere, testTagAsset: assetWhere } });
    }
    return prisma.testTagRecord.count({ where: recordWhere });
  }

  if (reportType === "overdue") {
    const baseWhere = buildAssetWhere({ ...filters, statuses: undefined }, organizationId);
    return prisma.testTagAsset.count({
      where: { ...baseWhere, status: { in: ["OVERDUE", "FAILED", "NOT_YET_TESTED"] } },
    });
  }

  if (reportType === "compliance-certificate") {
    const where = buildAssetWhere({ ...filters, statuses: ["CURRENT"] }, organizationId);
    return prisma.testTagAsset.count({ where });
  }

  if (reportType === "due-schedule") {
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date();
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })();
    const baseWhere = buildAssetWhere({ ...filters, statuses: undefined }, organizationId);
    const [due, overdue] = await Promise.all([
      prisma.testTagAsset.count({
        where: { ...baseWhere, nextDueDate: { gte: dateFrom, lte: dateTo }, status: { in: ["CURRENT", "DUE_SOON"] } },
      }),
      prisma.testTagAsset.count({ where: { ...baseWhere, status: "OVERDUE" } }),
    ]);
    return due + overdue;
  }

  const where = buildAssetWhere(filters, organizationId);
  return prisma.testTagAsset.count({ where });
}

// ─── CSV HELPER ─────────────────────────────────────────────────────────────

function escapeCSV(headers: string[], rows: string[][]): string {
  const escapeLine = (fields: string[]) =>
    fields
      .map((f) => {
        if (f.includes(",") || f.includes('"') || f.includes("\n")) {
          return `"${f.replace(/"/g, '""')}"`;
        }
        return f;
      })
      .join(",");

  return [escapeLine(headers), ...rows.map(escapeLine)].join("\n");
}
