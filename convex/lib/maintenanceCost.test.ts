import { describe, expect, test } from "vitest";
import { maintenanceCost, partsSummary } from "./maintenanceCost";

const DAY = 86_400_000;
const NOW = Math.floor(1_800_000_000_000 / DAY) * DAY + 5 * 3_600_000; // 05:00 UTC on some day

describe("maintenanceCost (derived, never stored)", () => {
  test("no labour and no priced part is unknown (null), never $0", () => {
    expect(maintenanceCost(undefined, [])).toEqual({ parts: 0, labour: null, total: null, unpricedParts: 0 });
    expect(maintenanceCost(null, [{ quantity: 2 }])).toEqual({ parts: 0, labour: null, total: null, unpricedParts: 1 });
  });

  test("parts + labour, in cents, with unpriced parts counted but not summed", () => {
    const r = maintenanceCost(80, [{ quantity: 2, unitPrice: 12.345 }, { quantity: 1, unitPrice: 5 }, { quantity: 4 }]);
    expect(r.parts).toBe(29.69); // 24.69 + 5
    expect(r.total).toBe(109.69);
    expect(r.unpricedParts).toBe(1);
  });

  test("a deliberate $0 part or labour is a price, not blank", () => {
    expect(maintenanceCost(0, []).total).toBe(0);
    expect(maintenanceCost(undefined, [{ quantity: 3, unitPrice: 0 }]).total).toBe(0);
  });

  test("labour alone, and parts alone, each give a total", () => {
    expect(maintenanceCost(50, []).total).toBe(50);
    expect(maintenanceCost(undefined, [{ quantity: 2, unitPrice: 10 }]).total).toBe(20);
  });
});

describe("partsSummary", () => {
  test("on order until arrivedAt; nextEta is the earliest ETA still on order; late is the day before today", () => {
    const s = partsSummary(
      [
        { quantity: 1, arrivedAt: NOW - DAY },
        { quantity: 1, etaDate: NOW + 3 * DAY },
        { quantity: 1, etaDate: NOW + DAY },
        { quantity: 1, etaDate: NOW - DAY },
        { quantity: 1 },
      ],
      NOW,
    );
    expect(s).toEqual({ count: 5, onOrder: 4, arrived: 1, nextEta: NOW - DAY, late: 1 });
  });

  test("an ETA earlier today is not late", () => {
    const startOfToday = Math.floor(NOW / DAY) * DAY;
    expect(partsSummary([{ quantity: 1, etaDate: startOfToday }], NOW).late).toBe(0);
  });

  test("no parts", () => {
    expect(partsSummary([], NOW)).toEqual({ count: 0, onOrder: 0, arrived: 0, nextEta: null, late: 0 });
  });
});
