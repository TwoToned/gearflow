import { describe, it, expect } from "vitest";
import {
  projectMatchesWindow,
  projectMatchesCalendarWindow,
  buildModelBookings,
  buildKitBookings,
  buildAssetBookings,
  countLineItemsByProject,
  EXCLUDED_PROJECT_STATUSES,
  type DateWindowMs,
  type BookingProject,
  type BookingLineItem,
  type BookingUnit,
} from "./lib/availabilityBookings";

/**
 * Parity guard for the Convex-side port of the availability booking builders.
 * Mirrors the coverage of the deleted `src/lib/availability-read.test.ts` so the
 * native `convex/availability.ts` queries reproduce the old server action's rows.
 */

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const WINDOW: DateWindowMs = { startMs: T0, endMs: T0 + 30 * DAY };

function p(overrides: Partial<BookingProject>): BookingProject {
  return {
    id: "p1",
    projectNumber: "PRJ-1",
    name: "Project One",
    clientId: "c1",
    status: "CONFIRMED",
    isTemplate: false,
    rentalStartMs: T0 + 5 * DAY,
    rentalEndMs: T0 + 10 * DAY,
    projectStartMs: null,
    projectEndMs: null,
    ...overrides,
  };
}

function li(overrides: Partial<BookingLineItem>): BookingLineItem {
  return {
    id: "li1",
    projectId: "p1",
    modelId: null,
    kitId: null,
    assetId: null,
    isKitChild: false,
    status: "QUOTED",
    quantity: 1,
    ...overrides,
  };
}

function unit(overrides: Partial<BookingUnit>): BookingUnit {
  return { lineItemId: "li1", assetId: null, status: "CONFIRMED", ...overrides };
}

function indexProjectsById(projects: BookingProject[]): Map<string, BookingProject> {
  return new Map(projects.map((pr) => [pr.id, pr]));
}

describe("projectMatchesWindow", () => {
  it("accepts an active non-template project overlapping the window", () => {
    expect(projectMatchesWindow(p({}), WINDOW)).toBe(true);
  });

  it("excludes templates", () => {
    expect(projectMatchesWindow(p({ isTemplate: true }), WINDOW)).toBe(false);
  });

  it("excludes the full notIn status set", () => {
    for (const s of EXCLUDED_PROJECT_STATUSES) {
      expect(projectMatchesWindow(p({ status: s }), WINDOW)).toBe(false);
    }
  });

  it("excludes a project with null rental dates", () => {
    expect(projectMatchesWindow(p({ rentalStartMs: null }), WINDOW)).toBe(false);
    expect(projectMatchesWindow(p({ rentalEndMs: null }), WINDOW)).toBe(false);
  });

  it("excludes projects entirely before/after the window", () => {
    expect(projectMatchesWindow(p({ rentalStartMs: T0 - 10 * DAY, rentalEndMs: T0 - 5 * DAY }), WINDOW)).toBe(false);
    expect(projectMatchesWindow(p({ rentalStartMs: T0 + 40 * DAY, rentalEndMs: T0 + 50 * DAY }), WINDOW)).toBe(false);
  });

  it("includes projects straddling the window edges (boundary inclusive)", () => {
    expect(projectMatchesWindow(p({ rentalStartMs: T0 - 5 * DAY, rentalEndMs: T0 }), WINDOW)).toBe(true);
    expect(projectMatchesWindow(p({ rentalStartMs: T0 + 30 * DAY, rentalEndMs: T0 + 40 * DAY }), WINDOW)).toBe(true);
  });

  // WS2 (#941) — reads the PROJECT window (getProjectWindow), not rental directly.
  it("prefers the project window over the rental window when both are set", () => {
    // Rental window is OUTSIDE WINDOW, but the project window overlaps it.
    expect(
      projectMatchesWindow(
        p({ rentalStartMs: T0 + 40 * DAY, rentalEndMs: T0 + 50 * DAY, projectStartMs: T0, projectEndMs: T0 + 2 * DAY }),
        WINDOW,
      ),
    ).toBe(true);
    // Inverse: project window is outside WINDOW even though rental overlaps.
    expect(
      projectMatchesWindow(
        p({ rentalStartMs: T0 + 5 * DAY, rentalEndMs: T0 + 10 * DAY, projectStartMs: T0 + 40 * DAY, projectEndMs: T0 + 50 * DAY }),
        WINDOW,
      ),
    ).toBe(false);
  });

  it("falls back to the rental window when only one side of the project window is set", () => {
    // projectStartMs diverges earlier than the window; projectEndMs unset falls back
    // to rentalEndMs, which is inside WINDOW.
    expect(
      projectMatchesWindow(p({ rentalStartMs: T0 + 5 * DAY, rentalEndMs: T0 + 10 * DAY, projectStartMs: T0 - 20 * DAY }), WINDOW),
    ).toBe(true);
  });
});

