/**
 * Integration test for the Phase 6 supplier+model decommission: the recursive
 * Convex attach helper (`attachLineItemTree`) feeding the FULL PDF pipeline.
 *
 * Per CLAUDE.md's PDF data-shape rule, plugin-only unit tests are not enough —
 * a data-shape change has multiple independent `DocumentLineItem` consumers, so
 * this exercises the whole chain against a realistic equipment tree:
 *
 *   attachLineItemTree  →  (build-document-data enrichment)  →  structureLineItems
 *     →  filterAndGroupItems (status filter, react-pdf pipeline)  →  render
 *
 * The safety property under test is parity: the attached Convex model/supplier
 * docs must produce the same rendered output a Prisma `include: { model, supplier }`
 * join did — `model.name`, `model.category.name`, and the resolved `supplierName`
 * all reach the page, and no top-level item is dropped by the filter path.
 *
 * Also covers the Phase 6 location decommission: `locationName` (now resolved from
 * the Convex location map by `locationId` in build-document-data, not a Prisma
 * `asset.location` join) survives the pipeline as the packer-sort field.
 *
 * #1157 (cleanup) — ported from the pdfme-composer pipeline
 * (`getFilteredParentItems`/`calculateItemHeight`/`runTablePlugin`, all
 * deleted with #1156's cutover) to the react-pdf pipeline that replaced it.
 * React-pdf's automatic layout removes the manual height-reservation
 * consumer entirely (see FEATUREDOCS/13-pdfs.md) — the "no tail-drop"
 * property is now proven by actually rendering the tree.
 */
import { describe, it, expect } from "vitest";
import {
  attachLineItemTree,
  type LineItemAttachMaps,
} from "@/lib/line-item-tree-read";
import { structureLineItems, type CategoryForStructuring, type SubHireGroupForStructuring } from "./structure-line-items";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexSupplier } from "@/lib/suppliers-read";
import type { ConvexCategory } from "@/lib/categories-read";
import type { DocumentLineItem } from "./types";
import { filterAndGroupItems } from "@/lib/react-pdf/components/line-items-table";
import { PackingListDocument } from "@/lib/react-pdf/packing-list-document";
import { renderPdfPages } from "@/lib/react-pdf/pdf-test-utils";
import { makeSpikeData } from "@/lib/react-pdf/fixture";

// ── Convex doc fixtures (what the dual-write mirror returns) ──────────────────
function makeModel(over: Partial<ConvexModel> & { id: string; name: string }): ConvexModel {
  return {
    _id: `convex-${over.id}`,
    _creationTime: 0,
    organizationId: "org-1",
    ...over,
  } as ConvexModel;
}
function makeCategory(id: string, name: string, sortOrder: number): ConvexCategory {
  return { _id: `convex-${id}`, _creationTime: 0, id, organizationId: "org-1", name, sortOrder } as ConvexCategory;
}
function makeSupplier(id: string, name: string): ConvexSupplier {
  return { _id: `convex-${id}`, _creationTime: 0, id, organizationId: "org-1", name, isActive: true } as ConvexSupplier;
}

const maps: LineItemAttachMaps = {
  models: new Map([
    ["m-light", makeModel({ id: "m-light", name: "Source Four LED", modelNumber: "S4LED", weight: 8.5, categoryId: "cat-light" })],
    ["m-speaker", makeModel({ id: "m-speaker", name: "DXR10 Speaker", categoryId: "cat-audio" })],
    ["m-mic", makeModel({ id: "m-mic", name: "Wireless Mic", categoryId: "cat-audio" })],
  ]),
  suppliers: new Map([["sup-1", makeSupplier("sup-1", "Acme Hire")]]),
  categories: new Map([
    ["cat-light", makeCategory("cat-light", "Lighting", 0)],
    ["cat-audio", makeCategory("cat-audio", "Audio", 1)],
  ]),
};

/**
 * Raw line-item tree as the Prisma read now returns it (model + supplier joins
 * REMOVED — only `modelId` / `supplierId` remain, plus `childLineItems`). Shaped
 * like `DocumentLineItem` so the post-attach enrichment + structurer accept it.
 */
type RawNode = Omit<Partial<DocumentLineItem>, "childLineItems"> & {
  id: string;
  modelId?: string | null;
  supplierId?: string | null;
  childLineItems?: RawNode[];
};

const rawTree: RawNode[] = [
  // Owned, ungrouped Lighting line (qty 2).
  { id: "li-light", description: "Source Four LED", quantity: 2, status: "CHECKED_OUT", modelId: "m-light", categoryName: "Lighting" },
  // Hired-in Audio line inside a sub-hire group.
  { id: "li-speaker", description: "DXR10 Speaker", quantity: 1, status: "CHECKED_OUT", modelId: "m-speaker", supplierId: "sup-1", subHireGroupId: "shg-1", categoryName: "Audio" },
  // Kit parent with one serialized member (recursion + childKind).
  {
    id: "li-kit",
    description: "Mic Kit",
    quantity: 1,
    status: "CHECKED_OUT",
    kitId: "kit-1",
    kit: { assetTag: "KIT-001", name: "Mic Kit" },
    categoryName: "Audio",
    childLineItems: [
      { id: "li-kit-mic", description: "Wireless Mic", quantity: 4, status: "CHECKED_OUT", modelId: "m-mic", isKitChild: true, childKind: "KIT" },
    ],
  },
  // Stale-FK case: modelId with no Convex mirror row → attach must yield null.
  { id: "li-missing", description: "Orphan", quantity: 1, status: "CHECKED_OUT", modelId: "m-gone", categoryName: "Lighting" },
];

