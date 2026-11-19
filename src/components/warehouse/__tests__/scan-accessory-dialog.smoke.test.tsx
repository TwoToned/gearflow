/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScanAccessoryDialog } from "../scan-prep-dialogs";

const options = [{ id: "c1", name: "Antenna", optional: false, assetIds: ["x1"] }, { id: "c2", name: "Clip", optional: true, assetIds: ["x2"] }];

describe("ScanAccessoryDialog (opened) — Remember for the next n (D10)", () => {
  it("offers the memory when more units are to pick, and reports it with the decision", () => {
    const onDecide = vi.fn();
    render(<ScanAccessoryDialog prompt={{ parentName: "Beltpack", parentPrepped: false, options, rememberCount: 5 }} onDecide={onDecide} onDiscard={() => {}} />);
    fireEvent.click(screen.getByLabelText("Remember for the next 5"));
    fireEvent.click(screen.getByRole("button", { name: /Prep with 2 accessories/ }));
    expect(onDecide).toHaveBeenLastCalledWith({ kind: "with", accessoryIds: undefined }, true);
  });
  it("without ticking it, the decision is not remembered", () => {
    const onDecide = vi.fn();
    render(<ScanAccessoryDialog prompt={{ parentName: "Beltpack", parentPrepped: false, options, rememberCount: 2 }} onDecide={onDecide} onDiscard={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Prep without accessories" }));
    expect(onDecide).toHaveBeenLastCalledWith({ kind: "without" }, false);
  });
  it("is not offered for the last unit, nor for an accessories-only prep", () => {
    const { unmount } = render(<ScanAccessoryDialog prompt={{ parentName: "Beltpack", parentPrepped: false, options, rememberCount: 0 }} onDecide={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByText(/Remember for the next/)).toBeNull();
    unmount();
    render(<ScanAccessoryDialog prompt={{ parentName: "Beltpack", parentPrepped: true, options, rememberCount: 4 }} onDecide={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByText(/Remember for the next/)).toBeNull();
  });
});
