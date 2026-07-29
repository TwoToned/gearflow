/**
 * Unit tests for the pure line-item COUNT / flag functions in
 * line-item-count-read.ts (Phase A, bucket-1 keystone-unblocked reads).
 *
 * Safety property: each function reproduces the EXACT row set the Prisma `where` it
 * replaces would have counted/selected — the EQUIPMENT/CANCELLED/supplier/subHire
 * filters, the per-project grouping, and the subhire pagination + createdAt-desc
 * order. The fetchers (I/O) are not tested here; only the pure logic.
 */
import { describe, it, expect } from "vitest";
import {
  countEquipmentLineItemsByProject,
  countAllLineItemsByProject,
  countCheckedOutInProjects,
  countLineItemsBySupplier,
  countLineItemsBySupplierMap,
  groupActiveLineItemsByProject,
  buildIncludeLineItemsByProject,
  buildSupplierSubhires,
  countTopLevelLineItemsByProject,
  type SubhireProjectSelect,
} from "@/lib/line-item-count-read";
import type { MappedLineItem } from "@/lib/project-line-item-read";

/** Build a MappedLineItem with sensible defaults; override the fields a test cares about. */
function li(over: Partial<MappedLineItem>): MappedLineItem {
  return {
    id: "li_" + Math.random().toString(36).slice(2),
    organizationId: "org1",
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
    discountMode: null,
    lineTotal: null,
    priceBreakdown: null,
    priceOverridden: false,
    pricedUnderLock: false,
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
    ...over,
  };
}

describe("countEquipmentLineItemsByProject", () => {
  it("counts only EQUIPMENT items, only for the requested project ids", () => {
    const items = [
      li({ projectId: "p1", type: "EQUIPMENT" }),
      li({ projectId: "p1", type: "EQUIPMENT" }),
      li({ projectId: "p1", type: "SERVICE" }), // wrong type → excluded
      li({ projectId: "p2", type: "EQUIPMENT" }),
      li({ projectId: "p3", type: "EQUIPMENT" }), // not requested → excluded
    ];
    const map = countEquipmentLineItemsByProject(items, ["p1", "p2"]);
    expect(map.get("p1")).toBe(2);
    expect(map.get("p2")).toBe(1);
    expect(map.has("p3")).toBe(false);
  });

  it("WS11 (#950): SALE lines are invisible to warehouse for free — excluded by the same EQUIPMENT-only filter", () => {
    // No new logic exists (or should exist) here: SALE lines simply aren't
    // EQUIPMENT, so they never enter warehouse-side counts/prep/pull-sheet/
    // close-out reconstruction. This test pins that as an explicit regression
    // guard rather than an accident of the type check.
    const items = [
      li({ projectId: "p1", type: "EQUIPMENT" }),
      li({ projectId: "p1", type: "SALE", saleMode: "NEW_STOCK" }),
      li({ projectId: "p1", type: "SALE", saleMode: "FROM_RENTAL_STOCK", status: "CONFIRMED" }),
    ];
    const map = countEquipmentLineItemsByProject(items, ["p1"]);
    expect(map.get("p1")).toBe(1);
  });
});

describe("countAllLineItemsByProject", () => {
  it("counts ALL line items (no type filter) for the requested projects", () => {
    const items = [
      li({ projectId: "p1", type: "EQUIPMENT" }),
      li({ projectId: "p1", type: "SERVICE" }),
      li({ projectId: "p1", type: "EQUIPMENT", status: "CANCELLED" }), // still counted (no status filter)
      li({ projectId: "p9" }),
    ];
    const map = countAllLineItemsByProject(items, ["p1"]);
    expect(map.get("p1")).toBe(3);
    expect(map.has("p9")).toBe(false);
  });
});

describe("countCheckedOutInProjects", () => {
  it("counts only CHECKED_OUT items in the overdue project set", () => {
    const items = [
      li({ projectId: "p1", status: "CHECKED_OUT" }),
      li({ projectId: "p1", status: "CONFIRMED" }), // wrong status
      li({ projectId: "p2", status: "CHECKED_OUT" }),
      li({ projectId: "p3", status: "CHECKED_OUT" }), // not overdue
    ];
    expect(countCheckedOutInProjects(items, new Set(["p1", "p2"]))).toBe(2);
    expect(countCheckedOutInProjects(items, new Set())).toBe(0);
  });
});

