// @vitest-environment jsdom
/**
 * Accessories have ONE editor (spec §7.2): the Edit Item dialog only offers a
 * button that hands the line to `EditAccessoryPlanDialog`, which is opened here
 * for real and saved through the line-item writes.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ModelAccessoryDetail } from "@/server/line-items";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const ACCESSORIES: ModelAccessoryDetail[] = [
  { id: "row-default", bulkAssetId: "ba-default", quantity: 1, inclusion: "DEFAULT", assetTag: "BA-DEF", modelName: "XLR Cable" },
  { id: "row-optional", bulkAssetId: "ba-optional", quantity: 1, inclusion: "OPTIONAL", assetTag: "BA-OPT", modelName: "Flight Case" },
];
const PLAN = { excluded: [], added: [{ bulkAssetId: "ba-optional" }], excludedReasons: [] };
const updateAccessoryPlan = vi.fn(() => Promise.resolve());

vi.mock("../use-accessory-plan-editor", () => ({
  useAccessoryPlanEditor: () => ({
    accessories: ACCESSORIES,
    selection: { "row-default": true, "row-optional": true },
    excludeReasons: {},
    custom: [],
    planToSave: PLAN,
    isDirty: true,
    loaded: true,
    setSelection: () => {},
    setExcludeReasons: () => {},
    setCustom: () => {},
  }),
}));
vi.mock("@/hooks/use-line-item-writes", () => ({
  useLineItemWrites: () => ({ enabled: true, updateAccessoryPlan }),
}));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: (o: { mutationFn: () => Promise<unknown>; onSuccess?: () => void }) => ({
    isPending: false,
    mutate: () => void o.mutationFn().then(() => o.onSuccess?.()),
  }),
}));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroLinked: () => false }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));

import { EditLineItemDialog } from "../edit-line-item-dialog";
import { EditAccessoryPlanDialog } from "../edit-accessory-plan-dialog";
import type { LineItemData } from "../equipment-rows";

const ITEM = {
  id: "li1",
  description: "Shure SM58",
  quantity: 1,
  unitPrice: 25,
  modelId: "m1",
} as unknown as LineItemData;

function renderEdit(overrides: Partial<React.ComponentProps<typeof EditLineItemDialog>> = {}) {
  const onEditAccessories = vi.fn();
  render(
    <EditLineItemDialog
      item={ITEM}
      projectId="p1"
      isPending={false}
      onClose={() => {}}
      onSubmit={() => Promise.resolve()}
      onEditAccessories={onEditAccessories}
      {...overrides}
    />,
  );
  return { onEditAccessories };
}

describe("Edit Item dialog hands accessories to the one editor", () => {
  it("offers a button that calls onEditAccessories with the line", () => {
    const { onEditAccessories } = renderEdit();
    fireEvent.click(screen.getByRole("button", { name: /edit accessories/i }));
    expect(onEditAccessories).toHaveBeenCalledWith(ITEM);
    // No inline picker any more.
    expect(screen.queryByText("XLR Cable")).toBeNull();
  });

  it("hides the row for a kit child and when no handler is wired", () => {
    renderEdit({ item: { ...ITEM, isKitChild: true } as LineItemData });
    expect(screen.queryByRole("button", { name: /edit accessories/i })).toBeNull();
  });

  it("hides the row when the parent wires no handler", () => {
    renderEdit({ onEditAccessories: undefined });
    expect(screen.queryByRole("button", { name: /edit accessories/i })).toBeNull();
  });
});

describe("EditAccessoryPlanDialog", () => {
  it("opens with the picker and saves the derived plan", async () => {
    const onClose = vi.fn();
    render(<EditAccessoryPlanDialog item={ITEM} onClose={onClose} />);
    expect(screen.getByText("Edit accessories")).toBeTruthy();
    expect(screen.getByText("XLR Cable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateAccessoryPlan).toHaveBeenCalledWith("li1", PLAN));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
