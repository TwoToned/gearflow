import { describe, expect, it } from "vitest";
import {
  counterLocation, defaultServiceDay, planShift, TYPE_WORDS, truckText, warehouseRoleId,
  type LogisticsService,
} from "../logistics-model";
import { quickAddValues } from "@/components/projects/logistics/use-quick-add";
import { whereLine } from "@/components/projects/logistics/service-rows";
import { serviceResults } from "@/components/projects/logistics/add-service-bar";

const svc = (o: Partial<LogisticsService>): LogisticsService => ({
  id: "s", type: "CLIENT_PICKUP", title: "t", date: null, endDate: null, startTime: null, endTime: null,
  scheduledTime: "10:00", status: "PLANNED", address: "14 Industry Rd", latitude: null, longitude: null,
  vehicleDescription: "ignored truck", numberOfTrips: 3, lineTotal: null, costTotal: null, crewCountRequired: 1,
  crewRole: null, crewAssignments: [], ...o,
});

describe("client pick up / drop off (model)", () => {
  it("words, truck time and the day follow the window ends", () => {
    expect(TYPE_WORDS.CLIENT_PICKUP).toBe("Client pick up");
    expect(truckText(svc({}))).toBe("client collects 10:00");
    expect(truckText(svc({ type: "CLIENT_DROPOFF" }))).toBe("client drops 10:00");
    const w = { start: "2026-11-10", end: "2026-11-14" };
    expect(defaultServiceDay("CLIENT_PICKUP", w)).toBe("2026-11-10");
    expect(defaultServiceDay("CLIENT_DROPOFF", w)).toBe("2026-11-14");
  });

  it("the Where line shows the counter, client and rego, never a truck or trips", () => {
    expect(whereLine(svc({ clientContactName: "Priya", clientVehicle: "CXQ 412" }))).toBe(
      "14 Industry Rd · client collects 10:00 · Priya · CXQ 412",
    );
  });

  it("moves with the window: pick up with load in, drop off with load out", () => {
    const d = "2026-11-11T00:00:00.000Z";
    const services = [svc({ id: "a", date: d }), svc({ id: "b", type: "CLIENT_DROPOFF", date: d }), svc({ id: "c", type: "BUMP_IN", date: d })];
    const plan = planShift(services, { loadInDays: 2, loadOutDays: -1 });
    const byId = (id: string) => plan.find((m) => m.serviceIds.includes(id));
    expect(byId("a")?.offsetDays).toBe(2);
    expect(byId("b")?.offsetDays).toBe(-1);
  });

  it("the AddBar offers both as chips and results", () => {
    expect(serviceResults("", "clientpickup", []).map((r) => r.title)).toEqual(["Client pick up"]);
    expect(serviceResults("client", null, []).map((r) => r.title).sort()).toEqual(["Client drop off", "Client pick up"]);
  });

  it("quick add: our counter, one Warehouse person, no price, no truck", () => {
    const v = quickAddValues(
      "CLIENT_PICKUP",
      { address: "Venue", latitude: 1, longitude: 2, window: { start: "2026-11-10", end: "2026-11-14" }, counter: { address: "14 Industry Rd", latitude: null, longitude: null }, warehouseRoleId: "r1" },
    );
    expect(v).toMatchObject({ address: "14 Industry Rd", crewCountRequired: 1, crewRoleId: "r1", date: "2026-11-10" });
    expect(v.unitPrice).toBeUndefined();
    expect(v.vehicleDescription).toBeUndefined();
  });

  it("counter = default location, else first WAREHOUSE with an address, else null", () => {
    const a = { id: "a", type: "VENUE", address: "V" };
    const b = { id: "b", type: "WAREHOUSE", address: "W" };
    const c = { id: "c", type: "OFFSITE", isDefault: true, address: "D" };
    expect(counterLocation([a, b, c])?.id).toBe("c");
    expect(counterLocation([a, b])?.id).toBe("b");
    expect(counterLocation([a, { id: "e", type: "WAREHOUSE", address: "" }])).toBeNull();
    expect(counterLocation(undefined)).toBeNull();
  });

  it("Warehouse role by name, case-insensitive, active only", () => {
    expect(warehouseRoleId([{ id: "1", name: " WAREHOUSE " }])).toBe("1");
    expect(warehouseRoleId([{ id: "1", name: "Warehouse", isActive: false }])).toBeNull();
    expect(warehouseRoleId(undefined)).toBeNull();
  });
});
