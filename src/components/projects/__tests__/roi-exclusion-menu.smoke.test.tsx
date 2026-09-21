// @vitest-environment jsdom
//
// Revenue-allocation opt-out, UI surface (#1249). Per CLAUDE.md's dropdown rule
// these tests actually OPEN the menu rather than asserting on a closed trigger —
// the entry under test only exists inside `DropdownMenuContent`.
//
// What's covered: both directions of the toggle, the `canExcludeFromRoi` gating
// that keeps the menu honest (it must never offer a switch the allocator
// ignores), and the "Reporting" heading that separates it from the
// client-document toggles it sits beside.
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

const baseItem: LineItemData = {
  id: "li1",
  modelId: "m1",
  description: null,
  quantity: 2,
  unitPrice: 100,
  lineTotal: 200,
  model: { name: "LED Par RGBW" },
};

/** Radix's DropdownMenuTrigger opens on pointerdown, which jsdom's
 *  `fireEvent.click` doesn't synthesise — keyboard activation is the reliable
 *  path (same helper shape category-price-rollup-menu.smoke.test.tsx uses). */
async function openKebab(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
}

function renderItem(overrides: Partial<React.ComponentProps<typeof LineItemRow>> = {}) {
  const onToggleRoiExclusion = vi.fn();
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
          onToggleRoiExclusion={onToggleRoiExclusion}
          {...overrides}
        />
      </tbody>
    </table>,
  );
  return { ...utils, onToggleRoiExclusion };
}

describe("ROI exclusion toggle (smoke)", () => {
  it("offers the opt-out on an ordinary gear row", async () => {
    const { container, onToggleRoiExclusion } = renderItem();
    await openKebab(container);
    fireEvent.click(screen.getByText("Exclude from ROI"));
    expect(onToggleRoiExclusion).toHaveBeenCalled();
  });

  it("offers the way back on an already-excluded row", async () => {
    const { container } = renderItem({ item: { ...baseItem, excludeFromRoi: true } });
    await openKebab(container);
    expect(screen.getByText("Include in ROI")).toBeTruthy();
    expect(screen.queryByText("Exclude from ROI")).toBeNull();
  });

  it("hides the entry entirely when no handler is supplied", async () => {
    const { container } = render(
      <table>
        <tbody>
          <LineItemRow
            item={baseItem}
            indent=""
            onEdit={vi.fn()}
            onMoveToCategory={vi.fn()}
            onMoveToGroup={vi.fn()}
            onRemove={vi.fn()}
          />
        </tbody>
      </table>,
    );
    await openKebab(container);
    expect(screen.queryByText("Exclude from ROI")).toBeNull();
    // The rest of the row menu is untouched.
    expect(screen.getByText("Move to group")).toBeTruthy();
  });

  // Every case below is ALREADY excluded by a structural rule in
  // convex/lib/allocation.ts, so the toggle would be a switch that does nothing.
  // src/lib/roi.ts `canExcludeFromRoi` is the shared rule.
  it("never offers it on a line with no model — nothing to attribute revenue to", async () => {
    const { container } = renderItem({ item: { ...baseItem, modelId: null } });
    await openKebab(container);
    expect(screen.queryByText("Exclude from ROI")).toBeNull();
  });

  it("never offers it on a SALE line — a disposal, never rental ROI", async () => {
    const { container } = renderItem({ item: { ...baseItem, type: "SALE" } });
    await openKebab(container);
    expect(screen.queryByText("Exclude from ROI")).toBeNull();
  });

  it("never offers it on a sub-hire line — never our capital", async () => {
    const { container } = renderItem({ item: { ...baseItem, subHireId: "sh1" } });
    await openKebab(container);
    expect(screen.queryByText("Exclude from ROI")).toBeNull();
  });

  it("never offers it on a custom item", async () => {
    const { container } = renderItem({ item: { ...baseItem, isCustomItem: true } });
    await openKebab(container);
    expect(screen.queryByText("Exclude from ROI")).toBeNull();
  });
});

describe("the Reporting section (smoke)", () => {
  // It changes nothing a client ever sees, so filing it under "Client
  // documents" — the heading the price-reveal and disclosure toggles share —
  // would say the opposite of what it does.
  it("heads the opt-out, and never files it under Client documents", async () => {
    const { container } = renderItem();
    await openKebab(container);
    expect(screen.getByText("Reporting")).toBeTruthy();
    expect(screen.queryByText("Client documents")).toBeNull();
  });

  it("keeps both headings, once each, when the row carries both kinds of toggle", async () => {
    const { container } = renderItem({
      inProjectGroup: true,
      onToggleGroupDisclosure: vi.fn(),
    });
    await openKebab(container);
    expect(screen.getAllByText("Client documents")).toHaveLength(1);
    expect(screen.getAllByText("Reporting")).toHaveLength(1);
    expect(screen.getByText("Show this item")).toBeTruthy();
    expect(screen.getByText("Exclude from ROI")).toBeTruthy();
  });
});
