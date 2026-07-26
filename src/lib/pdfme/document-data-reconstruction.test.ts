/**
 * Full PDF-pipeline integration test for the Phase A keystone (consumer 4/4):
 * the line-item-tree RECONSTRUCTION from FLAT Convex rows feeding the whole PDF
 * pipeline. Per CLAUDE.md's PDF data-shape rule, plugin-only unit tests are not
 * enough — a data-shape change has five independent `DocumentLineItem` consumers,
 * so this exercises the chain that `build-document-data.ts` now runs:
 *
 *   {mapLineItemDoc/mapUnitDoc/...} → indexChildren/indexUnits/reconstructScope
 *     → attachLineItemTree + attachAssetBulkAssetTree  (buildDocumentLineItemData's
 *       pure core, fed flat Convex docs)
 *     → (build-document-data enrichment) → structureLineItems
 *     → getFilteredParentItems (status filter) → calculateItemHeight (height)
 *     → gearflowTable.pdf (render)
 *
 * Safety properties under test: the reconstruction drops CANCELLED tombstones,
 * nests kit children to the include depth (2) with their grandchildren, attaches
 * units with their physical-asset tags, and the resulting tree survives the filter
 * + height path with no silent tail-drop (the v0.8.1.x class) and renders model
 * names + categories on the page.
 */
import { describe, it, expect } from "vitest";
import { mapLineItemDoc, mapUnitDoc } from "@/lib/project-line-item-read";
import {
  indexChildren,
  indexUnits,
  reconstructScope,
} from "@/lib/project-line-item-tree-read";
import {
  attachLineItemTree,
  attachAssetBulkAssetTree,
  type LineItemAttachMaps,
} from "@/lib/line-item-tree-read";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexCategory } from "@/lib/categories-read";
import type { ConvexAsset } from "@/lib/assets-read";
import { structureLineItems, type CategoryForStructuring } from "./structure-line-items";
import { getFilteredParentItems, calculateItemHeight } from "./document-composer";
import { DOCUMENT_LAYOUTS } from "./document-layouts";
import { runTablePlugin } from "./plugins/test-utils";
import type { DocumentData, DocumentLineItem } from "./types";

const MS = 1_700_000_000_000;

// ── Flat Convex docs (what listByProject / listByLineItemIds return) ──────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lineItemDocs: any[] = [
  { _id: "cx1", _creationTime: 1, id: "kitParent", organizationId: "o", projectId: "p", type: "EQUIPMENT", kitId: "k1", modelId: "m-kit", categoryId: "cat-audio", groupId: "g1", quantity: 1, sortOrder: 100, status: "CONFIRMED", createdAt: MS, updatedAt: MS },
  { _id: "cx2", _creationTime: 1, id: "kitChild", organizationId: "o", projectId: "p", type: "EQUIPMENT", modelId: "m-mic", categoryId: "cat-audio", groupId: "g1", isKitChild: true, childKind: "KIT", parentLineItemId: "kitParent", quantity: 4, sortOrder: 0, status: "CONFIRMED", createdAt: MS, updatedAt: MS },
  { _id: "cx3", _creationTime: 1, id: "grandChild", organizationId: "o", projectId: "p", type: "EQUIPMENT", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "kitChild", quantity: 1, sortOrder: 0, status: "CONFIRMED", createdAt: MS, updatedAt: MS },
  { _id: "cx4", _creationTime: 1, id: "plainLine", organizationId: "o", projectId: "p", type: "EQUIPMENT", modelId: "m-light", categoryId: "cat-light", quantity: 3, sortOrder: 200, status: "CONFIRMED", createdAt: MS, updatedAt: MS },
  // CANCELLED tombstone — reconstruction must drop it.
  { _id: "cx5", _creationTime: 1, id: "cancelled", organizationId: "o", projectId: "p", type: "EQUIPMENT", modelId: "m-light", quantity: 1, sortOrder: 300, status: "CANCELLED", createdAt: MS, updatedAt: MS },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unitDocs: any[] = [
  { _id: "cu1", _creationTime: 1, id: "u1", organizationId: "o", lineItemId: "plainLine", ordinal: 0, assetId: "a1", status: "CONFIRMED" },
  { _id: "cu2", _creationTime: 1, id: "u2", organizationId: "o", lineItemId: "plainLine", ordinal: 1, status: "CANCELLED" }, // dropped by indexUnits
];
function makeModel(id: string, name: string, categoryId: string): ConvexModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { _id: `cm-${id}`, _creationTime: 1, id, organizationId: "o", name, modelNumber: name, categoryId, weight: 5, isActive: true } as any;
}
function makeCategory(id: string, name: string): ConvexCategory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { _id: `cc-${id}`, _creationTime: 1, id, organizationId: "o", name } as any;
}
const maps: LineItemAttachMaps = {
  models: new Map([
    ["m-kit", makeModel("m-kit", "Mic Kit Model", "cat-audio")],
    ["m-mic", makeModel("m-mic", "Wireless Mic", "cat-audio")],
    ["m-light", makeModel("m-light", "Source Four LED", "cat-light")],
  ]),
  suppliers: new Map(),
  categories: new Map([
    ["cat-audio", makeCategory("cat-audio", "Audio")],
    ["cat-light", makeCategory("cat-light", "Lighting")],
  ]),
};
const assetMap = new Map<string, ConvexAsset>([
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ["a1", { _id: "ca1", _creationTime: 1, id: "a1", organizationId: "o", assetTag: "AST-001", locationId: "loc-1" } as any],
]);

