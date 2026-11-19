/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReturnCheckDialog } from "../return-check-dialog";
import { BinCountDialog, validBinCount } from "../bin-count-dialog";

describe("ReturnCheckDialog (opened)", () => {
  it("returns Good with no notes, and carries notes for a bad condition", () => {
    const onConfirm = vi.fn();
    render(<ReturnCheckDialog count={3} initial={{ condition: "GOOD", notes: "" }} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByText(/3 selected items/)).toBeTruthy();
    expect(screen.queryByLabelText(/Notes about damage/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ condition: "GOOD", notes: "" });

    fireEvent.click(screen.getByRole("radio", { name: "Damaged" }));
    fireEvent.change(screen.getByLabelText(/Notes about damage/), { target: { value: "dented" } });
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ condition: "DAMAGED", notes: "dented" });
  });
  it("scan-default mode only saves the condition (no item count)", () => {
    const onConfirm = vi.fn();
    render(<ReturnCheckDialog count={0} scanDefault initial={{ condition: "MISSING", notes: "n" }} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByText("Scans save as")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledWith({ condition: "MISSING", notes: "n" });
  });
});

describe("BinCountDialog (opened)", () => {
  it("defaults to the waiting count, rejects out-of-range counts and confirms a valid one", () => {
    const onConfirm = vi.fn();
    render(<BinCountDialog name="XLR" remaining={12} onConfirm={onConfirm} onCancel={() => {}} />);
    const input = screen.getByLabelText("Count") as HTMLInputElement;
    expect(input.value).toBe("12");
    fireEvent.change(input, { target: { value: "13" } });
    expect((screen.getByRole("button", { name: /De-prep/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /De-prep/ }));
    expect(onConfirm).toHaveBeenCalledWith(4);
  });
  it("validBinCount takes whole numbers 1..remaining only", () => {
    expect([validBinCount("0", 5), validBinCount("2.5", 5), validBinCount("5", 5), validBinCount("", 5)]).toEqual([null, null, 5, null]);
  });
});
