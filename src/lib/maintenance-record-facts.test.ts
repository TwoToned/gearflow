import { describe, expect, it } from "vitest";
import { daysOverdue, maintenanceChecks, maintenanceStateWord, type MaintenanceFacts } from "@/lib/maintenance-record-facts";

const DAY = 86_400_000;
const TODAY = Math.floor(Date.UTC(2026, 10, 25, 9) / DAY) * DAY; // 00:00 UTC
const NOW = TODAY + 9 * 3_600_000;

const base: MaintenanceFacts = { status: "IN_PROGRESS", scheduledDate: TODAY, now: NOW, assetCount: 2, assigned: true, parts: { count: 0, onOrder: 0, late: 0, nextEta: null } };

describe("daysOverdue", () => {
  it("is whole days before TODAY: yesterday is 1, today and the future are 0, undated is 0", () => {
    expect(daysOverdue(TODAY - DAY, NOW)).toBe(1);
    expect(daysOverdue(TODAY - 18 * DAY + 5 * 3_600_000, NOW)).toBe(18);
    expect(daysOverdue(TODAY, NOW)).toBe(0);
    expect(daysOverdue(TODAY + DAY, NOW)).toBe(0);
    expect(daysOverdue(null, NOW)).toBe(0);
  });
});

describe("maintenanceStateWord", () => {
  it("overdue beats the status word for an open job, with the day count", () => {
    expect(maintenanceStateWord({ status: "SCHEDULED", scheduledDate: TODAY - 18 * DAY, now: NOW })).toEqual({ label: "18d overdue", intent: "error" });
    expect(maintenanceStateWord({ status: "IN_PROGRESS", scheduledDate: TODAY - DAY, now: NOW }).label).toBe("1d overdue");
  });

  it("Awaiting parts and QA are held, not late, even with a past date", () => {
    expect(maintenanceStateWord({ status: "AWAITING_PARTS", scheduledDate: TODAY - 9 * DAY, now: NOW })).toEqual({ label: "Awaiting parts", intent: "warning" });
    expect(maintenanceStateWord({ status: "QA", scheduledDate: TODAY - 9 * DAY, now: NOW }).label).toBe("In QA");
  });

  it("scheduled for today is Scheduled, not overdue; closed jobs say so", () => {
    expect(maintenanceStateWord({ status: "SCHEDULED", scheduledDate: TODAY, now: NOW })).toEqual({ label: "Scheduled", intent: "info" });
    expect(maintenanceStateWord({ status: "COMPLETED", scheduledDate: TODAY - 9 * DAY, now: NOW })).toEqual({ label: "Completed", intent: "success" });
    expect(maintenanceStateWord({ status: "CANCELLED", scheduledDate: null, now: NOW })).toMatchObject({ label: "Cancelled", outline: true });
  });
});

describe("maintenanceChecks", () => {
  it("an owned, dated job with gear and no parts on order is all clear (4 of 4)", () => {
    expect(maintenanceChecks(base)).toEqual({ closed: false, total: 4, clear: 4, items: [] });
  });

  it("names only what needs a look, most serious first, with where the fix lives", () => {
    const c = maintenanceChecks({ ...base, assetCount: 0, assigned: false, scheduledDate: TODAY - 3 * DAY, parts: { count: 2, onOrder: 2, late: 1, nextEta: TODAY - DAY } });
    expect(c.items.map((i) => [i.key, i.tone, i.fix])).toEqual([
      ["assets", "error", "edit"],
      ["date", "error", "complete"],
      ["parts", "warning", "parts"],
      ["assigned", "neutral", "edit"],
    ]);
    expect(c.clear).toBe(0);
  });

  it("parts on order name the count and the next ETA; late parts say so", () => {
    expect(maintenanceChecks({ ...base, parts: { count: 1, onOrder: 1, late: 0, nextEta: TODAY + 2 * DAY } }).items[0].text).toMatch(/^1 part on order · next /);
    expect(maintenanceChecks({ ...base, parts: { count: 2, onOrder: 2, late: 2, nextEta: TODAY - DAY } }).items[0].text).toBe("2 parts past ETA");
  });

  it("a parts read that has not arrived is 'not checked', never a pass", () => {
    const c = maintenanceChecks({ ...base, parts: null });
    expect(c.items).toEqual([{ key: "parts", text: "Parts not checked", tone: "neutral", fix: "parts" }]);
    expect(c.clear).toBe(3);
  });

  it("an undated job is flagged, and a closed job has no checks", () => {
    expect(maintenanceChecks({ ...base, scheduledDate: null }).items[0]).toMatchObject({ key: "date", text: "No date is set" });
    expect(maintenanceChecks({ ...base, status: "COMPLETED", assetCount: 0 })).toEqual({ closed: true, total: 0, clear: 0, items: [] });
  });
});
