/**
 * #1296 packing containers, phase 3a — structureLineItemsByContainer.
 * Fixes container-grouping.repro.test.ts's defect #2 repro (two items
 * packed into the same case, from different categories, now surface under
 * one section) — see that file's own header for the "today's actual
 * behaviour" baseline this supersedes.
 */
import { describe, it, expect } from "vitest";
import { structureLineItemsByContainer, type ContainerForStructuring } from "./structure-line-items-by-container";
import { filterAndGroupItems } from "@/lib/react-pdf/components/line-items-table";
import type { DocumentLineItem, TablePluginConfig } from "./types";

function makeLineItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: "li-default",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CHECKED_OUT",
    model: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

function makeContainer(overrides: Partial<ContainerForStructuring>): ContainerForStructuring {
  return { id: "c1", kind: "CUSTOM", label: "Case 12", sortOrder: 0, ...overrides };
}

function makeConfig(overrides: Partial<TablePluginConfig> = {}): TablePluginConfig {
  return {
    documentType: "packing-list",
    documentColor: "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: true,
    showCheckboxes: true,
    showConditionColumns: false,
    showPricing: false,
    showBadges: false,
    showNotes: false,
    showPerUnitCheckboxes: false,
    showAssetTags: true,
    showCategories: true,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: false,
    ...overrides,
  };
}

const unit = (id: string, containerId: string | null, status = "CHECKED_OUT"): NonNullable<DocumentLineItem["units"]>[number] => ({
  id, asset: { assetTag: id.toUpperCase() }, bulkAsset: null, status, containerId,
});

