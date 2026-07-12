import { describe, expect, it } from "vitest";
import {
  reconstructOverbookedStatus,
  resolveModelAssetType,
  type OverbookingBundleData,
  type OverbookLineItem,
} from "./overbooking-core";

// ── Fixture builders ─────────────────────────────────────────────────────────
// The bundle returns RAW Convex docs; reconstructOverbookedStatus maps the
// line items via mapLineItemDoc and reads a handful of fields off the others.
// We build minimal partial docs and cast — only the read fields matter.

const ORG = "org_1";
const THIS_PROJECT = "proj_this";

function bundleLineItem(p: {
  id: string;
  projectId: string;
  modelId: string | null;
  quantity: number;
  status?: string;
  subHireId?: string | null;
}) {
  return {
    id: p.id,
    organizationId: ORG,
    projectId: p.projectId,
    modelId: p.modelId,
    quantity: p.quantity,
    status: p.status ?? "QUOTED",
    subHireId: p.subHireId ?? null,
  };
}

function project(p: {
  id: string;
  start: number | null;
  end: number | null;
  status?: string;
  isTemplate?: boolean;
}) {
  return {
    id: p.id,
    organizationId: ORG,
    projectNumber: "PRJ-" + p.id,
    name: p.id,
    status: p.status ?? "CONFIRMED",
    isTemplate: p.isTemplate ?? false,
    rentalStartDate: p.start,
    rentalEndDate: p.end,
    clientId: null,
  };
}

function model(id: string, assetType: "SERIALIZED" | "BULK") {
  return { id, organizationId: ORG, assetType };
}

function asset(p: { id: string; modelId: string; status?: string; isActive?: boolean }) {
  return {
    id: p.id,
    organizationId: ORG,
    modelId: p.modelId,
    status: p.status ?? "AVAILABLE",
    isActive: p.isActive ?? true,
  };
}

function bulk(p: { id: string; modelId: string; totalQuantity: number; isActive?: boolean }) {
  return {
    id: p.id,
    organizationId: ORG,
    modelId: p.modelId,
    totalQuantity: p.totalQuantity,
    isActive: p.isActive ?? true,
  };
}

function makeBundle(parts: {
  lineItems?: ReturnType<typeof bundleLineItem>[];
  assets?: ReturnType<typeof asset>[];
  bulkAssets?: ReturnType<typeof bulk>[];
  projects?: ReturnType<typeof project>[];
  models?: ReturnType<typeof model>[];
}): OverbookingBundleData {
  return {
    lineItems: parts.lineItems ?? [],
    assets: parts.assets ?? [],
    bulkAssets: parts.bulkAssets ?? [],
    projects: parts.projects ?? [],
    models: parts.models ?? [],
  } as unknown as OverbookingBundleData;
}

const WINDOW_START = new Date("2026-01-01T00:00:00Z");
const WINDOW_END = new Date("2026-01-10T00:00:00Z");

