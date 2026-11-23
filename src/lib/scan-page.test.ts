import { describe, expect, it } from "vitest";
import {
  clockTime,
  effectiveMode,
  exceptionVerdict,
  lastScansHead,
  parseScanUrl,
  scanHref,
  ttFlag,
  type LastScan,
  type ScanCardData,
} from "./scan-page";

const params = (q: string) => new URLSearchParams(q);
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22, 9);

const baseCard: ScanCardData = {
  kind: "asset", tag: "A-1", asset: { id: "a1", assetTag: "A-1", serialNumber: null, modelId: "m1", modelName: "Aura", status: "AVAILABLE", condition: null },
  kit: null, bulk: null, location: null, job: null, lastCheck: null, checkItemCount: 3, tt: null,
};
const tt = (patch: Partial<NonNullable<ScanCardData["tt"]>>): ScanCardData["tt"] => ({
  id: "tt1", testTagId: "TT-1", description: "Aura", status: "CURRENT", equipmentClass: null, applianceType: null, make: null, modelName: null,
  lastTestDate: null, nextDueDate: null, testIntervalMonths: 3, outletCount: null, isActive: true, assetId: "a1", bulkAssetId: null, ...patch,
});

describe("scan-page URL", () => {
  it("parses mode and tag, dropping junk instead of throwing", () => {
    expect(parseScanUrl(params("mode=check&tag=AURA-01"))).toEqual({ mode: "check", tag: "AURA-01" });
    expect(parseScanUrl(params("mode=tt&tag=TT-0412"))).toEqual({ mode: "tt", tag: "TT-0412" });
    expect(parseScanUrl(params("mode=nope&tag=<script>"))).toEqual({ mode: null, tag: null });
    expect(parseScanUrl(params(""))).toEqual({ mode: null, tag: null });
    expect(parseScanUrl(params(`tag=${"x".repeat(129)}`)).tag).toBeNull();
  });

  it("builds the href with defaults omitted, and round-trips", () => {
    expect(scanHref({ mode: null, tag: null })).toBe("/scan");
    expect(scanHref({ mode: "check", tag: "A 1" })).toBe("/scan?mode=check&tag=A+1");
    expect(parseScanUrl(params(scanHref({ mode: "check", tag: "A 1" }).split("?")[1]))).toEqual({ mode: "check", tag: "A 1" });
  });

  it("shows only a held mode: the URL's when held, else the first held, else none", () => {
    expect(effectiveMode("tt", ["check", "tt"])).toBe("tt");
    expect(effectiveMode("tt", ["check"])).toBe("check");
    expect(effectiveMode(null, ["tt"])).toBe("tt");
    expect(effectiveMode("check", [])).toBeNull();
  });
});

describe("Last scans", () => {
  const row = (verdict: LastScan["verdict"]): LastScan => ({ id: verdict + Math.random(), mode: "check", tag: "A", name: null, verdict, at: 0, assetId: null });

  it("counts every row and summarises the saved ones", () => {
    expect(lastScansHead([row("clean"), row("clean"), row("failed"), row("unknown")])).toEqual({ count: 4, summary: "2 clean · 1 failed" });
    expect(lastScansHead([row("unknown")])).toEqual({ count: 1, summary: "" });
  });

  it("prints a 24-hour clock time", () => {
    const at = new Date(2026, 10, 22, 7, 5).getTime();
    expect(clockTime(at)).toBe("07:05");
  });

  it("logs every card that can't be checked, and none that can", () => {
    expect(exceptionVerdict(baseCard)).toBeNull();
    expect(exceptionVerdict({ ...baseCard, checkItemCount: 0 })).toBe("noItems");
    expect(exceptionVerdict({ ...baseCard, kind: "unknown", asset: null })).toBe("unknown");
    expect(exceptionVerdict({ ...baseCard, kind: "kit", asset: null })).toBe("kit");
    expect(exceptionVerdict({ ...baseCard, kind: "bulk", asset: null })).toBe("bulk");
    expect(exceptionVerdict({ ...baseCard, kind: "ttOnly", asset: null })).toBe("ttOnly");
  });
});

describe("ttFlag", () => {
  it("flags overdue, due soon and failed; nothing for a current or inactive item", () => {
    expect(ttFlag(tt({ status: "OVERDUE", nextDueDate: NOW - 38 * DAY }), NOW)).toEqual({ label: "T&T overdue 38d", tone: "error" });
    expect(ttFlag(tt({ status: "DUE_SOON", nextDueDate: NOW + 4 * DAY + 1 }), NOW)).toEqual({ label: "T&T due in 4d", tone: "warning" });
    expect(ttFlag(tt({ status: "FAILED" }), NOW)).toEqual({ label: "T&T failed", tone: "error" });
    expect(ttFlag(tt({ status: "CURRENT", nextDueDate: NOW + 60 * DAY }), NOW)).toBeNull();
    expect(ttFlag(tt({ isActive: false, status: "FAILED" }), NOW)).toBeNull();
    expect(ttFlag(null, NOW)).toBeNull();
  });
});