describe("projectMatchesCalendarWindow", () => {
  it("only excludes CANCELLED — keeps RETURNED/COMPLETED/INVOICED", () => {
    expect(projectMatchesCalendarWindow(p({ status: "CANCELLED" }), WINDOW)).toBe(false);
    expect(projectMatchesCalendarWindow(p({ status: "RETURNED" }), WINDOW)).toBe(true);
    expect(projectMatchesCalendarWindow(p({ status: "COMPLETED" }), WINDOW)).toBe(true);
    expect(projectMatchesCalendarWindow(p({ status: "INVOICED" }), WINDOW)).toBe(true);
  });

  it("still excludes templates + null-date + non-overlapping", () => {
    expect(projectMatchesCalendarWindow(p({ isTemplate: true }), WINDOW)).toBe(false);
    expect(projectMatchesCalendarWindow(p({ rentalStartMs: null }), WINDOW)).toBe(false);
    expect(projectMatchesCalendarWindow(p({ rentalStartMs: T0 + 40 * DAY, rentalEndMs: T0 + 50 * DAY }), WINDOW)).toBe(false);
  });
});

describe("buildModelBookings", () => {
  const idx = indexProjectsById([
    p({ id: "p1", rentalStartMs: T0 + 5 * DAY }),
    p({ id: "p2", rentalStartMs: T0 + 2 * DAY }),
  ]);

  it("sums quantities per project and orders by rental start asc", () => {
    const items = [
      li({ id: "a", projectId: "p1", modelId: "m1", quantity: 2 }),
      li({ id: "b", projectId: "p1", modelId: "m1", quantity: 3 }),
      li({ id: "c", projectId: "p2", modelId: "m1", quantity: 1 }),
    ];
    const rows = buildModelBookings("m1", items, idx, WINDOW);
    expect(rows.map((r) => r.projectId)).toEqual(["p2", "p1"]);
    expect(rows.find((r) => r.projectId === "p1")!.quantity).toBe(5);
    expect(rows.find((r) => r.projectId === "p2")!.quantity).toBe(1);
  });

  it("ignores other models, cancelled lines, and out-of-window/missing projects", () => {
    const items = [
      li({ id: "a", projectId: "p1", modelId: "m2", quantity: 9 }),
      li({ id: "b", projectId: "p1", modelId: "m1", quantity: 4, status: "CANCELLED" }),
      li({ id: "c", projectId: "ghost", modelId: "m1", quantity: 7 }),
    ];
    expect(buildModelBookings("m1", items, idx, WINDOW)).toEqual([]);
  });
});

describe("buildKitBookings", () => {
  const idx = indexProjectsById([p({ id: "p1" })]);

  it("includes only non-kit-child, non-cancelled kit parent lines (no dedup)", () => {
    const items = [
      li({ id: "a", projectId: "p1", kitId: "k1", isKitChild: false }),
      li({ id: "b", projectId: "p1", kitId: "k1", isKitChild: false }),
      li({ id: "child", projectId: "p1", kitId: "k1", isKitChild: true }),
      li({ id: "cancelled", projectId: "p1", kitId: "k1", isKitChild: false, status: "CANCELLED" }),
      li({ id: "other", projectId: "p1", kitId: "k2", isKitChild: false }),
    ];
    const rows = buildKitBookings("k1", items, idx, WINDOW);
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
});

describe("buildAssetBookings", () => {
  const idx = indexProjectsById([p({ id: "p1" }), p({ id: "p2", rentalStartMs: T0 + 2 * DAY })]);

  it("collects legacy line.assetId bookings", () => {
    const items = [li({ id: "leg", projectId: "p1", assetId: "asset1", quantity: 1 })];
    const rows = buildAssetBookings("asset1", items, [], idx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("leg");
  });

  it("adds one quantity-1 booking per unit whose line wasn't already counted", () => {
    const items = [
      li({ id: "leg", projectId: "p1", assetId: "asset1" }),
      li({ id: "fulfill", projectId: "p2", assetId: null }),
    ];
    const units = [
      unit({ lineItemId: "leg", assetId: "asset1" }),
      unit({ lineItemId: "fulfill", assetId: "asset1" }),
    ];
    const rows = buildAssetBookings("asset1", items, units, idx, WINDOW);
    expect(rows.map((r) => r.id)).toEqual(["leg", "fulfill"]);
    expect(rows.find((r) => r.id === "fulfill")!.quantity).toBe(1);
  });

  it("ignores cancelled units, cancelled lines, and units for other assets", () => {
    const items = [
      li({ id: "ok", projectId: "p1", assetId: null }),
      li({ id: "cancelledLine", projectId: "p1", assetId: null, status: "CANCELLED" }),
    ];
    const units = [
      unit({ lineItemId: "ok", assetId: "asset1", status: "CANCELLED" }),
      unit({ lineItemId: "cancelledLine", assetId: "asset1" }),
      unit({ lineItemId: "ok", assetId: "other" }),
    ];
    expect(buildAssetBookings("asset1", items, units, idx, WINDOW)).toEqual([]);
  });
});

describe("countLineItemsByProject", () => {
  it("counts non-cancelled line items only, for the requested projects", () => {
    const items = [
      li({ id: "a", projectId: "p1" }),
      li({ id: "b", projectId: "p1", status: "CANCELLED" }),
      li({ id: "c", projectId: "p2" }),
      li({ id: "d", projectId: "p3" }),
    ];
    const counts = countLineItemsByProject(["p1", "p2"], items);
    expect(counts.get("p1")).toBe(1);
    expect(counts.get("p2")).toBe(1);
    expect(counts.has("p3")).toBe(false);
  });
});
