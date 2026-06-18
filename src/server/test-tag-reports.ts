"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getModelById } from "@/lib/models-read";
import { getAssetsByOrg, getBulkAssetsByOrg, getBulkAssetById } from "@/lib/assets-read";
import type { ReportFilters } from "@/lib/test-tag-report-types";
import {
  assetMatchesFilters,
  recordMatchesFilters,
  getTestTagAssetsByOrg,
  getTestTagAssetById,
  getTestTagRecordsByOrg,
  getSubTestRecordsByRecordIds,
  getTestProfileMap,
  getUserNameMap,
  type TTAsset,
  type TTRecord,
  type SubTestRecord,
} from "@/lib/test-tag-read";

// ─── LABELS ───────────────────────────────────────────────────────────────────

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

// ─── INTERNAL: Convex loaders + sort/attach helpers ───────────────────────────
//
// The reports moved off Prisma to Convex (Phase A read-rewiring). Org-scoped
// reads come from Convex; tester names (Better Auth `User`) stay on Prisma. The
// old Prisma `where`/`orderBy`/`include` become JS predicate + sort + attach.

const ms = (d: Date | null) => (d ? d.getTime() : null);

/** Postgres ASC default = NULLS LAST. */
function cmpDateAsc(a: Date | null, b: Date | null): number {
  const av = ms(a);
  const bv = ms(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av - bv;
}

/** Postgres DESC default = NULLS FIRST. */
function cmpDateDesc(a: Date | null, b: Date | null): number {
  const av = ms(a);
  const bv = ms(b);
  if (av === null && bv === null) return 0;
  if (av === null) return -1;
  if (bv === null) return 1;
  return bv - av;
}

const cmpStrAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Org asset/bulk lookup maps for resolving `testTagAsset.asset` / `.bulkAsset`. */
async function loadLinkMaps(orgId: string) {
  const [assets, bulks] = await Promise.all([getAssetsByOrg(orgId), getBulkAssetsByOrg(orgId)]);
  return {
    asset: new Map(assets.map((a) => [a.id, a])),
    bulk: new Map(bulks.map((b) => [b.id, b])),
  };
}

/** Group org test records by their `testTagAssetId`, each list sorted testDate desc. */
function recordsByAsset(records: TTRecord[]): Map<string, TTRecord[]> {
  const map = new Map<string, TTRecord[]>();
  for (const r of records) {
    const arr = map.get(r.testTagAssetId);
    if (arr) arr.push(r);
    else map.set(r.testTagAssetId, [r]);
  }
  for (const arr of map.values()) arr.sort((a, b) => cmpDateDesc(a.testDate, b.testDate));
  return map;
}

/** Sub-test records keyed by parent record id (already sorted by sortOrder). */
async function loadSubTestsByRecord(recordIds: string[]): Promise<Map<string, SubTestRecord[]>> {
  const subs = await getSubTestRecordsByRecordIds(recordIds);
  const map = new Map<string, SubTestRecord[]>();
  for (const s of subs) {
    const arr = map.get(s.testTagRecordId);
    if (arr) arr.push(s);
    else map.set(s.testTagRecordId, [s]);
  }
  return map;
}

type AssetLink = { id: string; assetTag: string } | null;
type AssetLinkTag = { assetTag: string } | null;

function linkIdTag(item: TTAsset, maps: { asset: Map<string, { id: string; assetTag: string }>; bulk: Map<string, { id: string; assetTag: string }> }): {
  asset: AssetLink;
  bulkAsset: AssetLink;
} {
  const a = item.assetId ? maps.asset.get(item.assetId) : undefined;
  const b = item.bulkAssetId ? maps.bulk.get(item.bulkAssetId) : undefined;
  return {
    asset: a ? { id: a.id, assetTag: a.assetTag } : null,
    bulkAsset: b ? { id: b.id, assetTag: b.assetTag } : null,
  };
}

function linkTag(item: TTAsset, maps: { asset: Map<string, { assetTag: string }>; bulk: Map<string, { assetTag: string }> }): {
  asset: AssetLinkTag;
  bulkAsset: AssetLinkTag;
} {
  const a = item.assetId ? maps.asset.get(item.assetId) : undefined;
  const b = item.bulkAssetId ? maps.bulk.get(item.bulkAssetId) : undefined;
  return {
    asset: a ? { assetTag: a.assetTag } : null,
    bulkAsset: b ? { assetTag: b.assetTag } : null,
  };
}

// ─── 1. FULL REGISTER ───────────────────────────────────────────────────────

async function loadRegisterItems(orgId: string, filters: ReportFilters) {
  const all = await getTestTagAssetsByOrg(orgId);
  const filtered = all.filter((i) => assetMatchesFilters(i, filters)).sort((a, b) => cmpStrAsc(a.testTagId, b.testTagId));
  const maps = await loadLinkMaps(orgId);
  return filtered.map((i) => ({ ...i, ...linkIdTag(i, maps) }));
}

export async function getRegisterReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();
  const items = await loadRegisterItems(organizationId, filters);

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
  const items = await loadRegisterItems(organizationId, filters);

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
  const baseFilters = { ...filters, statuses: undefined };

  const [all, records, maps] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
    loadLinkMaps(organizationId),
  ]);
  const matches = all.filter((i) => assetMatchesFilters(i, baseFilters));
  const byAsset = recordsByAsset(records);

  const overdueItems = matches
    .filter((i) => i.status === "OVERDUE")
    .sort((a, b) => cmpDateAsc(a.nextDueDate, b.nextDueDate))
    .map((i) => ({ ...i, ...linkTag(i, maps) }));

  const failedItems = matches
    .filter((i) => i.status === "FAILED")
    .sort((a, b) => cmpDateDesc(a.lastTestDate, b.lastTestDate))
    .map((i) => ({ ...i, ...linkTag(i, maps), testRecords: (byAsset.get(i.id) ?? []).slice(0, 1) }));

  const notTestedItems = matches
    .filter((i) => i.status === "NOT_YET_TESTED")
    .sort((a, b) => cmpStrAsc(a.testTagId, b.testTagId))
    .map((i) => ({ ...i, ...linkTag(i, maps) }));

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

  const [allAssets, allRecords, profileMap] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
    getTestProfileMap(organizationId),
  ]);
  const assetById = new Map(allAssets.map((a) => [a.id, a]));

  const filtered = allRecords
    .filter((r) => recordMatchesFilters(r, filters))
    .sort((a, b) => cmpDateDesc(a.testDate, b.testDate));

  const [subMap, userMap] = await Promise.all([
    loadSubTestsByRecord(filtered.map((r) => r.id)),
    getUserNameMap(filtered.map((r) => r.testedById)),
  ]);

  const records = filtered.map((r) => {
    const a = assetById.get(r.testTagAssetId);
    return {
      ...r,
      testTagAsset: a
        ? { testTagId: a.testTagId, description: a.description, equipmentClass: a.equipmentClass }
        : null,
      testedBy: { name: userMap.get(r.testedById) ?? r.testerName },
      testProfile: r.testProfileId ? profileMap.get(r.testProfileId) ?? null : null,
      subTestRecords: subMap.get(r.id) ?? [],
    };
  });

  const passCount = records.filter((r) => r.result === "PASS").length;
  const failCount = records.filter((r) => r.result === "FAIL").length;

  return serialize({ records, passCount, failCount, total: records.length });
}