/** Mirror buildDocumentLineItemData's PURE core (no Convex I/O): map → reconstruct
 *  (drop CANCELLED, depth 2) → attach model/supplier + asset/bulkAsset. */
function reconstruct() {
  const lineItems = lineItemDocs.map(mapLineItemDoc);
  const units = unitDocs.map(mapUnitDoc);
  const byParent = indexChildren(lineItems);
  const unitsByLineItem = indexUnits(units);
  const tree = reconstructScope(lineItems, byParent, { unitsByLineItem, depth: 2 });
  const withModel = attachLineItemTree(tree, maps);
  return attachAssetBulkAssetTree(withModel, assetMap, new Map());
}

describe("keystone reconstruction → full PDF pipeline", () => {
  const tree = reconstruct();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map(tree.map((r: any) => [r.id, r]));

  it("drops CANCELLED tombstones during reconstruction", () => {
    expect(byId.has("cancelled")).toBe(false);
    expect(byId.has("kitParent")).toBe(true);
  });

  it("nests kit children to include depth (2) incl. the grandchild", () => {
    // kitParent (top, depth 2) → kitChild → grandChild.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kitParent = byId.get("kitParent") as any;
    expect(kitParent.childLineItems.map((c: { id: string }) => c.id)).toEqual(["kitChild"]);
    const kitChild = kitParent.childLineItems[0];
    expect(kitChild.model?.name).toBe("Wireless Mic");
    expect(kitChild.childLineItems.map((c: { id: string }) => c.id)).toEqual(["grandChild"]);
  });

  it("attaches units (non-CANCELLED) with their physical-asset tags", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plain = byId.get("plainLine") as any;
    expect(plain.units).toHaveLength(1); // CANCELLED unit dropped
    expect(plain.units[0].asset?.assetTag).toBe("AST-001");
  });

  describe("structure → filter → height → render", () => {
    const enriched = tree.map((li) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const liAny = li as any;
      return { ...liAny, categoryName: liAny.model?.category?.name ?? null, supplierName: null, locationName: "Main Warehouse" };
    }) as unknown as DocumentLineItem[];
    const categories: CategoryForStructuring[] = [
      { id: "cat-light", name: "Lighting", sortOrder: 0, groups: [] },
      { id: "cat-audio", name: "Audio", sortOrder: 1, groups: [{ id: "g1", title: "Mic Kit", description: null, quantity: 1, price: null, discount: null, sortOrder: 0 }] },
    ];
    const structured = structureLineItems(enriched, categories, { expandProjectGroups: true, packerSort: true }, []);

    it("keeps every top-level item through the status filter (no tail-drop)", () => {
      const data = { line_items: structured } as DocumentData;
      const parents = getFilteredParentItems(data, DOCUMENT_LAYOUTS["packing-list"].filterByStatus);
      const expectedTop = structured.filter((i) => !i.isKitChild && !i.isContainerLineItem).length;
      expect(parents.length).toBe(expectedTop);
    });

    it("reserves height for the whole structured list (consumer #2 tail-drop guard)", () => {
      const tableBlock = DOCUMENT_LAYOUTS["packing-list"].blocks.find((b) => b.kind === "table");
      if (tableBlock?.kind !== "table") throw new Error("packing-list layout has no table block");
      const hAll = structured.reduce((sum, item) => sum + calculateItemHeight(item, tableBlock.config), 0);
      const hOne = calculateItemHeight(structured[0], tableBlock.config);
      expect(Number.isFinite(hAll)).toBe(true);
      expect(hAll).toBeGreaterThan(hOne);
    });

    it("renders reconstructed model names + categories on the page", async () => {
      const calls = await runTablePlugin(structured, { documentType: "packing-list", showCategories: true });
      const text = calls.drawText.map((c) => c.text).join("\n");
      expect(text).toContain("Wireless Mic");
      expect(text).toContain("Source Four LED");
      expect(text).toContain("Audio");
      expect(text).toContain("Lighting");
    });
  });
});
