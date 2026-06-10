/**
 * Unit tests for the warehouse `model_check_item` count-attach path
 * (`collectTreeModelIds` + `attachModelCheckItemCounts`).
 *
 * `model_check_item` is the one cross-domain join on the line-item tree NOT
 * served off the Convex mirror, so the warehouse reads source its per-model
 * count from Prisma and graft it back onto the Convex-attached model nodes. The
 * safety property: the grafted shape must match the old Prisma
 * `model: { ..., _count: { modelCheckItems } }` include — at every tree depth,
 * with map-misses falling to 0 and null models preserved.
 */
import { describe, it, expect } from "vitest";
import {
  attachLineItemTree,
  attachModelCheckItemCounts,
  attachKitTree,
  collectTreeModelIds,
  type LineItemAttachMaps,
} from "@/lib/line-item-tree-read";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexCategory } from "@/lib/categories-read";
import type { ConvexKit } from "@/lib/kits-read";

function makeModel(id: string, name: string, categoryId?: string): ConvexModel {
  return { _id: `convex-${id}`, _creationTime: 0, id, organizationId: "org-1", name, categoryId } as ConvexModel;
}
function makeCategory(id: string, name: string): ConvexCategory {
  return { _id: `convex-${id}`, _creationTime: 0, id, organizationId: "org-1", name, sortOrder: 0 } as ConvexCategory;
}

const maps: LineItemAttachMaps = {
  models: new Map([
    ["m-light", makeModel("m-light", "Source Four LED", "cat-light")],
    ["m-speaker", makeModel("m-speaker", "DXR10 Speaker", "cat-audio")],
    ["m-mic", makeModel("m-mic", "Wireless Mic", "cat-audio")],
    ["m-orphan", makeModel("m-orphan", "Uncounted Model")],
  ]),
  suppliers: new Map(),
  categories: new Map([
    ["cat-light", makeCategory("cat-light", "Lighting")],
    ["cat-audio", makeCategory("cat-audio", "Audio")],
  ]),
};

// A realistic 3-deep tree: a kit parent with members, a child with no model,
// and the same model id appearing twice (dedup) at different depths.
type RawNode = { id: string; modelId: string | null; supplierId: string | null; childLineItems?: RawNode[] };
const rawTree: RawNode[] = [
  {
    id: "li-kit",
    modelId: "m-light",
    supplierId: null,
    childLineItems: [
      { id: "li-kit-mem1", modelId: "m-speaker", supplierId: null },
      {
        id: "li-kit-mem2",
        modelId: "m-light", // duplicate model id, deeper in the tree
        supplierId: null,
        childLineItems: [{ id: "li-grandchild", modelId: "m-mic", supplierId: null }],
      },
    ],
  },
  { id: "li-custom", modelId: null, supplierId: null }, // no model
  { id: "li-orphan", modelId: "m-orphan", supplierId: null }, // model with no check items
];

describe("collectTreeModelIds", () => {
  it("collects distinct model ids across all depths, ignoring nulls", () => {
    const ids = collectTreeModelIds(rawTree);
    expect(new Set(ids)).toEqual(new Set(["m-light", "m-speaker", "m-mic", "m-orphan"]));
    // de-duplicated: m-light appears twice in the tree
    expect(ids.filter((id) => id === "m-light")).toHaveLength(1);
  });

  it("returns [] for an empty tree", () => {
    expect(collectTreeModelIds([])).toEqual([]);
  });
});

