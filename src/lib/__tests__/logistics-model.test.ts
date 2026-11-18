import { describe, expect, test } from "vitest";
import {
  crewPickRank, crewShort, daysBetween, defaultServiceDay, groupByDay, inLane, needsLine, planShift,
  reverseMoves, totalsOf, whenText, type LogisticsService,
} from "../logistics-model";

const svc = (o: Partial<LogisticsService> & { id: string }): LogisticsService => ({
  type: "BUMP_IN", title: o.id, date: "2026-11-11T00:00:00.000Z", endDate: null, startTime: null, endTime: null,
  scheduledTime: null, status: "PLANNED", address: null, latitude: null, longitude: null, vehicleDescription: null,
  lineTotal: null, costTotal: null, crewCountRequired: null, crewRole: null, crewAssignments: [], ...o,
});
const asg = (id: string, status: string) => ({
  id, status, estimatedCost: null, crewMember: { id: `m-${id}`, firstName: "A", lastName: "B", image: null },
});

describe("crew state", () => {
  test("a declined assignment does not fill the slot", () => {
    const s = svc({ id: "a", crewCountRequired: 2, crewAssignments: [asg("1", "CONFIRMED"), asg("2", "DECLINED")] });
    expect(crewShort(s)).toBe(1);
  });
  test("a cancelled service needs nobody", () => {
    expect(crewShort(svc({ id: "a", status: "CANCELLED", crewCountRequired: 3 }))).toBe(0);
  });
  test("totals and the needs line count what needs you", () => {
    const t = totalsOf([
      svc({ id: "a", crewCountRequired: 2, crewAssignments: [asg("1", "PENDING"), asg("2", "OFFERED")] }),
      svc({ id: "b", crewCountRequired: 1, crewAssignments: [asg("3", "CONFIRMED")] }),
    ]);
    expect(t).toMatchObject({ services: 2, crew: 3, confirmedCrew: 1, servicesShort: 0, toOffer: 1, unanswered: 1 });
    expect(needsLine(t)).toBe("1 to offer · 1 unanswered");
    expect(needsLine(totalsOf([svc({ id: "c", crewCountRequired: 2 })]))).toBe("1 short of crew");
    expect(needsLine(totalsOf([]))).toBe("");
  });
});

describe("lanes", () => {
  test("types map to transport / site / labour; needs crew is derived", () => {
    expect(inLane(svc({ id: "a", type: "DELIVERY" }), "transport")).toBe(true);
    expect(inLane(svc({ id: "a", type: "MISC" }), "site")).toBe(true);
    expect(inLane(svc({ id: "a", type: "LABOUR" }), "site")).toBe(false);
    expect(inLane(svc({ id: "a", crewCountRequired: 1 }), "needs")).toBe(true);
    expect(inLane(svc({ id: "a", crewCountRequired: 1, crewAssignments: [asg("1", "CONFIRMED")] }), "needs")).toBe(false);
  });
});

describe("days", () => {
  test("grouped ascending by day, unscheduled last, call time within a day", () => {
    const g = groupByDay([
      svc({ id: "c", date: null }),
      svc({ id: "b", date: "2026-11-12T00:00:00.000Z" }),
      svc({ id: "a2", startTime: "10:00" }),
      svc({ id: "a1", startTime: "07:00" }),
    ]);
    expect(g.map((d) => d.key)).toEqual(["2026-11-11", "2026-11-12", ""]);
    expect(g[0].services.map((s) => s.id)).toEqual(["a1", "a2"]);
  });
  test("when text", () => {
    expect(whenText(svc({ id: "a", startTime: "08:00", endTime: "16:00" }))).toBe("08:00 – 16:00");
    expect(whenText(svc({ id: "a", scheduledTime: "07:00" }))).toBe("07:00");
    expect(whenText(svc({ id: "a" }))).toBe("");
  });
  test("a new pickup / bump out defaults to load out, the rest to load in", () => {
    const w = { start: "2026-11-11", end: "2026-11-13" };
    expect(defaultServiceDay("PICKUP", w)).toBe("2026-11-13");
    expect(defaultServiceDay("DELIVERY", w)).toBe("2026-11-11");
    expect(defaultServiceDay("LABOUR", { start: "", end: "2026-11-13" })).toBe("2026-11-13");
  });
});

describe("planShift", () => {
  const all = [
    svc({ id: "del", type: "DELIVERY" }), svc({ id: "bi", type: "BUMP_IN" }),
    svc({ id: "bo", type: "BUMP_OUT" }), svc({ id: "pu", type: "PICKUP" }),
    svc({ id: "lab", type: "LABOUR" }), svc({ id: "x", type: "BUMP_IN", status: "CANCELLED" }),
    svc({ id: "nd", type: "BUMP_IN", date: null }),
  ];
  test("load in and load out move their own services; labour, cancelled and undated stay", () => {
    expect(planShift(all, { loadInDays: 2, loadOutDays: 3 })).toEqual([
      { offsetDays: 2, serviceIds: ["del", "bi"] },
      { offsetDays: 3, serviceIds: ["bo", "pu"] },
    ]);
  });
  test("a zero offset drops its group; the reverse negates", () => {
    const m = planShift(all, { loadInDays: 0, loadOutDays: -1 });
    expect(m).toEqual([{ offsetDays: -1, serviceIds: ["bo", "pu"] }]);
    expect(reverseMoves(m)).toEqual([{ offsetDays: 1, serviceIds: ["bo", "pu"] }]);
  });
  test("days between", () => {
    expect(daysBetween("2026-11-11", "2026-11-14")).toBe(3);
    expect(daysBetween("2026-11-14", "2026-11-11")).toBe(-3);
    expect(daysBetween("", "2026-11-11")).toBe(0);
  });
});

test("pick crew orders preferred, available, pencilled, booked", () => {
  const order = (["hard", "soft", null, "preferred"] as const).map((v) => ({ v, r: crewPickRank(v) }));
  expect(order.sort((a, b) => a.r - b.r).map((x) => x.v)).toEqual(["preferred", null, "soft", "hard"]);
});
