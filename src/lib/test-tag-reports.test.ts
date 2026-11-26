import { describe, expect, it } from "vitest";
import { itemHistoryReportUrl, REPORT_CONFIGS, reportConfig, reportFilterError, reportQuery, reportUrl } from "@/lib/test-tag-reports";

describe("the report table", () => {
  it("has the ten reports, each with a format and the filters it asks for", () => {
    expect(REPORT_CONFIGS.map((r) => r.key)).toEqual(["register", "overdue", "session", "item-history", "due-schedule", "class-summary", "tester-activity", "failed-items", "bulk-summary", "compliance-certificate"]);
    expect(reportConfig("item-history")).toMatchObject({ formats: ["pdf"], filters: ["testTagAssetId"] });
    expect(reportConfig("session").filters).toEqual(["dateFrom", "dateTo"]);
    expect(reportConfig("compliance-certificate").formats).toEqual(["pdf"]);
  });
});

describe("report URLs", () => {
  it("carry the format and only the filters that were filled in", () => {
    expect(reportQuery({ dateFrom: "2026-01-01", dateTo: "", search: undefined }, "csv")).toBe("format=csv&dateFrom=2026-01-01");
    expect(reportUrl("session", { dateFrom: "2026-01-01" }, "pdf")).toBe("/api/test-tag-reports/session?format=pdf&dateFrom=2026-01-01");
    expect(itemHistoryReportUrl("t 1")).toBe("/api/test-tag-reports/item-history?format=pdf&testTagAssetId=t+1");
  });
});

describe("reportFilterError", () => {
  it("asks for the item or bulk asset a report needs, and nothing else", () => {
    expect(reportFilterError("item-history", {})).toBe("Please select a test tag item");
    expect(reportFilterError("item-history", { testTagAssetId: "t1" })).toBeNull();
    expect(reportFilterError("bulk-summary", {})).toBe("Please select a bulk asset");
    expect(reportFilterError("bulk-summary", { bulkAssetId: "b1" })).toBeNull();
    expect(reportFilterError("register", {})).toBeNull();
  });
});
