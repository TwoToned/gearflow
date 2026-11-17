import { describe, it, expect } from "vitest";
import { buildJobSections, buildJobRow, type JobRowsCtx } from "./warehouse-job-rows";
import type { LineItem } from "@/components/warehouse/warehouse-types";

const li = (over: Partial<LineItem>): LineItem => ({
  id: "l1", type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, checkedOutQuantity: 0, returnedQuantity: 0, description: null,
  modelId: "m", assetId: null, bulkAssetId: null, kitId: null, isKitChild: false, parentLineItemId: null,
  model: { name: "SM58" }, asset: null, bulkAsset: null, kit: null, prepStatus: null, prepContainer: null,
  isContainerLineItem: false, isCustomItem: false, subHireId: null, supplier: null, ...over,
}) as LineItem;

const ctx = (over: Partial<JobRowsCtx> = {}): JobRowsCtx => ({
  stage: "pick", containerLabelById: new Map([["c1", "LX-04"]]), categoryOf: (l) => (l.id === "l2" ? "Video" : "Audio"), ...over,
});

describe("warehouse job rows", () => {
  it("To pick groups by category, sorted", () => {
    const s = buildJobSections([li({ id: "l1" }), li({ id: "l2" })], ctx());
    expect(s.map((x) => x.section.title)).toEqual(["Audio", "Video"]);
    expect(s[0].section.count).toBe(1);
  });
  it("Planned → glyph only while not packed (2c plan, shown here)", () => {
    expect(buildJobRow(li({ plannedContainerId: "c1" }), ctx()).glyphs).toEqual([{ key: "plannedCase", tooltip: "Planned → LX-04" }]);
    expect(buildJobRow(li({ plannedContainerId: "c1", prepStatus: "PACKED" }), ctx({ stage: "prepped" })).glyphs).toEqual([]);
  });
  it("Prepped groups by case with Loose last", () => {
    const packed = { prepStatus: "PACKED" as const };
    const s = buildJobSections(
      [li({ id: "a", ...packed }), li({ id: "b", ...packed, units: [{ id: "u", ordinal: 0, assetId: null, bulkAssetId: null, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED", containerId: "c1", asset: null, bulkAsset: null }] })],
      ctx({ stage: "prepped" }),
    );
    expect(s.map((x) => x.section.title)).toEqual(["LX-04", "Loose"]);
  });
  it("a returned line reads Returned, never Prepped (§1.1)", () => {
    const row = buildJobSections([li({ status: "RETURNED", prepStatus: "PACKED" })], ctx({ stage: "returned" }))[0].rows[0];
    expect(row.status?.label).toBe("Returned");
  });
  it("short flag and Find filter", () => {
    const row = buildJobRow(li({}), ctx({ shortById: new Map([["l1", 2]]) }));
    expect(row.flags).toEqual([{ label: "Short 2", tone: "error" }]);
    expect(buildJobSections([li({})], ctx({ query: "zzz" }))).toEqual([]);
  });
  it("an unpacked accessory of a packed parent offers Pack n with parent", () => {
    const acc = li({ id: "acc", childKind: "ACCESSORY", isKitChild: true, quantity: 4, model: { name: "AA battery" }, accessoryInclusion: "DEFAULT" });
    const row = buildJobRow(li({ prepStatus: "PACKED", childLineItems: [acc] }), ctx({ stage: "prepped" }));
    expect(row.children?.[0]).toMatchObject({ kind: "accessory", primary: { label: "Pack 4 with parent" } });
    expect(buildJobRow(li({ childLineItems: [acc] }), ctx()).children?.[0].primary).toBeUndefined();
  });
});