describe("attachModelCheckItemCounts", () => {
  // Prisma groupBy result: m-light has 3 checks, m-speaker 1, m-mic 0 (absent),
  // m-orphan absent → both fall to 0.
  const countMap = new Map<string, number>([
    ["m-light", 3],
    ["m-speaker", 1],
  ]);

  function attach() {
    const attached = attachLineItemTree(rawTree, maps);
    return attachModelCheckItemCounts(attached, countMap);
  }

  it("grafts _count.modelCheckItems matching the old Prisma include shape", () => {
    const [kit] = attach();
    expect(kit.model).not.toBeNull();
    expect(kit.model?._count).toEqual({ modelCheckItems: 3 });
    // model scalars + Convex category still present (came off the mirror)
    expect(kit.model?.name).toBe("Source Four LED");
    expect(kit.model?.category?.name).toBe("Lighting");
  });

  it("grafts at every depth (member and grandchild)", () => {
    const [kit] = attach();
    const children = kit.childLineItems as unknown as Array<{ model: { _count: { modelCheckItems: number } } | null; childLineItems?: unknown }>;
    expect(children[0].model?._count.modelCheckItems).toBe(1); // m-speaker
    const grandchildren = children[1].childLineItems as unknown as Array<{ model: { _count: { modelCheckItems: number } } | null }>;
    expect(grandchildren[0].model?._count.modelCheckItems).toBe(0); // m-mic absent → 0
  });

  it("defaults absent models to 0", () => {
    const tree = attach();
    const orphan = tree.find((n) => n.id === "li-orphan");
    expect(orphan?.model?._count).toEqual({ modelCheckItems: 0 });
  });

  it("preserves null models (no fake model fabricated)", () => {
    const tree = attach();
    const custom = tree.find((n) => n.id === "li-custom");
    expect(custom?.model).toBeNull();
  });

  it("does not mutate the attached input", () => {
    const attached = attachLineItemTree(rawTree, maps);
    const before = attached[0].model;
    attachModelCheckItemCounts(attached, countMap);
    // grafting clones the model node rather than mutating in place
    expect(before).not.toHaveProperty("_count");
  });
});

describe("attachKitTree", () => {
  function makeKit(id: string, name: string): ConvexKit {
    return {
      _id: `convex-${id}`,
      _creationTime: 0,
      id,
      organizationId: "org-1",
      assetTag: `TAG-${id}`,
      name,
      checkMode: "KIT_LEVEL",
    } as ConvexKit;
  }

  // A 3-deep tree: a kit parent, a kit-child that is itself a (nested) kit, and a
  // grandchild with no kitId. One kit id (k-rack) is absent from the mirror.
  type KitNode = { id: string; kitId: string | null; childLineItems?: KitNode[] };
  const tree: KitNode[] = [
    {
      id: "li-kit",
      kitId: "k-stage",
      childLineItems: [
        { id: "li-member", kitId: null },
        {
          id: "li-nested-kit",
          kitId: "k-sub",
          childLineItems: [{ id: "li-grandchild", kitId: null }],
        },
      ],
    },
    { id: "li-missing-kit", kitId: "k-rack" }, // kit absent from the mirror
    { id: "li-plain", kitId: null },
  ];

  const kitMap = new Map<string, ConvexKit>([
    ["k-stage", makeKit("k-stage", "Stage Kit")],
    ["k-sub", makeKit("k-sub", "Sub Kit")],
  ]);
  // k-stage has 4 check items, k-sub 0 (absent → 0).
  const kitCountMap = new Map<string, number>([["k-stage", 4]]);

  it("attaches the Convex kit + grafts _count.kitCheckItems matching the old include", () => {
    const [kit] = attachKitTree(tree, kitMap, kitCountMap);
    expect(kit.kit?.name).toBe("Stage Kit");
    expect(kit.kit?.assetTag).toBe("TAG-k-stage");
    expect(kit.kit?.checkMode).toBe("KIT_LEVEL");
    expect(kit.kit?._count).toEqual({ kitCheckItems: 4 });
  });

  it("attaches + counts at every depth (nested kit)", () => {
    const [kit] = attachKitTree(tree, kitMap, kitCountMap);
    const children = kit.childLineItems as unknown as Array<{ kit: { _count: { kitCheckItems: number } } | null }>;
    expect(children[0].kit).toBeNull(); // li-member has no kitId
    expect(children[1].kit?._count.kitCheckItems).toBe(0); // k-sub absent from count map → 0
  });

  it("yields kit: null for a kitId absent from the mirror — NO Prisma fallback", () => {
    const result = attachKitTree(tree, kitMap, kitCountMap);
    expect(result.find((n) => n.id === "li-missing-kit")?.kit).toBeNull();
  });

  it("yields kit: null when the node has no kitId", () => {
    const result = attachKitTree(tree, kitMap, kitCountMap);
    expect(result.find((n) => n.id === "li-plain")?.kit).toBeNull();
  });

  it("does not mutate the input rows", () => {
    attachKitTree(tree, kitMap, kitCountMap);
    expect(tree[0]).not.toHaveProperty("kit");
  });
});