describe("countLineItemsBySupplier / Map", () => {
  it("counts a single supplier's items regardless of status/type", () => {
    const items = [
      li({ supplierId: "s1" }),
      li({ supplierId: "s1", status: "CANCELLED" }),
      li({ supplierId: "s2" }),
      li({ supplierId: null }),
    ];
    expect(countLineItemsBySupplier(items, "s1")).toBe(2);
    expect(countLineItemsBySupplier(items, "s2")).toBe(1);
    expect(countLineItemsBySupplier(items, "sX")).toBe(0);
  });

  it("builds an org-wide supplierId → count map (null supplierId ignored)", () => {
    const items = [
      li({ supplierId: "s1" }),
      li({ supplierId: "s1" }),
      li({ supplierId: "s2" }),
      li({ supplierId: null }),
    ];
    const map = countLineItemsBySupplierMap(items);
    expect(map.get("s1")).toBe(2);
    expect(map.get("s2")).toBe(1);
    expect(map.has("")).toBe(false);
    expect(map.size).toBe(2);
  });
});

describe("groupActiveLineItemsByProject", () => {
  it("drops CANCELLED, scopes to active project ids, groups per project", () => {
    const a = li({ projectId: "p1", status: "CONFIRMED" });
    const b = li({ projectId: "p1", status: "CANCELLED" }); // dropped
    const c = li({ projectId: "p2", status: "QUOTED" });
    const d = li({ projectId: "p3", status: "QUOTED" }); // not active
    const map = groupActiveLineItemsByProject([a, b, c, d], ["p1", "p2"]);
    expect(map.get("p1")).toEqual([a]);
    expect(map.get("p2")).toEqual([c]);
    expect(map.has("p3")).toBe(false);
  });
});

describe("buildIncludeLineItemsByProject", () => {
  it("returns slim {id,status,type,isKitChild}, EQUIPMENT && non-CANCELLED only", () => {
    const items = [
      li({ id: "x1", projectId: "p1", type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false }),
      li({ id: "x2", projectId: "p1", type: "EQUIPMENT", status: "CANCELLED" }), // dropped
      li({ id: "x3", projectId: "p1", type: "SERVICE" }), // wrong type
      li({ id: "x4", projectId: "p1", type: "EQUIPMENT", status: "CHECKED_OUT", isKitChild: true }),
      li({ id: "x5", projectId: "p9", type: "EQUIPMENT" }), // not requested
    ];
    const map = buildIncludeLineItemsByProject(items, ["p1"]);
    expect(map.get("p1")).toEqual([
      { id: "x1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false },
      { id: "x4", status: "CHECKED_OUT", type: "EQUIPMENT", isKitChild: true },
    ]);
    expect(map.has("p9")).toBe(false);
  });
});

describe("countTopLevelLineItemsByProject", () => {
  it("counts only non kit-child items for the requested projects", () => {
    const items = [
      li({ projectId: "t1", isKitChild: false }),
      li({ projectId: "t1", isKitChild: false }),
      li({ projectId: "t1", isKitChild: true }), // excluded
      li({ projectId: "t2", isKitChild: false }),
    ];
    const map = countTopLevelLineItemsByProject(items, ["t1", "t2"]);
    expect(map.get("t1")).toBe(2);
    expect(map.get("t2")).toBe(1);
  });
});

describe("buildSupplierSubhires", () => {
  const proj: Map<string, SubhireProjectSelect> = new Map([
    ["p1", { id: "p1", name: "Alpha", projectNumber: "A-1", status: "CONFIRMED" }],
    ["p2", { id: "p2", name: "Beta", projectNumber: null, status: "QUOTED" }],
  ]);

  it("filters by supplier + subHireId != null, orders createdAt desc, paginates, grafts project", () => {
    const items = [
      li({ id: "old", supplierId: "s1", subHireId: "sh1", projectId: "p1", createdAt: new Date(1_000) }),
      li({ id: "new", supplierId: "s1", subHireId: "sh2", projectId: "p2", createdAt: new Date(3_000) }),
      li({ id: "mid", supplierId: "s1", subHireId: "sh3", projectId: "p1", createdAt: new Date(2_000) }),
      li({ id: "no-subhire", supplierId: "s1", subHireId: null, createdAt: new Date(5_000) }), // excluded
      li({ id: "other-supplier", supplierId: "s2", subHireId: "shX", createdAt: new Date(9_000) }), // excluded
    ];
    const page1 = buildSupplierSubhires(items, "s1", proj, 1, 2);
    expect(page1.total).toBe(3);
    expect(page1.items.map((i) => i.id)).toEqual(["new", "mid"]); // desc by createdAt
    expect(page1.items[0].project).toEqual(proj.get("p2"));
    expect(page1.items[1].project).toEqual(proj.get("p1"));

    const page2 = buildSupplierSubhires(items, "s1", proj, 2, 2);
    expect(page2.total).toBe(3);
    expect(page2.items.map((i) => i.id)).toEqual(["old"]);
  });

  it("grafts null project on a Convex miss (no fallback)", () => {
    const items = [li({ id: "z", supplierId: "s1", subHireId: "sh", projectId: "missing", createdAt: new Date(1) })];
    const res = buildSupplierSubhires(items, "s1", proj, 1, 25);
    expect(res.items[0].project).toBeNull();
  });
});
