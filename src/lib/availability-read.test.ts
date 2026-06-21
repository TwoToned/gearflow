import { describe, it, expect } from "vitest";
import {
  projectMatchesWindow,
  projectMatchesCalendarWindow,
  indexProjectsById,
  buildModelBookings,
  buildKitBookings,
  buildAssetBookings,
  sumBookingsByModel,
  countLineItemsByProject,
  EXCLUDED_PROJECT_STATUSES,
  type DateWindow,
} from "@/lib/availability-read";
import type { ConvexProject } from "@/lib/projects-read";
import type { MappedLineItem, MappedUnit } from "@/lib/project-line-item-read";

// ── Fixtures ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const T0 = 1_700_000_000_000; // arbitrary epoch-ms base

const WINDOW: DateWindow = { start: new Date(T0), end: new Date(T0 + 30 * DAY) };

function p(overrides: Partial<ConvexProject>): ConvexProject {
  return {
    id: "p1",
    organizationId: "org",
    projectNumber: "PRJ-1",
    name: "Project One",
    clientId: "c1",
    status: "CONFIRMED",
    isTemplate: false,
    rentalStartDate: T0 + 5 * DAY,
    rentalEndDate: T0 + 10 * DAY,
    ...overrides,
  } as unknown as ConvexProject;
}

