import { describe, expect, test } from "vitest";
import type { LogisticsService } from "@/lib/logistics-model";
import { crewText, logisticsColumns, logisticsTotalLines, serviceRow, whereLine } from "../service-rows";

const svc = (o: Partial<LogisticsService> = {}): LogisticsService => ({
  id: "s1", type: "DELIVERY", title: "Delivery", date: "2026-11-11T00:00:00.000Z", endDate: null, startTime: "06:00",
  endTime: "09:00", scheduledTime: "07:00", status: "CONFIRMED", address: "1 Pitt St", latitude: null, longitude: null,
  vehicleDescription: "Truck ABC-123", lineTotal: null, costTotal: null, crewCountRequired: 2, crewRole: { id: "r", name: "Driver", color: null },
  crewAssignments: [{ id: "a1", status: "CONFIRMED", estimatedCost: 300, crewMember: { id: "m", firstName: "Dev", lastName: "K", image: null } }],
  ...o,
});

describe("serviceRow", () => {
  test("folds Where under the title and flags a crew shortfall", () => {
    const r = serviceRow(svc(), { showCost: false });
    expect(r.subtitle).toBe("1 Pitt St · drop 07:00 · Truck ABC-123");
    expect(r.flags).toEqual([{ label: "1 needed", tone: "error" }]);
    expect(r.facts.crew).toEqual({ kind: "text", label: "Driver · 1 of 2" });
    expect(r.children?.[0].title).toBe("Dev K");
  });
  test("charge is blank, never $0, unless a price exists; internal when only a cost does", () => {
    expect(serviceRow(svc(), { showCost: false }).facts.charge).toEqual({ kind: "money", amount: null });
    expect(serviceRow(svc({ lineTotal: 0 }), { showCost: false }).facts.charge).toEqual({ kind: "money", amount: null });
    expect(serviceRow(svc({ costTotal: 400 }), { showCost: false }).facts.charge).toEqual({ kind: "text", label: "internal" });
    expect(serviceRow(svc({ lineTotal: 900 }), { showCost: false }).facts.charge).toEqual({ kind: "money", amount: 900 });
  });
  test("a Monday-only call on a Mon–Wed run reads short on Logistics, naming the short days", () => {
    const run = svc({
      date: "2026-11-16T00:00:00.000Z", endDate: "2026-11-18T00:00:00.000Z", crewCountRequired: 1,
      crewAssignments: [{ id: "a1", status: "CONFIRMED", estimatedCost: 300, startDate: "2026-11-16T00:00:00.000Z", endDate: "2026-11-16T00:00:00.000Z", crewMember: { id: "m", firstName: "Dev", lastName: "K", image: null } }],
    });
    const r = serviceRow(run, { showCost: false });
    expect(r.flags).toEqual([{ label: "1 needed", tone: "error" }]);
    expect(crewText(run)).toBe("Driver · 0 of 1 · Tue, Wed short");
  });

  test("B-2: a crew call's cost cell exists only when the server sent the cost (absent below the pay line)", () => {
    expect(serviceRow(svc(), { showCost: false }).children?.[0].facts.charge).toEqual({ kind: "money", amount: 300 });
    const redacted = svc({ crewAssignments: [{ id: "a1", status: "CONFIRMED", crewMember: { id: "m", firstName: "Dev", lastName: "K", image: null } }] });
    const child = serviceRow(redacted, { showCost: false }).children?.[0];
    expect(child?.facts).not.toHaveProperty("charge");
    expect(child?.facts.status).toBeDefined();
  });

  test("below the crew-pay line the service cost (crew pay rolled in) is absent: no cost or margin cell, no footer Cost/Margin", () => {
    const { costTotal: _c, ...noCost } = svc({ lineTotal: 900, costTotal: 400 });
    void _c;
    const r = serviceRow(noCost as LogisticsService, { showCost: true });
    expect(r.facts).not.toHaveProperty("cost");
    expect(r.facts).not.toHaveProperty("margin");
    expect(logisticsTotalLines({ serviceCount: 1, onDocumentsTotal: 900 }, true).map((l) => l.label)).toEqual(["On quote"]);
    expect(logisticsTotalLines({ serviceCount: 1, onDocumentsTotal: 900, internalTotal: 400 }, true).map((l) => l.label)).toEqual(["On quote", "Cost", "Margin"]);
  });

  test("cost and margin facts exist only when asked for", () => {
    const off = serviceRow(svc({ lineTotal: 900, costTotal: 400 }), { showCost: false });
    expect(off.facts.cost).toBeUndefined();
    const on = serviceRow(svc({ lineTotal: 900, costTotal: 400 }), { showCost: true });
    expect(on.facts.margin).toEqual({ kind: "money", amount: 500 });
    expect(logisticsColumns(true).map((c) => c.id)).toEqual(["when", "crew", "charge", "cost", "margin", "status"]);
    expect(logisticsColumns(false)).toHaveLength(4);
  });
  test("the type tag is dropped when the title already says it", () => {
    expect(serviceRow(svc({ title: "Delivery" }), { showCost: false }).tags).toBeUndefined();
    expect(serviceRow(svc({ title: "Delivery to Hilton" }), { showCost: false }).tags).toEqual(["Delivery"]);
  });

  test("helpers", () => {
    expect(crewText(svc({ crewCountRequired: null, crewAssignments: [], crewRole: null }))).toBe("no crew");
    expect(whereLine(svc({ address: null, scheduledTime: null, vehicleDescription: null, numberOfTrips: 3 }))).toBe("3 trips");
  });
});
