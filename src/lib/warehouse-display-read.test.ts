import { describe, expect, it } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  mapDisplayService,
  mapDisplayLineItem,
  filterDeliveryServices,
  filterPickupServices,
  countsAsTotal,
  countsAsCheckedOut,
  buildLineItemCountMaps,
  type DisplayServiceRow,
  type DisplayLineItemRow,
} from "./warehouse-display-read";

// Day windows used across the filter tests.
const TODAY_START = Date.UTC(2026, 5, 16, 0, 0, 0); // 2026-06-16
const TODAY_END = Date.UTC(2026, 5, 17, 0, 0, 0); // 2026-06-17
const SEVEN_DAYS_END = Date.UTC(2026, 5, 24, 0, 0, 0); // today + 8 days

function svc(overrides: Partial<DisplayServiceRow>): DisplayServiceRow {
  return {
    projectId: "p1",
    type: "DELIVERY",
    status: "CONFIRMED",
    date: new Date(TODAY_START + 3_600_000), // mid-today
    scheduledTime: null,
    startTime: null,
    address: null,
    vehicleDescription: null,
    ...overrides,
  };
}

function li(overrides: Partial<DisplayLineItemRow>): DisplayLineItemRow {
  return { projectId: "p1", isKitChild: false, status: "CONFIRMED", ...overrides };
}

describe("mapDisplayService", () => {
  it("converts epoch-ms date to a real Date and drops absent optionals to null", () => {
    const raw = {
      _id: "x" as Doc<"projectServices">["_id"],
      _creationTime: 0,
      id: "svc1",
      organizationId: "org1",
      projectId: "p1",
      type: "DELIVERY",
      title: "Delivery",
      date: TODAY_START,
      // scheduledTime / startTime / address / vehicleDescription / status absent
    } as unknown as Doc<"projectServices">;
    const mapped = mapDisplayService(raw);
    expect(mapped.date).toBeInstanceOf(Date);
    expect(mapped.date!.getTime()).toBe(TODAY_START);
    // CRITICAL: getFullYear is called downstream on the date.
    expect(mapped.date!.getFullYear()).toBe(2026);
    expect(mapped.projectId).toBe("p1");
    expect(mapped.type).toBe("DELIVERY");
    expect(mapped.status).toBeNull();
    expect(mapped.scheduledTime).toBeNull();
    expect(mapped.startTime).toBeNull();
    expect(mapped.address).toBeNull();
    expect(mapped.vehicleDescription).toBeNull();
  });

  it("yields null date when the field is absent", () => {
    const raw = {
      id: "svc2",
      projectId: "p1",
      type: "PICKUP",
    } as unknown as Doc<"projectServices">;
    expect(mapDisplayService(raw).date).toBeNull();
  });
});

describe("mapDisplayLineItem", () => {
  it("keeps an absent isKitChild as null (not coerced to false)", () => {
    const raw = {
      id: "li1",
      projectId: "p1",
      // isKitChild absent, status absent
    } as unknown as Doc<"projectLineItems">;
    const mapped = mapDisplayLineItem(raw);
    expect(mapped.isKitChild).toBeNull();
    expect(mapped.status).toBeNull();
    expect(mapped.projectId).toBe("p1");
  });
});

describe("filterDeliveryServices", () => {
  it("keeps DELIVERY, non-cancelled services inside the window", () => {
    const services = [
      svc({ projectId: "a", type: "DELIVERY" }),
      svc({ projectId: "b", type: "PICKUP" }), // wrong type
      svc({ projectId: "c", type: "DELIVERY", status: "CANCELLED" }), // cancelled
      svc({ projectId: "d", type: "DELIVERY", date: new Date(TODAY_END + 1) }), // outside today
      svc({ projectId: "e", type: "DELIVERY", date: null }), // no date
    ];
    const result = filterDeliveryServices(services, TODAY_START, TODAY_END);
    expect(result.map((s) => s.projectId)).toEqual(["a"]);
  });

  it("uses a half-open [gte, lt) window — gte inclusive, lt exclusive", () => {
    const services = [
      svc({ projectId: "start", date: new Date(TODAY_START) }), // == gte, included
      svc({ projectId: "end", date: new Date(TODAY_END) }), // == lt, excluded
    ];
    const result = filterDeliveryServices(services, TODAY_START, TODAY_END);
    expect(result.map((s) => s.projectId)).toEqual(["start"]);
  });

  it("selects the upcoming (today+1 .. +8) window distinctly from today", () => {
    const services = [
      svc({ projectId: "today", date: new Date(TODAY_START + 1000) }),
      svc({ projectId: "upcoming", date: new Date(TODAY_END + 1000) }),
      svc({ projectId: "far", date: new Date(SEVEN_DAYS_END + 1000) }), // outside
    ];
    expect(
      filterDeliveryServices(services, TODAY_END, SEVEN_DAYS_END).map((s) => s.projectId)
    ).toEqual(["upcoming"]);
  });
});

