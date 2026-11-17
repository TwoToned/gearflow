import { describe, expect, test } from "vitest";
import type { LogisticsService } from "@/lib/logistics-model";
import { crewText, logisticsColumns, serviceRow, whereLine } from "../service-rows";

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