describe("reconstructOverbookedStatus", () => {
  it("returns empty when no line item has a model", () => {
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: null, quantity: 5, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const map = reconstructOverbookedStatus(makeBundle({}), items, WINDOW_START, WINDOW_END, THIS_PROJECT);
    expect(map.size).toBe(0);
  });

  it("flags a model overbooked when this project books more than effective stock", () => {
    // 2 serialized assets, this project books 3 → overBy 1.
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 3, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: [asset({ id: "a1", modelId: "m1" }), asset({ id: "a2", modelId: "m1" })],
      projects: [project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() })],
      lineItems: [bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 3 })],
    });
    const map = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT);
    expect(map.get("li1")).toMatchObject({ overBy: 1, totalStock: 2, effectiveStock: 2, totalBooked: 3 });
  });

  it("does not flag when within stock", () => {
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 2, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: [asset({ id: "a1", modelId: "m1" }), asset({ id: "a2", modelId: "m1" })],
      projects: [project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() })],
      lineItems: [bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 2 })],
    });
    const map = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT);
    expect(map.has("li1")).toBe(false);
  });

  it("marks reducedOnly when overbooking is caused solely by unavailable assets", () => {
    // 2 assets, 1 in maintenance → effective 1; this project books 2 → over by 1,
    // but with full stock (2) it would NOT be over → reducedOnly true.
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 2, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: [asset({ id: "a1", modelId: "m1" }), asset({ id: "a2", modelId: "m1", status: "IN_MAINTENANCE" })],
      projects: [project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() })],
      lineItems: [bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 2 })],
    });
    const info = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT).get("li1");
    expect(info).toMatchObject({ overBy: 1, totalStock: 2, effectiveStock: 1, reducedOnly: true, unavailableAssets: 1 });
  });

  it("counts bookings from other overlapping projects against availability", () => {
    // stock 3; another project books 2 in-window; this project books 2 → over by 1.
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 2, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: ["a1", "a2", "a3"].map((id) => asset({ id, modelId: "m1" })),
      projects: [
        project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() }),
        project({ id: "proj_other", start: WINDOW_START.getTime(), end: WINDOW_END.getTime() }),
      ],
      lineItems: [
        bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 2 }),
        bundleLineItem({ id: "li_other", projectId: "proj_other", modelId: "m1", quantity: 2 }),
      ],
    });
    const info = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT).get("li1");
    expect(info).toMatchObject({ overBy: 1, totalStock: 3, totalBooked: 4 });
  });

  it("excludes sub-hire line items from stock consumption", () => {
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 5, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED", subHireId: "sh1" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: [asset({ id: "a1", modelId: "m1" })],
      projects: [project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() })],
      lineItems: [bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 5, subHireId: "sh1" })],
    });
    const map = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT);
    expect(map.size).toBe(0);
  });

  it("dateless project only counts its own bookings (ignores other projects)", () => {
    // No rental window: other-project bookings must NOT count.
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 2, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: ["a1", "a2", "a3"].map((id) => asset({ id, modelId: "m1" })),
      projects: [
        project({ id: THIS_PROJECT, start: null, end: null }),
        project({ id: "proj_other", start: WINDOW_START.getTime(), end: WINDOW_END.getTime() }),
      ],
      lineItems: [
        bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 2 }),
        bundleLineItem({ id: "li_other", projectId: "proj_other", modelId: "m1", quantity: 3 }),
      ],
    });
    // stock 3, only this project's 2 count → within stock, not overbooked.
    const map = reconstructOverbookedStatus(bundle, items, null, null, THIS_PROJECT);
    expect(map.has("li1")).toBe(false);
  });

  it("marks a kit parent overbooked (inherited) when a kit child is overbooked", () => {
    // kit parent 'kp' with child 'kc' (model m1, stock 1, books 2 → over by 1).
    const items: OverbookLineItem[] = [
      { id: "kp", modelId: null, quantity: 1, isKitChild: false, parentLineItemId: null, kitId: "kit1", status: "QUOTED" },
      { id: "kc", modelId: "m1", quantity: 2, isKitChild: true, parentLineItemId: "kp", kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      models: [model("m1", "SERIALIZED")],
      assets: [asset({ id: "a1", modelId: "m1" })],
      projects: [project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() })],
      lineItems: [bundleLineItem({ id: "kc", projectId: THIS_PROJECT, modelId: "m1", quantity: 2 })],
    });
    const map = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT);
    expect(map.get("kc")).toMatchObject({ overBy: 1 });
    expect(map.get("kp")).toMatchObject({ overBy: 1, inherited: true, hasOverbookedChildren: true });
  });

  it("counts bulk stock for a BULK model whose assetType mirror field is absent", () => {
    // Regression: older/backfilled Convex model docs read back assetType === undefined.
    // Defaulting to SERIALIZED made totalStock = assets.length = 0 → every bulk line
    // showed "0 available" and was spuriously overbooked. With the bulk-asset signal,
    // the model resolves to BULK and its 10-unit stock is counted.
    const items: OverbookLineItem[] = [
      { id: "li1", modelId: "m1", quantity: 6, isKitChild: false, parentLineItemId: null, kitId: null, status: "QUOTED" },
    ];
    const bundle = makeBundle({
      // assetType intentionally omitted (undefined) — the mirror gap this fixes.
      models: [{ id: "m1", organizationId: ORG } as unknown as ReturnType<typeof model>],
      bulkAssets: [bulk({ id: "b1", modelId: "m1", totalQuantity: 10 })],
      projects: [project({ id: THIS_PROJECT, start: WINDOW_START.getTime(), end: WINDOW_END.getTime() })],
      lineItems: [bundleLineItem({ id: "li1", projectId: THIS_PROJECT, modelId: "m1", quantity: 6 })],
    });
    // 6 booked against 10 bulk units → within stock, NOT overbooked.
    const map = reconstructOverbookedStatus(bundle, items, WINDOW_START, WINDOW_END, THIS_PROJECT);
    expect(map.has("li1")).toBe(false);
  });
});

describe("resolveModelAssetType", () => {
  it("returns a present value unchanged", () => {
    expect(resolveModelAssetType("SERIALIZED", true)).toBe("SERIALIZED");
    expect(resolveModelAssetType("BULK", false)).toBe("BULK");
  });
  it("falls back to BULK when assetType is absent but bulk assets exist", () => {
    expect(resolveModelAssetType(undefined, true)).toBe("BULK");
    expect(resolveModelAssetType(null, true)).toBe("BULK");
  });
  it("falls back to SERIALIZED when assetType is absent and there are no bulk assets", () => {
    expect(resolveModelAssetType(undefined, false)).toBe("SERIALIZED");
  });
});