describe("structureLineItemsByContainer", () => {
  it("fixes defect #2 — two items packed into one case, different categories, surface in one section", () => {
    const raw = [
      makeLineItem({ id: "a", description: "Par Can", categoryName: "Lighting", units: [unit("u-a", "c1")] }),
      makeLineItem({ id: "b", description: "DMX Cable", categoryName: "Audio", units: [unit("u-b", "c1")] }),
    ];
    const structured = structureLineItemsByContainer(raw, [makeContainer({})]);
    const { groups } = filterAndGroupItems(structured, makeConfig());
    expect(groups.has("Case 12")).toBe(true);
    const rows = groups.get("Case 12")!;
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["a", "b"]));
    // Sub-sorted by category within the section.
    const nonHeader = rows.filter((r) => !r.isContainerRow);
    expect(nonHeader[0].categoryName).toBe("Audio");
    expect(nonHeader[1].categoryName).toBe("Lighting");
  });

  it("emits a header row with status derived from members, never hard-coded", () => {
    const raw = [
      makeLineItem({ id: "a", categoryName: "Lighting", units: [unit("u-a", "c1", "CHECKED_OUT")] }),
      makeLineItem({ id: "b", categoryName: "Lighting", units: [unit("u-b", "c1", "CHECKED_OUT")] }),
    ];
    const structured = structureLineItemsByContainer(raw, [makeContainer({})]);
    const header = structured.find((r) => r.isContainerRow)!;
    expect(header.status).toBe("CHECKED_OUT");
    expect(header.containerItemCount).toBe(2);

    const mixed = structureLineItemsByContainer(
      [
        makeLineItem({ id: "a", categoryName: "Lighting", status: "CHECKED_OUT", units: [unit("u-a", "c1", "CHECKED_OUT")] }),
        makeLineItem({ id: "b", categoryName: "Lighting", status: "CONFIRMED", units: [unit("u-b", "c1", "CONFIRMED")] }),
      ],
      [makeContainer({})],
    );
    expect(mixed.find((r) => r.isContainerRow)!.status).toBe("CONFIRMED");
  });

  it("nests a container packed inside another under the same section, with increasing containerDepth", () => {
    const raw = [makeLineItem({ id: "a", categoryName: "Audio", units: [unit("u-a", "inner")] })];
    const containers: ContainerForStructuring[] = [
      makeContainer({ id: "outer", label: "Road Case 12", sortOrder: 0 }),
      makeContainer({ id: "inner", label: "Tub 3", kind: "CUSTOM", parentContainerId: "outer", sortOrder: 0 }),
    ];
    const structured = structureLineItemsByContainer(raw, containers);
    const { groups } = filterAndGroupItems(structured, makeConfig());
    expect(groups.has("Road Case 12")).toBe(true);
    const rows = groups.get("Road Case 12")!;
    const outerHeader = rows.find((r) => r.id === "container-outer")!;
    const innerHeader = rows.find((r) => r.id === "container-inner")!;
    const item = rows.find((r) => r.id === "a")!;
    expect(outerHeader.containerDepth).toBe(0);
    expect(innerHeader.containerDepth).toBe(1);
    expect(item.containerDepth).toBe(2);
    expect(outerHeader.containerItemCount).toBe(1); // 1 nested container, 0 direct items
  });

  it("splits a bulk line whose units genuinely span two containers into one row per container", () => {
    const raw = [
      makeLineItem({
        id: "cable-run", description: "XLR 5m", categoryName: "Audio", quantity: 10, checkedOutQuantity: 10,
        units: [unit("u1", "tub-a"), unit("u2", "tub-a"), unit("u3", "tub-a"), unit("u4", "tub-b")],
      }),
    ];
    const containers = [makeContainer({ id: "tub-a", label: "Tub A", sortOrder: 0 }), makeContainer({ id: "tub-b", label: "Tub B", sortOrder: 1 })];
    const structured = structureLineItemsByContainer(raw, containers);
    const rowA = structured.find((r) => r.id.startsWith("cable-run") && r.groupName === "Tub A")!;
    const rowB = structured.find((r) => r.id.startsWith("cable-run") && r.groupName === "Tub B")!;
    expect(rowA.quantity).toBe(3);
    expect(rowB.quantity).toBe(1);
    expect(rowA.units).toHaveLength(3);
    expect(rowB.units).toHaveLength(1);
  });

  it("a kit parent moves as ONE row, resolved from its own units (D3 default)", () => {
    const raw = [
      makeLineItem({
        id: "kit1", kitId: "k1", description: "Lighting Kit", categoryName: "Lighting",
        units: [unit("ku1", "c1")],
        childLineItems: [makeLineItem({ id: "kit1-child", isKitChild: true, kitId: "k1", childKind: "KIT" })],
      }),
    ];
    const structured = structureLineItemsByContainer(raw, [makeContainer({})]);
    expect(structured.filter((r) => r.id === "kit1")).toHaveLength(1); // never split
    expect(structured.find((r) => r.id === "kit1")?.groupName).toBe("Case 12");
  });

  it("units with no containerId land in a Loose section, after every real container", () => {
    const raw = [
      makeLineItem({ id: "packed", categoryName: "Audio", units: [unit("u1", "c1")] }),
      makeLineItem({ id: "loose", categoryName: "Audio", units: [unit("u2", null)] }),
    ];
    const structured = structureLineItemsByContainer(raw, [makeContainer({})]);
    const { groups } = filterAndGroupItems(structured, makeConfig());
    expect(groups.has("Loose")).toBe(true);
    expect(groups.get("Loose")!.map((r) => r.id)).toEqual(["loose"]);
    // Loose prints after the container section.
    expect(structured.findIndex((r) => r.id === "loose")).toBeGreaterThan(structured.findIndex((r) => r.id === "packed"));
  });

  it("a line with no units at all (service/generic) falls back to Loose", () => {
    const raw = [makeLineItem({ id: "svc", type: "SERVICE", categoryName: "Labour" })];
    const structured = structureLineItemsByContainer(raw, [makeContainer({})]);
    expect(structured.find((r) => r.id === "svc")?.groupName).toBe("Loose");
  });

  it("a container line item itself never appears as a member row", () => {
    const raw = [
      makeLineItem({ id: "case-li", isContainerLineItem: true, description: "Case 12" }),
      makeLineItem({ id: "content", categoryName: "Audio", units: [unit("u1", "c1")] }),
    ];
    const structured = structureLineItemsByContainer(raw, [makeContainer({})]);
    expect(structured.find((r) => r.id === "case-li")).toBeUndefined();
  });
});