function li(overrides: Partial<MappedLineItem>): MappedLineItem {
  return {
    id: "li1",
    organizationId: "org",
    projectId: "p1",
    type: "EQUIPMENT",
    modelId: null,
    assetId: null,
    bulkAssetId: null,
    kitId: null,
    isKitChild: false,
    childKind: null,
    parentLineItemId: null,
    pricingMode: null,
    description: null,
    quantity: 1,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    priceBreakdown: null,
    priceOverridden: false,
    overrideReason: null,
    sortOrder: 0,
    groupName: null,
    categoryId: null,
    groupId: null,
    notes: null,
    isOptional: false,
    status: "QUOTED",
    checkedOutQuantity: 0,
    returnedQuantity: 0,
    assignedQuantity: 0,
    packedQuantity: 0,
    damagedQuantity: 0,
    lostQuantity: 0,
    checkedOutAt: null,
    checkedOutById: null,
    returnedAt: null,
    returnedById: null,
    returnCondition: null,
    returnNotes: null,
    prepStatus: null,
    prepContainer: null,
    isContainerLineItem: false,
    isCustomItem: false,
    returnStatus: null,
    showSubhireOnDocs: false,
    supplierId: null,
    subhireOrderNumber: null,
    supplierOrderId: null,
    subHireId: null,
    subHireItemId: null,
    subHireGroupId: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function unit(overrides: Partial<MappedUnit>): MappedUnit {
  return {
    id: "u1",
    organizationId: "org",
    lineItemId: "li1",
    ordinal: 0,
    assetId: null,
    bulkAssetId: null,
    parentUnitAssetId: null,
    quantity: 1,
    returnedQuantity: 0,
    status: "CONFIRMED",
    prepStatus: null,
    prepContainer: null,
    checkedOutAt: null,
    checkedOutById: null,
    returnedAt: null,
    returnedById: null,
    returnCondition: null,
    returnStatus: null,
    returnNotes: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

// ── projectMatchesWindow ──────────────────────────────────────────────────────

describe("projectMatchesWindow", () => {
  it("accepts an active non-template project overlapping the window", () => {
    expect(projectMatchesWindow(p({}), WINDOW)).toBe(true);
  });

  it("excludes templates", () => {
    expect(projectMatchesWindow(p({ isTemplate: true }), WINDOW)).toBe(false);
  });

  it("excludes the full notIn status set", () => {
    for (const s of EXCLUDED_PROJECT_STATUSES) {
      expect(projectMatchesWindow(p({ status: s as never }), WINDOW)).toBe(false);
    }
  });

  it("excludes a project with null rental dates (null fails the comparison)", () => {
    expect(projectMatchesWindow(p({ rentalStartDate: undefined }), WINDOW)).toBe(false);
    expect(projectMatchesWindow(p({ rentalEndDate: undefined }), WINDOW)).toBe(false);
  });

  it("excludes a project entirely before the window", () => {
    expect(
      projectMatchesWindow(p({ rentalStartDate: T0 - 10 * DAY, rentalEndDate: T0 - 5 * DAY }), WINDOW),
    ).toBe(false);
  });

  it("excludes a project entirely after the window", () => {
    expect(
      projectMatchesWindow(p({ rentalStartDate: T0 + 40 * DAY, rentalEndDate: T0 + 50 * DAY }), WINDOW),
    ).toBe(false);
  });

  it("includes a project that straddles the window edges (boundary inclusive)", () => {
    expect(
      projectMatchesWindow(p({ rentalStartDate: T0 - 5 * DAY, rentalEndDate: T0 }), WINDOW),
    ).toBe(true); // ends exactly at start
    expect(
      projectMatchesWindow(p({ rentalStartDate: T0 + 30 * DAY, rentalEndDate: T0 + 40 * DAY }), WINDOW),
    ).toBe(true); // starts exactly at end
  });
});

describe("projectMatchesCalendarWindow", () => {
  it("only excludes CANCELLED — keeps RETURNED/COMPLETED/INVOICED (looser than booking filter)", () => {
    expect(projectMatchesCalendarWindow(p({ status: "CANCELLED" }), WINDOW)).toBe(false);
    expect(projectMatchesCalendarWindow(p({ status: "RETURNED" }), WINDOW)).toBe(true);
    expect(projectMatchesCalendarWindow(p({ status: "COMPLETED" }), WINDOW)).toBe(true);
    expect(projectMatchesCalendarWindow(p({ status: "INVOICED" }), WINDOW)).toBe(true);
  });

  it("still excludes templates + null-date projects + non-overlapping", () => {
    expect(projectMatchesCalendarWindow(p({ isTemplate: true }), WINDOW)).toBe(false);
    expect(projectMatchesCalendarWindow(p({ rentalStartDate: undefined }), WINDOW)).toBe(false);
    expect(
      projectMatchesCalendarWindow(p({ rentalStartDate: T0 + 40 * DAY, rentalEndDate: T0 + 50 * DAY }), WINDOW),
    ).toBe(false);
  });
});

// ── buildModelBookings ───────────────────────────────────────────────────────

describe("buildModelBookings", () => {
  const projects = [
    p({ id: "p1", rentalStartDate: T0 + 5 * DAY }),
    p({ id: "p2", rentalStartDate: T0 + 2 * DAY }),
  ];
  const idx = indexProjectsById(projects);

  it("sums quantities per project and orders by rental start asc", () => {
    const items = [
      li({ id: "a", projectId: "p1", modelId: "m1", quantity: 2 }),
      li({ id: "b", projectId: "p1", modelId: "m1", quantity: 3 }),
      li({ id: "c", projectId: "p2", modelId: "m1", quantity: 1 }),
    ];
    const rows = buildModelBookings("m1", items, idx, WINDOW);
    expect(rows.map((r) => r.projectId)).toEqual(["p2", "p1"]); // p2 starts earlier
    expect(rows.find((r) => r.projectId === "p1")!.quantity).toBe(5);
    expect(rows.find((r) => r.projectId === "p2")!.quantity).toBe(1);
  });

  it("ignores other models, cancelled lines, and projects out of window/missing", () => {
    const items = [
      li({ id: "a", projectId: "p1", modelId: "m2", quantity: 9 }), // other model
      li({ id: "b", projectId: "p1", modelId: "m1", quantity: 4, status: "CANCELLED" }),
      li({ id: "c", projectId: "ghost", modelId: "m1", quantity: 7 }), // no project row
    ];
    expect(buildModelBookings("m1", items, idx, WINDOW)).toEqual([]);
  });

  it("drops a booking whose project is out of the date window", () => {
    const outIdx = indexProjectsById([
      p({ id: "p1", rentalStartDate: T0 + 40 * DAY, rentalEndDate: T0 + 50 * DAY }),
    ]);
    const items = [li({ id: "a", projectId: "p1", modelId: "m1", quantity: 2 })];
    expect(buildModelBookings("m1", items, outIdx, WINDOW)).toEqual([]);
  });
});

// ── buildKitBookings ─────────────────────────────────────────────────────────

describe("buildKitBookings", () => {
  const idx = indexProjectsById([p({ id: "p1" })]);

  it("includes only non-kit-child, non-cancelled kit parent lines (no per-project dedup)", () => {
    const items = [
      li({ id: "a", projectId: "p1", kitId: "k1", isKitChild: false, quantity: 1 }),
      li({ id: "b", projectId: "p1", kitId: "k1", isKitChild: false, quantity: 1 }), // second parent → 2 rows
      li({ id: "child", projectId: "p1", kitId: "k1", isKitChild: true, quantity: 1 }),
      li({ id: "cancelled", projectId: "p1", kitId: "k1", isKitChild: false, status: "CANCELLED" }),
      li({ id: "other", projectId: "p1", kitId: "k2", isKitChild: false }),
    ];
    const rows = buildKitBookings("k1", items, idx, WINDOW);
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
});

// ── buildAssetBookings ───────────────────────────────────────────────────────

describe("buildAssetBookings", () => {
  const idx = indexProjectsById([p({ id: "p1" }), p({ id: "p2", rentalStartDate: T0 + 2 * DAY })]);

  it("collects legacy line.assetId bookings (quantity from the line)", () => {
    const items = [li({ id: "leg", projectId: "p1", assetId: "asset1", quantity: 1 })];
    const rows = buildAssetBookings("asset1", items, [], idx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("leg");
    expect(rows[0].quantity).toBe(1);
  });

  it("adds one quantity-1 booking per unit whose line wasn't already counted", () => {
    const items = [
      li({ id: "leg", projectId: "p1", assetId: "asset1" }), // legacy line for asset1
      li({ id: "fulfill", projectId: "p2", assetId: null }), // line fulfilled by a unit
    ];
    const units = [
      unit({ id: "u-leg", lineItemId: "leg", assetId: "asset1" }), // dedup: leg already seen
      unit({ id: "u-ful", lineItemId: "fulfill", assetId: "asset1" }), // counts → 1
    ];
    const rows = buildAssetBookings("asset1", items, units, idx, WINDOW);
    // legacy "leg" + unit-only "fulfill" (deduped u-leg). Legacy first, then units.
    expect(rows.map((r) => r.id)).toEqual(["leg", "fulfill"]);
    expect(rows.find((r) => r.id === "fulfill")!.quantity).toBe(1);
  });

  it("ignores cancelled units, cancelled lines, and units for other assets", () => {
    const items = [
      li({ id: "ok", projectId: "p1", assetId: null }),
      li({ id: "cancelledLine", projectId: "p1", assetId: null, status: "CANCELLED" }),
    ];
    const units = [
      unit({ id: "a", lineItemId: "ok", assetId: "asset1", status: "CANCELLED" }), // cancelled unit
      unit({ id: "b", lineItemId: "cancelledLine", assetId: "asset1" }), // line cancelled
      unit({ id: "c", lineItemId: "ok", assetId: "other" }), // other asset
    ];
    expect(buildAssetBookings("asset1", items, units, idx, WINDOW)).toEqual([]);
  });
});

// ── sumBookingsByModel ───────────────────────────────────────────────────────

describe("sumBookingsByModel", () => {
  const idx = indexProjectsById([p({ id: "this" }), p({ id: "other", rentalStartDate: T0 + 3 * DAY })]);

  it("with a window: sums across all overlapping projects; tracks this-project subset", () => {
    const items = [
      li({ id: "a", projectId: "this", modelId: "m1", quantity: 2 }),
      li({ id: "b", projectId: "other", modelId: "m1", quantity: 3 }),
      li({ id: "c", projectId: "other", modelId: "m1", quantity: 1, subHireId: "sh" }), // sub-hire excluded
      li({ id: "d", projectId: "other", modelId: "m1", quantity: 5, status: "CANCELLED" }), // excluded
    ];
    const { totalByModel, thisProjectByModel } = sumBookingsByModel(
      ["m1"], items, idx, WINDOW, "this",
    );
    expect(totalByModel.get("m1")).toBe(5); // 2 + 3
    expect(thisProjectByModel.get("m1")).toBe(2);
  });

  it("dateless (window null): counts ONLY this project's bookings", () => {
    const items = [
      li({ id: "a", projectId: "this", modelId: "m1", quantity: 2 }),
      li({ id: "b", projectId: "other", modelId: "m1", quantity: 3 }),
    ];
    const { totalByModel, thisProjectByModel } = sumBookingsByModel(
      ["m1"], items, idx, null, "this",
    );
    expect(totalByModel.get("m1")).toBe(2);
    expect(thisProjectByModel.get("m1")).toBe(2);
  });

  it("ignores models not in the requested set and null-model lines", () => {
    const items = [
      li({ id: "a", projectId: "this", modelId: "m1", quantity: 2 }),
      li({ id: "b", projectId: "this", modelId: "m2", quantity: 9 }),
      li({ id: "c", projectId: "this", modelId: null, quantity: 4 }),
    ];
    const { totalByModel } = sumBookingsByModel(["m1"], items, idx, WINDOW, "this");
    expect(totalByModel.get("m1")).toBe(2);
    expect(totalByModel.has("m2")).toBe(false);
  });
});

// ── countLineItemsByProject ──────────────────────────────────────────────────

describe("countLineItemsByProject", () => {
  it("counts non-cancelled line items only, for the requested projects", () => {
    const items = [
      li({ id: "a", projectId: "p1" }),
      li({ id: "b", projectId: "p1", status: "CANCELLED" }),
      li({ id: "c", projectId: "p2" }),
      li({ id: "d", projectId: "p3" }), // not requested
    ];
    const counts = countLineItemsByProject(["p1", "p2"], items);
    expect(counts.get("p1")).toBe(1);
    expect(counts.get("p2")).toBe(1);
    expect(counts.has("p3")).toBe(false);
  });
});
