/**
 * Every T&T report CSV export routes its cells through `@/lib/csv` (the one
 * formula-injection guard). One hostile fixture feeds all eight exports: each
 * user-controlled text field starts with `= + - @`, tab or CR, and no cell of
 * any export may reach the spreadsheet still starting with one of them.
 */
import { describe, it, expect, vi } from "vitest";

import type { TTAsset, TTRecord, SubTestRecord } from "@/lib/test-tag-read";

vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn() }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org_1" })),
}));
vi.mock("@/lib/models-read", () => ({ getModelById: vi.fn(async () => null) }));
vi.mock("@/lib/assets-read", () => ({
  getAssetsByOrg: vi.fn(async () => []),
  getBulkAssetsByOrg: vi.fn(async () => []),
  getBulkAssetById: vi.fn(async () => ({ id: "bulk_1", organizationId: "org_1", modelId: "m_1", assetTag: "B1", totalQuantity: 1 })),
}));

const past = new Date("2026-01-01T00:00:00.000Z");

const asset: TTAsset = {
  id: "tta_1",
  organizationId: "org_1",
  testTagId: "=HYPERLINK(\"http://x\",\"y\")",
  description: "+description",
  equipmentClass: "-CUSTOM_CLASS",
  applianceType: "@CUSTOM_TYPE",
  make: "\tmake",
  modelName: "\rmodel",
  serialNumber: "@serial",
  location: "=location",
  testIntervalMonths: 12,
  status: "OVERDUE",
  lastTestDate: null,
  nextDueDate: past,
  notes: null,
  assetId: null,
  bulkAssetId: "bulk_1",
  testProfileId: null,
  outletCount: null,
  isActive: true,
  createdAt: null,
  updatedAt: null,
};

const record = {
  id: "ttr_1",
  organizationId: "org_1",
  testTagAssetId: "tta_1",
  testProfileId: null,
  testDate: past,
  testedById: "",
  testerName: "=tester",
  result: "FAIL",
  visualInspectionResult: "FAIL",
  earthContinuityResult: "PASS",
  insulationResult: "PASS",
  leakageCurrentResult: "PASS",
  polarityResult: "PASS",
  rcdTripTimeResult: "NOT_APPLICABLE",
  functionalTestResult: "PASS",
  functionalTestNotes: null,
  failureAction: "-tag out",
  failureNotes: "@notes",
  nextDueDate: null,
} as unknown as TTRecord;

const subTest = {
  id: "st_1",
  testTagRecordId: "ttr_1",
  label: "+outlet 1",
  sortOrder: 0,
  result: "FAIL",
  earthContinuityReading: null,
  insulationReading: null,
  leakageCurrentReading: null,
} as unknown as SubTestRecord;

vi.mock("@/lib/test-tag-read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/test-tag-read")>("@/lib/test-tag-read");
  return {
    ...actual,
    getTestTagAssetsByOrg: vi.fn(async () => [asset]),
    getTestTagRecordsByOrg: vi.fn(async () => [record]),
    getSubTestRecordsByRecordIds: vi.fn(async () => [subTest]),
    getTestProfileMap: vi.fn(async () => new Map()),
    getUserNameMap: vi.fn(async () => new Map()),
  };
});

import {
  exportRegisterCSV,
  exportOverdueCSV,
  exportSessionCSV,
  exportDueScheduleCSV,
  exportClassSummaryCSV,
  exportTesterActivityCSV,
  exportFailedItemsCSV,
  exportBulkSummaryCSV,
} from "./test-tag-reports";

/** Minimal RFC 4180 reader for the assertions (quoted cells may hold `,` `"` CR LF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const FORMULA_START = /^[=+\-@\t\r]/;

const exports: Array<[string, () => Promise<string>, string[]]> = [
  ["register", () => exportRegisterCSV({}), ["'=HYPERLINK(\"http://x\",\"y\")", "'+description", "'\tmake", "'\rmodel", "'@serial", "'=location"]],
  ["overdue", () => exportOverdueCSV({}), ["'=HYPERLINK(\"http://x\",\"y\")", "'-CUSTOM_CLASS", "'@CUSTOM_TYPE", "'=location"]],
  ["session", () => exportSessionCSV({}), ["'=tester", "'@notes", "'+outlet 1 | FAIL"]],
  ["due-schedule", () => exportDueScheduleCSV({}), ["'+description", "'=location"]],
  ["class-summary", () => exportClassSummaryCSV({}), ["'-CUSTOM_CLASS", "'@CUSTOM_TYPE"]],
  ["tester-activity", () => exportTesterActivityCSV({}), ["'=tester", "'+description"]],
  ["failed-items", () => exportFailedItemsCSV({}), ["'=tester", "'-tag out", "'@notes", "'+outlet 1 | FAIL"]],
  ["bulk-summary", () => exportBulkSummaryCSV("bulk_1", {}), ["'@serial", "'=location"]],
];

describe("T&T report CSV exports", () => {
  it.each(exports)("%s neutralises every formula-start cell", async (_name, run, expected) => {
    const rows = parseCsv(await run());
    expect(rows.length).toBeGreaterThan(1);
    const cells = rows.slice(1).flat();
    for (const cell of cells) expect(cell).not.toMatch(FORMULA_START);
    for (const guarded of expected) expect(cells).toContain(guarded);
  });

  it("writes a missing date as a blank cell, not a guarded '-' placeholder", async () => {
    const [header, row] = parseCsv(await exportRegisterCSV({}));
    expect(row[header.indexOf("lastTestDate")]).toBe("");
    expect(row[header.indexOf("nextDueDate")]).not.toBe("");
  });
});
