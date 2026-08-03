import { describe, test, expect } from "vitest";
import { projectSnapshotEntries, type SnapshotEntryLike } from "@/lib/project-version-projection";

function entries(over: Partial<Record<string, SnapshotEntryLike[]>> = {}): SnapshotEntryLike[] {
  return [
    { entityType: "project", entityId: "p1", data: { name: "Big Gig", total: 1100, subtotal: 1000, taxAmount: 100 } },
    ...(over.category ?? []),
    ...(over.group ?? []),
    ...(over.lineItem ?? []),
    ...(over.service ?? []),
    ...(over.crewAssignment ?? []),
  ];
}

describe("projectSnapshotEntries", () => {
  test("groups a category's groups and ungrouped line items, sorted by sortOrder", () => {
    const view = projectSnapshotEntries(
      entries({
        category: [{ entityType: "category", entityId: "c1", data: { name: "Lighting", sortOrder: 0 } }],
        group: [{ entityType: "group", entityId: "g1", data: { categoryId: "c1", title: "MA3 kit", price: 500, sortOrder: 0 } }],
        lineItem: [
          { entityType: "lineItem", entityId: "l1", data: { categoryId: "c1", groupId: "g1", description: "MA3", quantity: 1, unitPrice: 500, sortOrder: 0 } },
          { entityType: "lineItem", entityId: "l2", data: { categoryId: "c1", description: "Cable", quantity: 2, unitPrice: 10, sortOrder: 1 } },
        ],
      }),
    );

    expect(view.equipment.categories).toHaveLength(1);
    const cat = view.equipment.categories[0];
    expect(cat.name).toBe("Lighting");
    expect(cat.groups).toHaveLength(1);
    expect(cat.groups[0].lineItems.map((li) => li.id)).toEqual(["l1"]);
    expect(cat.ungroupedLineItems.map((li) => li.id)).toEqual(["l2"]);
  });

  test("a line item belonging to no category renders in uncategorizedLineItems, never dropped", () => {
    const view = projectSnapshotEntries(
      entries({
        lineItem: [{ entityType: "lineItem", entityId: "l1", data: { description: "Orphan cable", quantity: 1, unitPrice: 5, sortOrder: 0 } }],
      }),
    );
    expect(view.equipment.uncategorizedLineItems.map((li) => li.id)).toEqual(["l1"]);
    expect(view.equipment.categories).toHaveLength(0);
  });

  test("maps services and crew independent of equipment", () => {
    const view = projectSnapshotEntries(
      entries({
        service: [{ entityType: "service", entityId: "s1", data: { type: "LABOUR", title: "Bump in", costTotal: 200, sortOrder: 0 } }],
        crewAssignment: [{ entityType: "crewAssignment", entityId: "ca1", data: { crewMemberId: "cm1", estimatedCost: 150 } }],
      }),
    );
    expect(view.services).toEqual([
      expect.objectContaining({ id: "s1", type: "LABOUR", title: "Bump in", costTotal: 200 }),
    ]);
    expect(view.crew).toEqual([expect.objectContaining({ id: "ca1", crewMemberId: "cm1", estimatedCost: 150 })]);
  });

  test("maps the project entity's financial + identity fields", () => {
    const view = projectSnapshotEntries(entries());
    expect(view.finance).toMatchObject({ name: "Big Gig", total: 1100, subtotal: 1000, taxAmount: 100 });
  });

  // WS11 (#950) — saleRevenue/saleCostTotal are captured by captureProjectSnapshot
  // (convex/lib/projectSnapshots.ts) but were missing from this mapper's output.
  test("maps the project entity's saleRevenue/saleCostTotal, null when absent", () => {
    const withSale = projectSnapshotEntries([
      { entityType: "project", entityId: "p1", data: { saleRevenue: 250, saleCostTotal: 90 } },
    ]);
    expect(withSale.finance).toMatchObject({ saleRevenue: 250, saleCostTotal: 90 });
    expect(projectSnapshotEntries(entries()).finance).toMatchObject({ saleRevenue: null, saleCostTotal: null });
  });

  test("maps the project entity's own notes fields — captured because the whole project row is snapshotted", () => {
    const view = projectSnapshotEntries([
      { entityType: "project", entityId: "p1", data: { crewNotes: "Bump in 8am", internalNotes: "Watch the budget", clientNotes: "**Bold** notice" } },
    ]);
    expect(view.notes).toEqual({ crewNotes: "Bump in 8am", internalNotes: "Watch the budget", clientNotes: "**Bold** notice" });
  });

  test("missing/malformed fields degrade to null/defaults rather than throwing", () => {
    const view = projectSnapshotEntries([
      { entityType: "project", entityId: "p1", data: {} },
      { entityType: "lineItem", entityId: "l1", data: { unitPrice: "not-a-number" } },
    ]);
    expect(view.finance.total).toBeNull();
    expect(view.equipment.uncategorizedLineItems[0]).toMatchObject({ unitPrice: 0, description: "" });
  });

  test("discountMode defaults to $ when absent or malformed, exactly like the live schema's default", () => {
    const view = projectSnapshotEntries(
      entries({ lineItem: [{ entityType: "lineItem", entityId: "l1", data: { description: "x", discountMode: "bogus" } }] }),
    );
    expect(view.equipment.uncategorizedLineItems[0].discountMode).toBe("$");
  });

  test("always reports the same uncaptured facet list — sub-hires and slot ordering are never in scope", () => {
    const view = projectSnapshotEntries(entries());
    expect(view.uncaptured).toContain("subHires");
    expect(view.uncaptured).toContain("categorySlotOrder");
    expect(view.uncaptured).toContain("liveAvailability");
    expect(view.uncaptured).toContain("warehouseStatus");
  });

  test("is a pure function — identical input produces a structurally identical result", () => {
    const input = entries({
      lineItem: [{ entityType: "lineItem", entityId: "l1", data: { description: "x", quantity: 1, unitPrice: 10, sortOrder: 0 } }],
    });
    expect(projectSnapshotEntries(input)).toEqual(projectSnapshotEntries(structuredClone(input)));
  });
});
