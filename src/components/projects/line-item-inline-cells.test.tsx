// @vitest-environment jsdom
/**
 * Smoke tests for the inline (click-to-edit, save-on-blur) equipment-table
 * cells — proves the click → type → blur/Enter save contract, Escape's
 * revert-without-saving, and the discount $/% toggle's resolution, without
 * needing the full `LineItemRow`/`equipment-tab` wiring.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConvexError } from "convex/values";
import {
  InlineEditableText,
  InlineEditablePrice,
  InlineEditableDiscount,
  InlineEditableQuantity,
} from "./line-item-inline-cells";

describe("InlineEditableText", () => {
  it("click to edit, blur saves the trimmed value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditableText value="Old name" ariaLabel="Description" onSave={onSave} />);

    fireEvent.click(screen.getByText("Old name"));
    const input = screen.getByLabelText("Description") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  New name  " } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("New name");
  });

  it("Enter commits a single-line field (blurs, which triggers save)", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditableText value="A" ariaLabel="Description" onSave={onSave} />);

    fireEvent.click(screen.getByText("A"));
    const input = screen.getByLabelText("Description") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledWith("B");
  });

  it("Escape reverts without saving", () => {
    const onSave = vi.fn();
    render(<InlineEditableText value="Keep me" ariaLabel="Notes" onSave={onSave} />);

    fireEvent.click(screen.getByText("Keep me"));
    const input = screen.getByLabelText("Notes") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Keep me")).toBeTruthy();
  });

  it("a no-op edit (unchanged value) never calls onSave", () => {
    const onSave = vi.fn();
    render(<InlineEditableText value="Same" ariaLabel="Description" onSave={onSave} />);

    fireEvent.click(screen.getByText("Same"));
    const input = screen.getByLabelText("Description") as HTMLInputElement;
    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("InlineEditablePrice", () => {
  it("displays via formatCurrency and saves a coerced number on blur", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditablePrice value={100} onSave={onSave} />);

    expect(screen.getByText("$100.00")).toBeTruthy();
    fireEvent.click(screen.getByText("$100.00"));
    const input = screen.getByLabelText("Unit price") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "150.5" } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith(150.5);
  });

  it("an emptied field saves undefined (clears the price)", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditablePrice value={100} onSave={onSave} />);

    fireEvent.click(screen.getByText("$100.00"));
    const input = screen.getByLabelText("Unit price") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith(undefined);
  });
});

describe("InlineEditableDiscount", () => {
  it("shows a hover '+ Discount' affordance when there's no discount, and saves a $ amount", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditableDiscount discount={null} discountMode={null} gross={1000} onSave={onSave} />);

    fireEvent.click(screen.getByText("+ Discount"));
    const input = screen.getByLabelText("Discount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(screen.getByLabelText("Discount mode").parentElement as HTMLElement);

    expect(onSave).toHaveBeenCalledWith(50, "$");
  });

  it("resolves a % entry against gross before saving", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditableDiscount discount={null} discountMode={null} gross={1000} onSave={onSave} />);

    fireEvent.click(screen.getByText("+ Discount"));
    fireEvent.click(screen.getByLabelText("Discount mode")); // $ -> %
    const input = screen.getByLabelText("Discount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(screen.getByLabelText("Discount mode").parentElement as HTMLElement);

    expect(onSave).toHaveBeenCalledWith(100, "%");
  });

  it("re-seeds the input from the stored mode when reopened, and displays the resolved $ amount", () => {
    const onSave = vi.fn();
    render(<InlineEditableDiscount discount={150} discountMode="%" gross={1000} onSave={onSave} />);

    expect(screen.getByText("-$150.00 disc.")).toBeTruthy();
    fireEvent.click(screen.getByText("-$150.00 disc."));
    expect((screen.getByLabelText("Discount") as HTMLInputElement).value).toBe("15");
    expect(screen.getByLabelText("Discount mode").textContent).toBe("%");
  });
});

describe("InlineEditableQuantity", () => {
  it("click to edit, blur saves the parsed quantity with allowOverbook: false", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditableQuantity value={2} onSave={onSave} />);

    fireEvent.click(screen.getByText("2"));
    const input = screen.getByLabelText("Quantity") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith(5, false);
  });

  it("a no-op edit (unchanged value) never calls onSave", () => {
    const onSave = vi.fn();
    render(<InlineEditableQuantity value={3} onSave={onSave} />);

    fireEvent.click(screen.getByText("3"));
    fireEvent.blur(screen.getByLabelText("Quantity"));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("garbage input (< 1) reverts silently without saving", () => {
    const onSave = vi.fn();
    render(<InlineEditableQuantity value={3} onSave={onSave} />);

    fireEvent.click(screen.getByText("3"));
    const input = screen.getByLabelText("Quantity") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("INSUFFICIENT_STOCK shows an inline overbook-confirm step; confirming retries with allowOverbook: true", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new ConvexError({ code: "INSUFFICIENT_STOCK", message: "Only 3 of 5 requested are free during those dates." }),
      )
      .mockResolvedValueOnce(undefined);

    render(<InlineEditableQuantity value={2} onSave={onSave} />);

    fireEvent.click(screen.getByText("2"));
    const input = screen.getByLabelText("Quantity") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    expect(await screen.findByText("Only 3 of 5 requested are free during those dates.")).toBeTruthy();
    expect(onSave).toHaveBeenNthCalledWith(1, 5, false);

    fireEvent.click(screen.getByText("Overbook anyway"));

    expect(onSave).toHaveBeenNthCalledWith(2, 5, true);
  });

  it("Cancel on the overbook prompt reverts without a retry", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new ConvexError({ code: "INSUFFICIENT_STOCK", message: "Not enough stock." }));

    render(<InlineEditableQuantity value={2} onSave={onSave} />);

    fireEvent.click(screen.getByText("2"));
    const input = screen.getByLabelText("Quantity") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    await screen.findByText("Not enough stock.");
    fireEvent.click(screen.getByText("Cancel"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("a non-overbook error reverts silently (no confirm step)", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Not ready — try again in a moment."));

    render(<InlineEditableQuantity value={2} onSave={onSave} />);

    fireEvent.click(screen.getByText("2"));
    const input = screen.getByLabelText("Quantity") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    // Flush the rejected promise before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText("Overbook anyway")).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