export async function exportSessionCSV(filters: ReportFilters) {
  const data = await getSessionReportData(filters);

  const headers = ["testDate", "testTagId", "description", "equipmentClass", "visual", "earthContinuity", "insulation", "leakage", "polarity", "rcd", "result", "tester", "notes", "subTests"];
  const rows = data.records.map((r: { testDate: Date | string; testTagAsset: { testTagId: string; description: string; equipmentClass: string } | null; visualInspectionResult: string; earthContinuityResult: string; insulationResult: string; leakageCurrentResult: string; polarityResult: string; rcdTripTimeResult: string; result: string; testerName: string; failureNotes: string | null; functionalTestNotes: string | null; subTestRecords?: { label: string; result: string; earthContinuityReading: number | null; insulationReading: number | null; leakageCurrentReading: number | null }[] }) => {
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
      fmtDate(r.testDate), r.testTagAsset?.testTagId ?? "", r.testTagAsset?.description ?? "",
      equipmentClassLabels[r.testTagAsset?.equipmentClass ?? ""] || (r.testTagAsset?.equipmentClass ?? ""),
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

  const item = await getTestTagAssetById(testTagAssetId);
  if (!item || item.organizationId !== organizationId) throw new Error("Test tag asset not found");

  const [allRecords, maps, profileMap] = await Promise.all([
    getTestTagRecordsByOrg(organizationId),
    loadLinkMaps(organizationId),
    getTestProfileMap(organizationId),
  ]);

  const recs = allRecords
    .filter((r) => r.testTagAssetId === testTagAssetId)
    .sort((a, b) => cmpDateDesc(a.testDate, b.testDate));

  const [subMap, userMap] = await Promise.all([
    loadSubTestsByRecord(recs.map((r) => r.id)),
    getUserNameMap(recs.map((r) => r.testedById)),
  ]);

  const a = item.assetId ? maps.asset.get(item.assetId) : undefined;
  const b = item.bulkAssetId ? maps.bulk.get(item.bulkAssetId) : undefined;

  const testRecords = recs.map((r) => ({
    ...r,
    testedBy: { name: userMap.get(r.testedById) ?? r.testerName },
    testProfile: r.testProfileId ? profileMap.get(r.testProfileId) ?? null : null,
    subTestRecords: subMap.get(r.id) ?? [],
  }));

  return serialize({
    ...item,
    asset: a ? { assetTag: a.assetTag, customName: a.customName ?? null } : null,
    bulkAsset: b ? { assetTag: b.assetTag } : null,
    testProfile: item.testProfileId ? profileMap.get(item.testProfileId) ?? null : null,
    testRecords,
  });
}

// ─── 5. DUE SCHEDULE ────────────────────────────────────────────────────────

export async function getDueScheduleReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date();
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })();

  const all = await getTestTagAssetsByOrg(organizationId);
  const matches = all.filter((i) => assetMatchesFilters(i, { ...filters, statuses: undefined }));

  const items = matches
    .filter(
      (i) =>
        i.nextDueDate != null &&
        i.nextDueDate.getTime() >= dateFrom.getTime() &&
        i.nextDueDate.getTime() <= dateTo.getTime() &&
        (i.status === "CURRENT" || i.status === "DUE_SOON"),
    )
    .sort((a, b) => cmpDateAsc(a.nextDueDate, b.nextDueDate));

  const overdueItems = matches
    .filter((i) => i.status === "OVERDUE")
    .sort((a, b) => cmpDateAsc(a.nextDueDate, b.nextDueDate));

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
  const all = await getTestTagAssetsByOrg(organizationId);
  const items = all.filter((i) =>
    assetMatchesFilters(i, { ...filters, statuses: undefined, equipmentClasses: undefined, applianceTypes: undefined }),
  );

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

  const [allAssets, allRecords] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
  ]);
  const assetById = new Map(allAssets.map((a) => [a.id, a]));

  const filtered = allRecords
    .filter((r) => recordMatchesFilters(r, filters))
    .sort((a, b) => cmpDateDesc(a.testDate, b.testDate));

  const userMap = await getUserNameMap(filtered.map((r) => r.testedById));

  const records = filtered.map((r) => {
    const a = assetById.get(r.testTagAssetId);
    return {
      ...r,
      testTagAsset: a ? { testTagId: a.testTagId, description: a.description } : null,
      testedBy: { id: r.testedById, name: userMap.get(r.testedById) ?? r.testerName },
    };
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

  for (const tester of Object.values(data.testers as Record<string, { name: string; records: { testDate: Date | string; testTagAsset: { testTagId: string; description: string } | null; result: string }[] }>)) {
    for (const r of tester.records) {
      rows.push([tester.name, fmtDate(r.testDate), r.testTagAsset?.testTagId ?? "", r.testTagAsset?.description ?? "", r.result]);
    }
  }

  return escapeCSV(headers, rows);
}

// ─── 8. FAILED ITEMS ────────────────────────────────────────────────────────

export async function getFailedItemsReportData(filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  const [allAssets, allRecords, profileMap] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
    getTestProfileMap(organizationId),
  ]);
  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  // The old query used a relation filter `testTagAsset: assetWhere`, so a record
  // only matches when its parent asset matches the asset-level filters.
  const matchingAssetIds = new Set(allAssets.filter((a) => assetMatchesFilters(a, filters)).map((a) => a.id));

  const filtered = allRecords
    .filter((r) => recordMatchesFilters(r, { ...filters, results: ["FAIL"] }))
    .filter((r) => matchingAssetIds.has(r.testTagAssetId))
    .sort((a, b) => cmpDateDesc(a.testDate, b.testDate));

  const [subMap, userMap] = await Promise.all([
    loadSubTestsByRecord(filtered.map((r) => r.id)),
    getUserNameMap(filtered.map((r) => r.testedById)),
  ]);

  const records = filtered.map((r) => {
    const a = assetById.get(r.testTagAssetId);
    return {
      ...r,
      testTagAsset: a
        ? { testTagId: a.testTagId, description: a.description, equipmentClass: a.equipmentClass, applianceType: a.applianceType }
        : null,
      testedBy: { name: userMap.get(r.testedById) ?? r.testerName },
      testProfile: r.testProfileId ? profileMap.get(r.testProfileId) ?? null : null,
      subTestRecords: subMap.get(r.id) ?? [],
    };
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
  const rows = data.records.map((r: { testDate: Date | string; testTagAsset: { testTagId: string; description: string; equipmentClass: string; applianceType: string } | null; testerName: string; visualInspectionResult: string; earthContinuityResult: string; insulationResult: string; leakageCurrentResult: string; polarityResult: string; rcdTripTimeResult: string; failureAction: string; failureNotes: string | null; subTestRecords?: { label: string; result: string; earthContinuityReading: number | null; insulationReading: number | null; leakageCurrentReading: number | null }[] }) => {
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
      fmtDate(r.testDate), r.testTagAsset?.testTagId ?? "", r.testTagAsset?.description ?? "",
      equipmentClassLabels[r.testTagAsset?.equipmentClass ?? ""] || (r.testTagAsset?.equipmentClass ?? ""),
      applianceTypeLabels[r.testTagAsset?.applianceType ?? ""] || (r.testTagAsset?.applianceType ?? ""),
      r.testerName, failed.join("; "), r.failureAction || "", r.failureNotes || "", subTestSummary,
    ];
  });

  return escapeCSV(headers, rows);
}

