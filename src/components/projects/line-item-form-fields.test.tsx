// @vitest-environment jsdom
/**
 * Tests for the shared line-item form primitives (issue #883) — the `$`/`%`
 * discount toggle and its percentage-resolution math, previously
 * hand-duplicated across equipment-add-form.tsx and edit-line-item-dialog.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiscountField, resolveDiscountAmount } from "./line-item-form-fields";

describe("resolveDiscountAmount", () => {
  it("passes a $ discount through unchanged", () => {
    expect(resolveDiscountAmount("$", 25, 400)).toBe(25);
  });

  it("resolves a % discount against gross, rounded to the cent", () => {
    expect(resolveDiscountAmount("%", 10, 1000)).toBe(100);
    expect(resolveDiscountAmount("%", 12.5, 33.33)).toBeCloseTo(4.17, 2);
  });

  it("drops a blank/zero/negative discount", () => {
    expect(resolveDiscountAmount("$", undefined, 400)).toBeUndefined();
    expect(resolveDiscountAmount("$", 0, 400)).toBeUndefined();
    expect(resolveDiscountAmount("%", -5, 400)).toBeUndefined();
  });

  it("drops a % discount with no resolvable gross instead of misreading it as dollars", () => {
    expect(resolveDiscountAmount("%", 10, undefined)).toBeUndefined();
  });
});

describe("DiscountField", () => {
  it("toggles between $ and % and calls onModeChange", () => {
    const onModeChange = vi.fn();
    render(
      <DiscountField
        id="discount"
        mode="$"
        onModeChange={onModeChange}
        inputProps={{ value: "10", onChange: () => {} }}
      />,
    );
    expect(screen.getByText("$")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Switch to percentage"));
    expect(onModeChange).toHaveBeenCalledWith("%");
  });

  it("disables both the input and the toggle when disabled", () => {
    render(
      <DiscountField
        id="discount"
        mode="$"
        onModeChange={() => {}}
        disabled
        inputProps={{ value: "", onChange: () => {} }}
      />,
    );
    expect((screen.getByLabelText("Discount") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTitle("Switch to percentage") as HTMLButtonElement).disabled).toBe(true);
  });
});
