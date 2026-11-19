// @vitest-environment jsdom
//
// "Convert to custom item" — Equipment-tab surface (FEATUREDOCS/12). Opens the real
// kebab (per CLAUDE.md: test menus by OPENING them) and clicks the real entries.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));
vi.mock("@/hooks/use-collaboration-writes", () => ({
  useCollaborationWrites: () => ({ setReviewMarker: vi.fn(async () => {}) }),
}));
vi.mock("@/server/warehouse", () => ({ getScanLog: vi.fn(async () => ({ logs: [] })) }));

import { LineItemRow, type LineItemData } from "../equipment-rows";
import { CustomUnitProvider, type CustomUnitContextValue } from "../custom-unit-context";

const baseItem: LineItemData = {
  id: "li1",
  modelId: "m1",
  description: null,
  quantity: 3,
  unitPrice: 100,
  lineTotal: 300,
  model: { name: "4099" },
  units: [],
};
const over = { overBy: 1, totalStock: 2, effectiveStock: 2, totalBooked: 3 };

async function openKebab(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
}

function renderItem(over_: Partial<React.ComponentProps<typeof LineItemRow>>, ctx: CustomUnitContextValue | null) {
  const row = (
    <table>
      <tbody>
        <LineItemRow
          item={baseItem}
          indent=""
          onEdit={vi.fn()}
          onMoveToCategory={vi.fn()}
          onMoveToGroup={vi.fn()}
          onRemove={vi.fn()}
          {...over_}
        />
      </tbody>
    </table>
  );
  return render(ctx ? <CustomUnitProvider value={ctx}>{row}</CustomUnitProvider> : row);
}

const ctx = (): CustomUnitContextValue => ({ convert: vi.fn(), convertBack: vi.fn(), pendingLineIds: new Set() });

describe("Convert to custom item (Equipment tab, smoke)", () => {
  it("offers 'Convert 1 to custom item' on an overbooked line and calls convert with the line id", async () => {
    const c = ctx();
    const { container } = renderItem({ overbookedInfo: over }, c);
    await openKebab(container);
    fireEvent.click(screen.getByText("Convert 1 to custom item"));
    expect(c.convert).toHaveBeenCalledWith("li1");
  });

  it("does not offer it when the line is not overbooked", async () => {
    const { container } = renderItem({}, ctx());
    await openKebab(container);
    expect(screen.queryByText("Convert 1 to custom item")).toBeNull();
  });

  it("does not offer it without a provider (read-only consumers)", async () => {
    const { container } = renderItem({ overbookedInfo: over }, null);
    await openKebab(container);
    expect(screen.queryByText("Convert 1 to custom item")).toBeNull();
  });

  it("shows the custom count and offers the way back for a line with a custom unit", async () => {
    const c = ctx();
    const item: LineItemData = {
      ...baseItem,
      offInventoryQuantity: 1,
      units: [{ id: "u1", ordinal: 1, quantity: 1, status: "CONFIRMED", asset: null, bulkAsset: null }],
    };
    const { container } = renderItem({ item }, c);
    expect(screen.getByText("1 custom")).toBeTruthy();
    await openKebab(container);
    fireEvent.click(screen.getByText("Convert 1 back to inventory"));
    expect(c.convertBack).toHaveBeenCalledWith("li1");
  });
});