describe("attachLineItemTree — recursive Convex model/supplier attach", () => {
  const attached = attachLineItemTree(rawTree, maps);
  const byId = new Map(attached.map((r) => [r.id, r]));

  it("attaches the Convex model with its equipment category nested", () => {
    const light = byId.get("li-light")!;
    expect(light.model?.name).toBe("Source Four LED");
    expect(light.model?.modelNumber).toBe("S4LED");
    expect(light.model?.weight).toBe(8.5);
    expect(light.model?.category?.name).toBe("Lighting");
  });

  it("attaches the Convex supplier doc by supplierId", () => {
    expect(byId.get("li-speaker")!.supplier?.name).toBe("Acme Hire");
    expect(byId.get("li-light")!.supplier).toBeNull(); // no supplierId
  });

  it("recurses into childLineItems", () => {
    const kit = byId.get("li-kit")!;
    const child = kit.childLineItems?.[0] as unknown as { model: ConvexModel | null };
    expect(child.model?.name).toBe("Wireless Mic");
  });

  it("yields null on a mirror miss (no Prisma fallback)", () => {
    expect(byId.get("li-missing")!.model).toBeNull();
  });

  it("does not mutate the input rows", () => {
    expect((rawTree[0] as RawNode & { model?: unknown }).model).toBeUndefined();
  });
});

describe("full PDF pipeline parity (attach → structure → filter → render)", () => {
  // Replicate build-document-data's enrichment: derive supplierName from the
  // attached supplier doc, keep the attached model object as-is, and resolve
  // locationName from the Convex location map by the asset's locationId. The map
  // lookup itself lives in build-document-data (DB/Convex-coupled, not unit-
  // testable here) — this simulates its OUTPUT so the resolved field is exercised
  // through every downstream consumer, exactly as a Prisma `asset.location` join
  // value used to be.
  const resolvedLocationName: Record<string, string> = {
    "li-light": "Main Warehouse",
    "li-speaker": "Van 2",
  };
  const attached = attachLineItemTree(rawTree, maps);
  const enriched = attached.map((li) => ({
    ...li,
    supplierName: li.supplier?.name ?? null,
    locationName: resolvedLocationName[li.id] ?? null,
    showSubhireOnDocs: true,
  })) as unknown as DocumentLineItem[];

  const categories: CategoryForStructuring[] = [
    { id: "cat-light", name: "Lighting", sortOrder: 0, groups: [] },
    { id: "cat-audio", name: "Audio", sortOrder: 1, groups: [] },
  ];
  const subHireGroups: SubHireGroupForStructuring[] = [
    { id: "shg-1", title: "PA System", sortOrder: 0, supplierName: "Acme Hire" },
  ];

  const structured = structureLineItems(
    enriched,
    categories,
    { expandProjectGroups: true, packerSort: true },
    subHireGroups,
  );

  const PACKING_LIST_CONFIG = {
    documentType: "packing-list" as const,
    documentColor: "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: true,
    showCheckboxes: true,
    showConditionColumns: false,
    showPricing: false,
    showBadges: false,
    showNotes: false,
    showPerUnitCheckboxes: true,
    showAssetTags: true,
    showCategories: true,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: false,
  };

  it("keeps every top-level item through the status filter (no tail-drop)", () => {
    // Every item here is CHECKED_OUT — a mismatch is the classic silent
    // tail-drop the mandate guards against.
    const { groups } = filterAndGroupItems(structured, PACKING_LIST_CONFIG);
    const grouped = [...groups.values()].flat().length;
    expect(grouped).toBe(structured.filter((i) => !i.isKitChild && !i.isContainerLineItem).length);
  });

  it("renders attached model names + equipment category + supplier on the doc", async () => {
    const data = makeSpikeData({ line_items: structured, total_items: structured.length });
    const { fullText } = await renderPdfPages(<PackingListDocument data={data} />);

    // model.name reaches the page (parent + kit child).
    expect(fullText).toContain("Source Four LED");
    expect(fullText).toContain("Wireless Mic");
    // model.category.name reaches the packing-list category column.
    expect(fullText).toContain("Lighting");
    expect(fullText).toContain("Audio");
    // supplierName (resolved from the attached Convex supplier) reaches the
    // sub-hire indicator line ("via Acme Hire").
    expect(fullText).toContain("Acme Hire");
  });

  it("preserves the Convex-sourced locationName through structuring (packer-sort field intact)", () => {
    // locationName is the packer-sort key (structure-line-items). The location
    // decommission changed its SOURCE (Convex map, not a Prisma join) but not its
    // shape — every real item must still carry the resolved name post-structuring.
    const byId = new Map(structured.map((i) => [i.id, i]));
    expect(byId.get("li-light")?.locationName).toBe("Main Warehouse");
    expect(byId.get("li-speaker")?.locationName).toBe("Van 2");
  });
});