// ─── 9. BULK ASSET SUMMARY ──────────────────────────────────────────────────

export async function getBulkSummaryReportData(bulkAssetId: string, filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  const bulkAsset = await getBulkAssetById(bulkAssetId);
  if (!bulkAsset || bulkAsset.organizationId !== organizationId) throw new Error("Bulk asset not found");
  const bulkModel = await getModelById(bulkAsset.modelId);

  const all = await getTestTagAssetsByOrg(organizationId);
  const items = all
    .filter((i) => assetMatchesFilters(i, filters) && i.bulkAssetId === bulkAssetId)
    .sort((a, b) => cmpStrAsc(a.testTagId, b.testTagId));

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

  const [all, records] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
  ]);
  const byAsset = recordsByAsset(records);

  const filtered = all
    .filter((i) => assetMatchesFilters(i, { ...filters, statuses: ["CURRENT"] }))
    .sort((a, b) => cmpStrAsc(a.testTagId, b.testTagId));

  const latestIds = filtered.map((i) => byAsset.get(i.id)?.[0]?.testedById).filter((v): v is string => Boolean(v));
  const userMap = await getUserNameMap(latestIds);

  const items = filtered.map((i) => {
    const latest = (byAsset.get(i.id) ?? []).slice(0, 1).map((r) => ({
      ...r,
      testedBy: { name: userMap.get(r.testedById) ?? r.testerName },
    }));
    return { ...i, testRecords: latest };
  });

  return serialize({ items, total: items.length, generatedDate: new Date().toISOString() });
}

