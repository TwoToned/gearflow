import { describe, it, expect } from "vitest";

import { countOverlappingBookings } from "./asset-bookings";

const b = (id: string, s: string, e: string) => ({ id, rentalStartDate: s, rentalEndDate: e });

describe("countOverlappingBookings", () => {
  it("no bookings, or back-to-back ones, do not clash", () => {
    expect(countOverlappingBookings([])).toBe(0);
    expect(countOverlappingBookings([b("a", "2026-12-01", "2026-12-03"), b("b", "2026-12-04", "2026-12-06")])).toBe(0);
  });

  it("two overlapping bookings are both counted; a third clear one is not", () => {
    expect(countOverlappingBookings([b("a", "2026-12-01", "2026-12-05"), b("b", "2026-12-04", "2026-12-08"), b("c", "2026-12-20", "2026-12-21")])).toBe(2);
  });

  it("a shared end day is a clash (inclusive dates); an unparseable date is ignored", () => {
    expect(countOverlappingBookings([b("a", "2026-12-01", "2026-12-05"), b("b", "2026-12-05", "2026-12-08")])).toBe(2);
    expect(countOverlappingBookings([b("a", "2026-12-01", "2026-12-05"), b("b", "garbage", "2026-12-08")])).toBe(0);
  });
});
