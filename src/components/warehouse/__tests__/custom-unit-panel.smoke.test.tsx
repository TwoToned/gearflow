// @vitest-environment jsdom
//
// "Prep as custom item" — warehouse surface (FEATUREDOCS/12). Renders the real panel
// and clicks the real buttons; the offer logic itself is unit-tested in
// src/lib/off-inventory.test.ts.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CustomUnitPanel, type CustomUnitPanelLine } from "../custom-unit-panel";

const over = { overBy: 1, totalStock: 2, effectiveStock: 2, totalBooked: 3 };
const line = (o: Partial<CustomUnitPanelLine> = {}): CustomUnitPanelLine => ({
  id: "L1", type: "EQUIPMENT", status: "CONFIRMED", modelId: "mdl", quantity: 3,
  isKitChild: false, kitId: null, subHireId: null, model: { name: "4099", assetType: "SERIALIZED" },
  units: [], offInventoryQuantity: 0, ...o,
});
const noPending = new Set<string>();

describe("CustomUnitPanel", () => {
  it("renders nothing when no line qualifies", () => {
    const { container } = render(
      <CustomUnitPanel lines={[line()]} overbookedMap={{}} pendingLineIds={noPending} onConvert={vi.fn()} onConvertBack={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("offers 'Prep as custom item' on an overbooked line and calls onConvert with the line id", () => {
    const onConvert = vi.fn();
    render(<CustomUnitPanel lines={[line()]} overbookedMap={{ L1: over }} pendingLineIds={noPending} onConvert={onConvert} onConvertBack={vi.fn()} />);
    expect(screen.getByText("4099")).toBeTruthy();
    expect(screen.getByText("1 over capacity")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /prep as custom item/i }));
    expect(onConvert).toHaveBeenCalledWith("L1");
  });

  it("shows the custom count and 'Convert back' for a line with a custom unit", () => {
    const onConvertBack = vi.fn();
    const l = line({ offInventoryQuantity: 1, units: [{ quantity: 1, status: "CONFIRMED", assetId: null, bulkAssetId: null }] });
    render(<CustomUnitPanel lines={[l]} overbookedMap={{}} pendingLineIds={noPending} onConvert={vi.fn()} onConvertBack={onConvertBack} />);
    expect(screen.getByText("1 custom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /convert back/i }));
    expect(onConvertBack).toHaveBeenCalledWith("L1");
  });

  it("disables the row's buttons while its call is in flight", () => {
    render(<CustomUnitPanel lines={[line()]} overbookedMap={{ L1: over }} pendingLineIds={new Set(["L1"])} onConvert={vi.fn()} onConvertBack={vi.fn()} />);
    expect((screen.getByRole("button", { name: /prep as custom item/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
