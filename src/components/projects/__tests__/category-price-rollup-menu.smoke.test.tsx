// @vitest-environment jsdom
//
// Category price rollup, UI surface. Per CLAUDE.md's dropdown rule these tests
// actually OPEN the menus rather than asserting on a closed trigger — the
// entries under test only exist inside `DropdownMenuContent`.
//
// What's covered: the category toggle's two directions, the rollup badge, the
// gating rule that makes the per-row reveal honest — it is offered ONLY inside
// a rolled-up category, because in an itemised one the flag does nothing — and
// the shared "Client documents" section the toggles live under, which is what
// lets their labels stay short.
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

import { CategoryRow, LineItemRow, type CategoryData, type LineItemData } from "../equipment-rows";

const baseCategory: CategoryData = { id: "c1", name: "Lighting", sortOrder: 0, groups: [] };

const baseItem: LineItemData = {
  id: "li1",
  modelId: "m1",
  description: null,
  quantity: 2,
  unitPrice: 100,
  lineTotal: 200,
  model: { name: "LED Par RGBW" },
};

function renderCategory(cat: CategoryData, onSetPricingDisplay = vi.fn()) {
  const utils = render(
    <table>
      <tbody>
        <CategoryRow
          cat={cat}
          columnCount={8}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onSetPricingDisplay={onSetPricingDisplay}
        />
      </tbody>
    </table>,
  );
  return { ...utils, onSetPricingDisplay };
}

/** Radix's DropdownMenuTrigger opens on pointerdown, which jsdom's
 *  `fireEvent.click` doesn't synthesise — keyboard activation is the reliable
 *  path here (same helper shape user-nav.test.tsx uses). */
async function openKebab(container: HTMLElement) {
  // Radix's DropdownMenuTrigger opens on pointerdown, which jsdom's
  // `fireEvent.click` doesn't synthesise — keyboard activation is the reliable
  // path (same approach equipment-row-drag-interaction.test.tsx takes).
  const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
}

describe("category rollup toggle (smoke)", () => {
  it("offers ROLLUP on an itemised category and reports the switch", async () => {
    const { container, onSetPricingDisplay } = renderCategory(baseCategory);
    await openKebab(container);
    fireEvent.click(screen.getByText("Show combined price"));
    expect(onSetPricingDisplay).toHaveBeenCalledWith("ROLLUP");
  });

  it("offers the way back on a rolled-up category", async () => {
    const { container, onSetPricingDisplay } = renderCategory({ ...baseCategory, pricingDisplay: "ROLLUP" });
    await openKebab(container);
    fireEvent.click(screen.getByText("Show individual prices"));
    expect(onSetPricingDisplay).toHaveBeenCalledWith("ITEMISED");
  });

  // The state has to be visible without opening a menu, and labelled rather
  // than colour-only (DESIGN.md §3.3).
  it("badges a rolled-up category, and only a rolled-up one", () => {
    const { unmount } = renderCategory({ ...baseCategory, pricingDisplay: "ROLLUP" });
    expect(screen.getByText("Combined price")).toBeTruthy();
    unmount();

    renderCategory(baseCategory);
    expect(screen.queryByText("Combined price")).toBeNull();
  });

  it("hides the toggle entirely when no handler is supplied", async () => {
    const { container } = render(
      <table>
        <tbody>
          <CategoryRow cat={baseCategory} columnCount={8} onRename={vi.fn()} onDelete={vi.fn()} />
        </tbody>
      </table>,
    );
    await openKebab(container);
    expect(screen.queryByText("Show combined price")).toBeNull();
    // The rest of the menu is untouched.
    expect(screen.getByText("Rename")).toBeTruthy();
  });
});

function renderItem(overrides: Partial<React.ComponentProps<typeof LineItemRow>> = {}) {
  const onTogglePriceReveal = vi.fn();
  const utils = render(
    <table>
      <tbody>
        <LineItemRow
          item={baseItem}
          indent=""
          onEdit={vi.fn()}
          onMoveToCategory={vi.fn()}
          onMoveToGroup={vi.fn()}
          onRemove={vi.fn()}
          onTogglePriceReveal={onTogglePriceReveal}
          {...overrides}
        />
      </tbody>
    </table>,
  );
  return { ...utils, onTogglePriceReveal };
}

