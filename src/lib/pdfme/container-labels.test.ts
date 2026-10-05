/**
 * Container & kit labels (FEATUREDOCS/83) — runs the REAL structuring step
 * (`structureLineItemsByContainer`) and then the label builder, so the
 * accessory-in-another-case behaviour is proven on the shape the document
 * pipeline actually produces, not on a hand-built label model.
 */
import { describe, it, expect } from "vitest";
import { structureLineItemsByContainer, type ContainerForStructuring } from "./structure-line-items-by-container";
import { buildContainerLabels, buildKitLabels } from "./container-labels";
import type { DocumentLineItem } from "./types";

function li(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: "li", description: null, quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY",
    duration: 1, discount: null, lineTotal: null, groupName: null, categoryName: null, groupTitle: null,
    isOptional: false, notes: null, status: "CONFIRMED", model: null, asset: null, bulkAsset: null, ...overrides,
  };
}
const unit = (id: string, tag: string | null, containerId: string | null) => ({
  id, asset: tag ? { assetTag: tag } : null, bulkAsset: null, status: "PACKED", containerId,
});
const box = (id: string, label: string, sortOrder: number, extra: Partial<ContainerForStructuring> = {}): ContainerForStructuring =>
  ({ id, kind: "CUSTOM", label, sortOrder, ...extra });

const titan = box("c-titan", "Titan AV Case", 0);
const pelican = box("c-pel", "Pelican 1450", 1);

describe("buildContainerLabels", () => {
  it("lists a line's serialised tags and gives every container a label with its position", () => {
    const rows = structureLineItemsByContainer(
      [li({ id: "a", model: { name: "IMX6A Headset" }, quantity: 2, units: [unit("u1", "TTP1", "c-titan"), unit("u2", "TTP2", "c-titan")] })],
      [titan, pelican],
    );
    const labels = buildContainerLabels(rows);
    expect(labels.map((l) => [l.title, l.index, l.total])).toEqual([["Titan AV Case", 1, 2], ["Pelican 1450", 2, 2]]);
    expect(labels[0].lines).toEqual([{ qty: 2, name: "IMX6A Headset", tags: ["TTP1", "TTP2"], accessories: [] }]);
    expect(labels[1].lines).toEqual([]);
  });

  it("keeps accessories with the parent and never gives them asset tags", () => {
    const lav = li({ id: "lav", childKind: "ACCESSORY", isKitChild: true, model: { name: "Lav mic" }, quantity: 2, units: [unit("l1", "LAV1", "c-titan"), unit("l2", "LAV2", "c-titan")] });
    const rows = structureLineItemsByContainer(
      [li({ id: "p", model: { name: "EW-DX SK" }, quantity: 1, units: [unit("p1", "TX1", "c-titan")], childLineItems: [lav] })],
      [titan, pelican],
    );
    const line = buildContainerLabels(rows)[0].lines[0];
    expect(line.accessories).toEqual([{ qty: 2, name: "Lav mic" }]);
    expect(JSON.stringify(line.accessories)).not.toContain("LAV1");
  });

  it("points an accessory packed in another case both ways", () => {
    const lav = li({
      id: "lav", childKind: "ACCESSORY", isKitChild: true, model: { name: "Lav mic" }, quantity: 3,
      units: [unit("l1", null, "c-pel"), unit("l2", null, "c-pel"), unit("l3", null, "c-titan")],
    });
    const rows = structureLineItemsByContainer(
      [li({ id: "p", model: { name: "EW-DX SK" }, quantity: 3, units: [unit("p1", "TX1", "c-titan")], childLineItems: [lav] })],
      [titan, pelican],
    );
    const [titanLabel, pelLabel] = buildContainerLabels(rows);
    expect(titanLabel.lines[0].accessories).toEqual([
      { qty: 1, name: "Lav mic" },
      { qty: 2, name: "Lav mic", elsewhereIn: "Pelican 1450" },
    ]);
    // 1 parent + 1 accessory stays here; the 2 travelling count in Pelican, once.
    expect([titanLabel.itemCount, pelLabel.itemCount]).toEqual([3 + 1, 2]);
    expect(pelLabel.lines).toEqual([
      { qty: 2, name: "Lav mic", tags: [], accessories: [], accessoryOf: { parentName: "EW-DX SK", parentContainerLabel: "Titan AV Case" } },
    ]);
  });

  it("lists a nested case under the case it is packed in", () => {
    const tub = box("c-tub", "Tub 1", 2, { parentContainerId: "c-titan", tag: "TUB1" });
    const labels = buildContainerLabels(structureLineItemsByContainer([], [titan, tub]));
    const outer = labels.find((l) => l.id === "c-titan")!;
    expect(outer.lines).toEqual([{ qty: 1, name: "Tub 1", tags: ["TUB1"], accessories: [] }]);
    expect(labels.find((l) => l.id === "c-tub")!.packedIn).toBe("Titan AV Case");
  });
});

describe("buildKitLabels", () => {
  it("builds a kit label from the kit's own members and tag, noting the case it is in", () => {
    const member = (id: string, name: string, tag: string, qty = 1) =>
      li({ id, isKitChild: true, childKind: "KIT", model: { name }, quantity: qty, units: [unit(`${id}u`, tag, null)] });
    const kit = li({
      id: "kit-line", kitId: "k1", description: "RF Kit 1", kit: { assetTag: "TTP00077", name: "RF Kit 1" },
      units: [unit("ku", "TTP00077", "c-titan")],
      childLineItems: [member("m1", "EW-DX EM 2 Dante", "TTP00001", 1), member("m2", "GS510TPP", "TTP00064")],
    });
    const labels = buildKitLabels(structureLineItemsByContainer([kit], [titan]));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ kind: "kit", title: "RF Kit 1", tag: "TTP00077", packedIn: "Titan AV Case", itemCount: 2 });
    expect(labels[0].lines.map((l) => [l.qty, l.name, l.tags])).toEqual([[1, "EW-DX EM 2 Dante", ["TTP00001"]], [1, "GS510TPP", ["TTP00064"]]]);
  });
});
