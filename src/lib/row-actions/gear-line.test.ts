import { describe, it, expect, vi } from "vitest";

import { ACTION_GROUPS } from "@/lib/primitives/types";
import { buildGearLineActions, type GearLineActionCtx, type GearLineActionRow } from "./gear-line";

const row: GearLineActionRow = { title: "Moving head", modelId: "m1", status: "CONFIRMED" };
const all: GearLineActionCtx = {
  onEdit: vi.fn(), onMoveToCategory: vi.fn(), onMoveToGroup: vi.fn(), onEditAccessories: vi.fn(),
  onMarker: vi.fn(), onReportIssue: vi.fn(), onToggleRoiExclusion: vi.fn(), onRemove: vi.fn(),
};
const keys = (r: GearLineActionRow, c: GearLineActionCtx) => buildGearLineActions(r, c).items.map((i) => i.key);

describe("buildGearLineActions", () => {
  it("has no `disabled` field on any item: inapplicable actions are absent", () => {
    for (const item of buildGearLineActions(row, all).items) expect("disabled" in item).toBe(false);
  });

  it("omits an action whose handler the caller cannot provide", () => {
    expect(keys(row, { onEdit: all.onEdit })).toEqual(["edit"]);
    expect(keys(row, {})).toEqual([]);
  });

  it("offers Report issue only while the line is CHECKED_OUT", () => {
    expect(keys(row, all)).not.toContain("report-issue");
    expect(keys({ ...row, status: "CHECKED_OUT" }, all)).toContain("report-issue");
  });

  it("offers Resolve marker only with an open marker", () => {
    expect(keys(row, all)).not.toContain("resolve-marker");
    expect(keys({ ...row, hasOpenMarker: true }, all)).toContain("resolve-marker");
  });

  it("applies the shared rollup / disclosure / ROI rules", () => {
    const doc = { ...all, onTogglePriceReveal: vi.fn(), onToggleGroupDisclosure: vi.fn() };
    expect(keys(row, doc)).not.toContain("price-reveal");
    expect(keys(row, { ...doc, inRollupCategory: true })).toContain("price-reveal");
    expect(keys(row, { ...doc, inRollupCategory: true, inProjectGroup: true })).not.toContain("price-reveal");
    expect(keys(row, { ...doc, inProjectGroup: true })).toContain("group-disclosure");
    expect(keys({ ...row, kitId: "k" }, { ...doc, inProjectGroup: true })).not.toContain("group-disclosure");
    expect(keys({ ...row, modelId: null }, all)).not.toContain("roi");
    expect(keys(row, all)).toContain("roi");
  });

  it("flips labels from the row's current state", () => {
    const ctx = { ...all, inRollupCategory: true, onTogglePriceReveal: vi.fn() };
    const label = (r: GearLineActionRow) => buildGearLineActions(r, ctx).items.find((i) => i.key === "price-reveal")!.label;
    expect(label(row)).toBe("Show this price");
    expect(label({ ...row, revealPriceInRollup: true })).toBe("Hide this price");
  });

  it("puts Delete last, red, with a confirm, and keeps E / M / D", () => {
    const { items } = buildGearLineActions(row, all);
    const del = items[items.length - 1];
    expect(del).toMatchObject({ key: "delete", danger: true, kbd: "D", group: "danger" });
    expect(del.confirm?.confirmLabel).toBeTruthy();
    expect(items.find((i) => i.key === "edit")?.kbd).toBe("E");
    expect(items.find((i) => i.key === "move-category")?.kbd).toBe("M");
  });

  it("emits only known groups and places caller extraItems in order", () => {
    const extra = { key: "custom-unit", label: "Prep as custom item", group: "organise" as const, onSelect: vi.fn() };
    const { items } = buildGearLineActions(row, { ...all, extraItems: [extra] });
    for (const i of items) expect(ACTION_GROUPS).toContain(i.group);
    expect(items.map((i) => i.key)).toContain("custom-unit");
  });
});
