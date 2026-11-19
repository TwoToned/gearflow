// @vitest-environment node
import { describe, it, expect } from "vitest";
import { earliestOutbound } from "./outboundTruck";

const D1 = Date.UTC(2026, 10, 17);
const D2 = Date.UTC(2026, 10, 18);

describe("earliestOutbound", () => {
  it("returns null without an outbound service", () => {
    expect(earliestOutbound([])).toBeNull();
    expect(earliestOutbound([{ type: "PICKUP", date: D1, scheduledTime: "06:00" }, { type: "LABOUR", date: D1 }])).toBeNull();
  });

  it("picks the earliest by date, then truck time, with our vehicle", () => {
    const t = earliestOutbound([
      { type: "DELIVERY", date: D2, scheduledTime: "05:00", vehicleDescription: "Van 1" },
      { type: "DELIVERY", date: D1, scheduledTime: "09:00", vehicleDescription: "Van 3" },
      { type: "DELIVERY", date: D1, scheduledTime: "06:30", vehicleDescription: " Van 2 " },
    ]);
    expect(t).toEqual({ kind: "truck", date: D1, time: "06:30", vehicle: "Van 2" });
  });

  it("a client pick-up reads as the client collecting and never carries a vehicle", () => {
    const t = earliestOutbound([{ type: "CLIENT_PICKUP", date: D1, scheduledTime: "10:00", vehicleDescription: "x" }]);
    expect(t).toEqual({ kind: "client", date: D1, time: "10:00", vehicle: null });
  });

  it("skips cancelled services; a missing or malformed time is null and sorts last", () => {
    const t = earliestOutbound([
      { type: "DELIVERY", date: D1, scheduledTime: "05:00", status: "CANCELLED" },
      { type: "DELIVERY", date: D1, scheduledTime: "late" },
      { type: "DELIVERY", date: D1, scheduledTime: "08:00" },
    ]);
    expect(t?.time).toBe("08:00");
    expect(earliestOutbound([{ type: "DELIVERY", date: null }])).toEqual({ kind: "truck", date: null, time: null, vehicle: null });
  });
});
