import { describe, it, expect } from "vitest";
import {
  reconstructProjectEquipmentTree,
  type EquipmentBundleData,
} from "./project-equipment-reconstruct";

/**
 * Unit coverage for the client-safe equipment reconstruction (Phase 1d, Stage B).
 * The server buildProjectEquipmentTree now delegates to this same function, so
 * these assertions are the parity guard for both the server path and the native
 * browser path.
 */

const EMPTY: EquipmentBundleData = {
  lineItems: [],
  projectCategories: [],
  groups: [],
  units: [],
  assets: [],
  bulkAssets: [],
  kits: [],
  models: [],
  suppliers: [],
  categories: [],
};

// Minimal doc factories — the mappers fill every other field via `?? default`.
const doc = <T extends Record<string, unknown>>(o: T) =>
  ({ _id: `id_${o.id}`, _creationTime: 0, ...o }) as unknown;

function bundle(overrides: Partial<EquipmentBundleData>): EquipmentBundleData {
  return { ...EMPTY, ...overrides };
}

describe("reconstructProjectEquipmentTree", () => {
  it("returns empty categories + lineItems for an empty bundle", () => {
    const tree = reconstructProjectEquipmentTree(EMPTY);
    expect(tree).toEqual({ categories: [], lineItems: [] });
  });

  it("maps a top-level line item (defaults + epoch-ms → Date)", () => {
    const tree = reconstructProjectEquipmentTree(
      bundle({
        lineItems: [
          doc({ id: "li1", organizationId: "o1", projectId: "p1", createdAt: 1000 }),
        ] as EquipmentBundleData["lineItems"],
      }),
    );
    expect(tree.lineItems).toHaveLength(1);
    const li = tree.lineItems[0];
    expect(li.id).toBe("li1");
    expect(li.quantity).toBe(1); // default
    expect(li.status).toBe("QUOTED"); // default
    expect(li.createdAt).toBeInstanceOf(Date);
    expect(li.model).toBeNull();
    expect(li.asset).toBeNull();
  });

  it("attaches model (with category) + supplier from the bundle maps", () => {
    const tree = reconstructProjectEquipmentTree(
      bundle({
        lineItems: [
          doc({ id: "li1", organizationId: "o1", projectId: "p1", modelId: "m1", supplierId: "s1" }),
        ] as EquipmentBundleData["lineItems"],
        models: [doc({ id: "m1", organizationId: "o1", name: "Model A", categoryId: "c1" })] as EquipmentBundleData["models"],
        suppliers: [doc({ id: "s1", organizationId: "o1", name: "Supplier A" })] as EquipmentBundleData["suppliers"],
        categories: [doc({ id: "c1", organizationId: "o1", name: "Cat A" })] as EquipmentBundleData["categories"],
      }),
    );
    const li = tree.lineItems[0] as { model: { id: string; category: { id: string } | null } | null; supplier: { id: string } | null };
    expect(li.model?.id).toBe("m1");
    expect(li.model?.category?.id).toBe("c1");
    expect(li.supplier?.id).toBe("s1");
  });

  it("builds the category → group → lineItems grouped tree", () => {
    const tree = reconstructProjectEquipmentTree(
      bundle({
        projectCategories: [
          doc({ id: "cat1", organizationId: "o1", projectId: "p1", name: "Audio", sortOrder: 0 }),
        ] as EquipmentBundleData["projectCategories"],
        groups: [
          doc({ id: "g1", organizationId: "o1", projectId: "p1", categoryId: "cat1", title: "Mics", sortOrder: 0 }),
        ] as EquipmentBundleData["groups"],
        lineItems: [
          doc({ id: "li1", organizationId: "o1", projectId: "p1", categoryId: "cat1", groupId: "g1" }),
        ] as EquipmentBundleData["lineItems"],
      }),
    );
    expect(tree.categories).toHaveLength(1);
    expect(tree.categories[0].id).toBe("cat1");
    expect(tree.categories[0].groups).toHaveLength(1);
    expect(tree.categories[0].groups[0].id).toBe("g1");
    // The line item appears in the grouped tree AND the flat top-level list.
    expect(tree.lineItems.some((li) => li.id === "li1")).toBe(true);
  });
});
