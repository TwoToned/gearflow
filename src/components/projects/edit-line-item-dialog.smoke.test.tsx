// @vitest-environment jsdom
/**
 * Smoke test for EditLineItemDialog — renders the dialog and covers the
 * isOptional regression from GitHub issue #883: the dialog previously had no
 * isOptional field at all, so `onSubmit`'s payload never carried it and
 * `lineItemSchema`'s `isOptional` default (false) silently reset every
 * optional item back to non-optional on save. The dialog now seeds the
 * checkbox from the item and includes the (possibly toggled) value in the
 * payload it hands to `onSubmit`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-collaboration", () => ({
  useEditLock: () => ({ lockState: null, isLocked: false, isStale: false, takeover: vi.fn() }),
}));

import { EditLineItemDialog } from "./edit-line-item-dialog";
import type { LineItemData } from "./equipment-rows";

const baseItem: LineItemData = {
  id: "li1",
  description: "Custom cable run",
  quantity: 2,
  unitPrice: 100,
  lineTotal: 190,
  discount: 10,
  isOptional: true,
  notes: "note",
};

describe("EditLineItemDialog", () => {
  it("renders and seeds the Optional checkbox from the item", () => {
    render(
      <EditLineItemDialog
        item={baseItem}
        projectId="p1"
        isPending={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Edit Item")).toBeTruthy();
    const optional = screen.getByLabelText(/Optional item/i);
    expect(optional.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps isOptional true on save when left untouched", () => {
    const onSubmit = vi.fn();
    render(
      <EditLineItemDialog
        item={baseItem}
        projectId="p1"
        isPending={false}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][1];
    expect(payload.isOptional).toBe(true);
  });

  it("sends isOptional: false after unchecking it", () => {
    const onSubmit = vi.fn();
    render(
      <EditLineItemDialog
        item={baseItem}
        projectId="p1"
        isPending={false}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Optional item/i));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const payload = onSubmit.mock.calls[0][1];
    expect(payload.isOptional).toBe(false);
  });

  it("resolves a % discount against unitPrice x quantity x duration", () => {
    const onSubmit = vi.fn();
    render(
      <EditLineItemDialog
        item={{ ...baseItem, discount: undefined, duration: 2 }}
        projectId="p1"
        isPending={false}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    // Switch the discount toggle to "%" then enter 10.
    fireEvent.click(screen.getByTitle("Switch to percentage"));
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const payload = onSubmit.mock.calls[0][1];
    // gross = 100 (unitPrice) x 2 (qty) x 2 (duration) = 400; 10% = 40.
    expect(payload.discount).toBe(40);
  });
});