describe("per-item price reveal (smoke)", () => {
  it("offers the reveal inside a rolled-up category", async () => {
    const { container, onTogglePriceReveal } = renderItem({ inRollupCategory: true });
    await openKebab(container);
    fireEvent.click(screen.getByText("Show this price"));
    expect(onTogglePriceReveal).toHaveBeenCalled();
  });

  it("offers the way back on an already-revealed row", async () => {
    const { container } = renderItem({
      inRollupCategory: true,
      item: { ...baseItem, revealPriceInRollup: true },
    });
    await openKebab(container);
    expect(screen.getByText("Hide this price")).toBeTruthy();
  });

  // Offering it in an itemised category would imply the flag does something
  // there. It does not — every price already prints.
  it("never offers the reveal in an itemised category", async () => {
    const { container } = renderItem({ inRollupCategory: false });
    await openKebab(container);
    expect(screen.queryByText("Show this price")).toBeNull();
    // The rest of the row menu is untouched.
    expect(screen.getByText("Move to group")).toBeTruthy();
  });
});

describe("group child disclosure (smoke)", () => {
  it("offers the disclosure for a member of a Project Group", async () => {
    const onToggleGroupDisclosure = vi.fn();
    const { container } = renderItem({ inProjectGroup: true, onToggleGroupDisclosure });
    await openKebab(container);
    fireEvent.click(screen.getByText("Show this item"));
    expect(onToggleGroupDisclosure).toHaveBeenCalled();
  });

  it("offers the way back on an already-listed member", async () => {
    const { container } = renderItem({
      inProjectGroup: true,
      onToggleGroupDisclosure: vi.fn(),
      item: { ...baseItem, showInGroupOnDocs: true },
    });
    await openKebab(container);
    expect(screen.getByText("Hide this item")).toBeTruthy();
  });

  // A row that isn't in a group has no collapsed group row to appear under.
  it("never offers the disclosure outside a Project Group", async () => {
    const { container } = renderItem({ inProjectGroup: false, onToggleGroupDisclosure: vi.fn() });
    await openKebab(container);
    expect(screen.queryByText("Show this item")).toBeNull();
  });

  // A kit inside a group is itself a collapsing container, so
  // `disclosedGroupChildren` drops it — offering the toggle would let the
  // operator flip a flag the document ignores.
  it("never offers the disclosure on a kit parent inside a group", async () => {
    const { container } = renderItem({
      inProjectGroup: true,
      onToggleGroupDisclosure: vi.fn(),
      item: { ...baseItem, kitId: "k1", isKitChild: false },
    });
    await openKebab(container);
    expect(screen.queryByText("Show this item")).toBeNull();
    // A plain member in the same position still gets it.
    const plain = renderItem({ inProjectGroup: true, onToggleGroupDisclosure: vi.fn() });
    await openKebab(plain.container);
    expect(screen.getByText("Show this item")).toBeTruthy();
  });
});

// A rolled-up category hides the prices of the rows it PRINTS. A group member,
// a sub-hire group child and a kit child are not printed at all on a
// client-facing document — `structureLineItems` drops them in collapse mode —
// so "show this row's price" has no row to show it on. Offering it anyway is a
// toggle that silently does nothing, which is the bug these three cover.
describe("the price reveal is offered only where a row actually prints", () => {
  it("never offers it to a member of a Project Group", async () => {
    const { container } = renderItem({
      inRollupCategory: true,
      inProjectGroup: true,
      onToggleGroupDisclosure: vi.fn(),
    });
    await openKebab(container);
    expect(screen.queryByText("Show this price")).toBeNull();
    // The control that DOES apply to a group member is still there.
    expect(screen.getByText("Show this item")).toBeTruthy();
  });

  it("never offers it to a sub-hire group child", async () => {
    const { container } = renderItem({
      inRollupCategory: true,
      item: { ...baseItem, subHireGroupId: "shg1", isKitChild: true },
    });
    await openKebab(container);
    expect(screen.queryByText("Show this price")).toBeNull();
  });

  it("never offers it to a kit child", async () => {
    const { container } = renderItem({
      inRollupCategory: true,
      item: { ...baseItem, isKitChild: true },
    });
    await openKebab(container);
    expect(screen.queryByText("Show this price")).toBeNull();
  });
});

// The labels ("Show this price", "Show this item", "Show combined price") are
// deliberately short, which only reads correctly because a heading supplies the
// context. If the heading ever stops rendering, the menu says "Show this item"
// with nothing saying where — so the heading is asserted, not assumed.
describe("the Client documents menu section", () => {
  it("heads the category toggle", async () => {
    const { container } = renderCategory(baseCategory);
    await openKebab(container);
    expect(screen.getByText("Client documents")).toBeTruthy();
  });

  it("heads a row's toggle exactly once", async () => {
    const { container } = renderItem({
      inRollupCategory: true,
      inProjectGroup: true,
      onToggleGroupDisclosure: vi.fn(),
    });
    await openKebab(container);
    expect(screen.getAllByText("Client documents")).toHaveLength(1);
  });

  it("is absent when the row has no client-document toggle to offer", async () => {
    const { container } = renderItem({ inRollupCategory: false, inProjectGroup: false });
    await openKebab(container);
    expect(screen.queryByText("Client documents")).toBeNull();
  });
});