// ─── REPORT COUNTS (for preview) ────────────────────────────────────────────

export async function getReportPreviewCount(reportType: string, filters: ReportFilters) {
  const { organizationId } = await getOrgContext();

  if (reportType === "session" || reportType === "tester-activity" || reportType === "failed-items") {
    const records = await getTestTagRecordsByOrg(organizationId);
    if (reportType === "failed-items") {
      const assets = await getTestTagAssetsByOrg(organizationId);
      const matchingAssetIds = new Set(assets.filter((a) => assetMatchesFilters(a, filters)).map((a) => a.id));
      return records
        .filter((r) => recordMatchesFilters(r, { ...filters, results: ["FAIL"] }))
        .filter((r) => matchingAssetIds.has(r.testTagAssetId)).length;
    }
    return records.filter((r) => recordMatchesFilters(r, filters)).length;
  }

  const all = await getTestTagAssetsByOrg(organizationId);

  if (reportType === "overdue") {
    return all.filter(
      (i) =>
        assetMatchesFilters(i, { ...filters, statuses: undefined }) &&
        (i.status === "OVERDUE" || i.status === "FAILED" || i.status === "NOT_YET_TESTED"),
    ).length;
  }

  if (reportType === "compliance-certificate") {
    return all.filter((i) => assetMatchesFilters(i, { ...filters, statuses: ["CURRENT"] })).length;
  }

  if (reportType === "due-schedule") {
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date();
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })();
    const matches = all.filter((i) => assetMatchesFilters(i, { ...filters, statuses: undefined }));
    const due = matches.filter(
      (i) =>
        i.nextDueDate != null &&
        i.nextDueDate.getTime() >= dateFrom.getTime() &&
        i.nextDueDate.getTime() <= dateTo.getTime() &&
        (i.status === "CURRENT" || i.status === "DUE_SOON"),
    ).length;
    const overdue = matches.filter((i) => i.status === "OVERDUE").length;
    return due + overdue;
  }

  return all.filter((i) => assetMatchesFilters(i, filters)).length;
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