describe("filterPickupServices", () => {
  it("keeps PICKUP, non-cancelled services inside the window", () => {
    const services = [
      svc({ projectId: "a", type: "PICKUP" }),
      svc({ projectId: "b", type: "DELIVERY" }), // wrong type
      svc({ projectId: "c", type: "PICKUP", status: "CANCELLED" }), // cancelled
    ];
    const result = filterPickupServices(services, TODAY_START, TODAY_END);
    expect(result.map((s) => s.projectId)).toEqual(["a"]);
  });
});

describe("countsAsTotal / countsAsCheckedOut", () => {
  it("counts a top-level non-cancelled item toward total", () => {
    expect(countsAsTotal(li({ isKitChild: false, status: "CONFIRMED" }))).toBe(true);
  });

  it("counts a top-level item whose isKitChild flag is ABSENT (null) toward total", () => {
    // Mirrors Prisma isKitChild:false — absent must NOT be dropped.
    expect(countsAsTotal(li({ isKitChild: null, status: "CONFIRMED" }))).toBe(true);
  });

  it("excludes kit children from total", () => {
    expect(countsAsTotal(li({ isKitChild: true, status: "CONFIRMED" }))).toBe(false);
  });

  it("excludes cancelled items from total", () => {
    expect(countsAsTotal(li({ isKitChild: false, status: "CANCELLED" }))).toBe(false);
  });

  it("counts only top-level CHECKED_OUT items toward checked-out", () => {
    expect(countsAsCheckedOut(li({ isKitChild: false, status: "CHECKED_OUT" }))).toBe(true);
    expect(countsAsCheckedOut(li({ isKitChild: null, status: "CHECKED_OUT" }))).toBe(true);
    expect(countsAsCheckedOut(li({ isKitChild: true, status: "CHECKED_OUT" }))).toBe(false);
    expect(countsAsCheckedOut(li({ isKitChild: false, status: "CONFIRMED" }))).toBe(false);
  });
});

describe("buildLineItemCountMaps", () => {
  it("builds per-project total + checked-out maps in one pass", () => {
    const items = [
      li({ projectId: "p1", isKitChild: false, status: "CONFIRMED" }),
      li({ projectId: "p1", isKitChild: null, status: "CHECKED_OUT" }), // absent flag still counts
      li({ projectId: "p1", isKitChild: true, status: "CHECKED_OUT" }), // child — excluded
      li({ projectId: "p1", isKitChild: false, status: "CANCELLED" }), // cancelled — excluded from total
      li({ projectId: "p2", isKitChild: false, status: "CHECKED_OUT" }),
    ];
    const { totalCountMap, checkedOutCountMap } = buildLineItemCountMaps(items);
    // p1 totals: CONFIRMED + CHECKED_OUT(absent flag) = 2 (child + cancelled excluded)
    expect(totalCountMap.get("p1")).toBe(2);
    expect(checkedOutCountMap.get("p1")).toBe(1);
    expect(totalCountMap.get("p2")).toBe(1);
    expect(checkedOutCountMap.get("p2")).toBe(1);
  });

  it("returns empty maps for no items", () => {
    const { totalCountMap, checkedOutCountMap } = buildLineItemCountMaps([]);
    expect(totalCountMap.size).toBe(0);
    expect(checkedOutCountMap.size).toBe(0);
  });
});
