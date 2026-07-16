// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// Force the mobile branch — LineItemRow self-branches to a card when useIsMobile()
// is true (below the md breakpoint).
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));

// The row carries three live Convex subscriptions (lock / review-marker /
// comment-counts). Stub the hook so the card renders without a Convex client.
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));

// setReviewMarker is now a browser-direct Convex write behind useCollaborationWrites
// (uses useMutation) — stub the hook so the card renders without a Convex client.
vi.mock("@/hooks/use-collaboration-writes", () => ({
  useCollaborationWrites: () => ({ setReviewMarker: vi.fn(async () => {}) }),
}));

// LineAssetsIndicator's history popover imports a warehouse server action.
vi.mock("@/server/warehouse", () => ({ getScanLog: vi.fn(async () => ({ logs: [] })) }));

import { LineItemRow, type LineItemData } from "../equipment-rows";

const baseItem: LineItemData = {
  id: "li1",
  modelId: "m1",
  description: null,
  quantity: 2,
  unitPrice: 100,
  lineTotal: 200,
  model: { name: "Shure QLXD Receiver" },
};

function renderRow(overrides: Partial<React.ComponentProps<typeof LineItemRow>> = {}) {
  const onSelectChange = vi.fn();
  const onEdit = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <div>
      <LineItemRow
        item={baseItem}
        indent=""
        selectable
        isSelected={false}
        onSelectChange={onSelectChange}
        onEdit={onEdit}
        onMoveToCategory={vi.fn()}
        onMoveToGroup={vi.fn()}
        onRemove={onRemove}
        {...overrides}
      />
    </div>,
  );
  return { ...utils, onSelectChange, onEdit, onRemove };
}

describe("equipment mobile line-item card (smoke)", () => {
  it("renders the line item as a card (no <table>) showing name and metrics", () => {
    const { container } = renderRow();
    expect(screen.getByText("Shure QLXD Receiver")).toBeTruthy();
    // Card layout, not a data-table row.
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("tr")).toBeNull();
    // Compact metric line reflects the quantity.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("tapping the card body toggles selection (shiftKey forwarded)", () => {
    const { onSelectChange } = renderRow();
    // The body is a select button; the leading checkbox is a separate control.
    const body = screen.getByRole("button", { name: /Shure QLXD Receiver/i });
    fireEvent.mouseDown(body, { shiftKey: false });
    fireEvent.click(body);
    expect(onSelectChange).toHaveBeenCalledWith(true, false);
  });

  it("the leading checkbox selects the item", () => {
    const { onSelectChange } = renderRow();
    const checkbox = screen.getByLabelText("Select item");
    fireEvent.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledWith(true, expect.any(Boolean));
  });

  it("the kebab menu opens and exposes edit / delete actions", async () => {
    const { onEdit } = renderRow();
    // Radix DropdownMenu opens on keyboard/pointer events, not a bare click.
    fireEvent.keyDown(screen.getByRole("button", { name: "Item actions" }), { key: "Enter" });
    const editItem = await waitFor(() => screen.getByText("Edit"));
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.getByText("Move to category")).toBeTruthy();
    fireEvent.click(editItem);
    expect(onEdit).toHaveBeenCalled();
  });

  it("child rows (non-selectable) render as a plain card body, not a select button", () => {
    renderRow({ selectable: false });
    // With no selectable flag there is no 'Select item' checkbox and the body is
    // not a select button.
    expect(screen.queryByLabelText("Select item")).toBeNull();
    expect(screen.queryByRole("button", { name: /Shure QLXD Receiver/i })).toBeNull();
    expect(screen.getByText("Shure QLXD Receiver")).toBeTruthy();
  });
});
