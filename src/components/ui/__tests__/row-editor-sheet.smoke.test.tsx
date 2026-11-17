// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));

import { RowEditorSheet, convertDiscountEntry, type RowEditorSheetProps } from "@/components/ui/row-editor-sheet";

function open(over: Partial<RowEditorSheetProps> = {}) {
  const onSave = vi.fn();
  render(
    <RowEditorSheet
      open
      onOpenChange={() => {}}
      title="Shure ULXD"
      initial={{ quantity: 2, unitPrice: 100, discount: 20, discountMode: "$" }}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave };
}

describe("RowEditorSheet", () => {
  beforeEach(() => cleanup());

  it("opens with the row's values and the derived total", async () => {
    open();
    expect(await screen.findByLabelText("Quantity")).toBeTruthy();
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("100");
    // 100 x 2 - 20
    expect(screen.getByLabelText("Total").textContent).toBe("$180.00");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("the stepper changes qty, the total follows, Save sends only what changed", async () => {
    const { onSave } = open();
    await userEvent.click(await screen.findByRole("button", { name: "Increase quantity" }));
    expect(screen.getByLabelText("Total").textContent).toBe("$280.00");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ quantity: 3 });
  });

  it("$ / % switch re-expresses the same discount and keeps the dollar amount", async () => {
    open();
    await userEvent.click(await screen.findByRole("radio", { name: "Percent" }));
    // $20 of $200 gross = 10%
    expect((screen.getByLabelText("Discount") as HTMLInputElement).value).toBe("10");
    expect(screen.getByLabelText("Total").textContent).toBe("$180.00");
    expect(convertDiscountEntry("10", "%", "$", 200)).toBe("20");
  });

  it("entering a % discount saves the flat dollar amount with its mode", async () => {
    const { onSave } = open({ initial: { quantity: 1, unitPrice: 200 } });
    await userEvent.click(await screen.findByRole("radio", { name: "Percent" }));
    await userEvent.type(screen.getByLabelText("Discount"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ discount: 30, discountMode: "%" }));
  });

  it("a blank price is blank, never $0: total is a dash and the patch clears with null", async () => {
    const { onSave } = open();
    const price = await screen.findByLabelText("Price");
    await userEvent.clear(price);
    expect(screen.getByLabelText("Total").textContent).toBe("—");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0];
    expect(patch.unitPrice).toBeNull();
    expect(patch.unitPrice).not.toBe(0);
  });

  it("quantity 0 is rejected: Save stays disabled", async () => {
    open();
    const qty = await screen.findByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "0");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the availability notice with the sub-hire shortcut, drill-ins and the row menu", async () => {
    const sub = vi.fn();
    const drill = vi.fn();
    const act = vi.fn();
    open({
      availability: { message: "2 short for these dates", tone: "error", action: { label: "Sub-hire 2", onSelect: sub } },
      drillIns: [{ key: "acc", label: "Accessories", detail: "3", onOpen: drill }],
      menu: { items: [{ key: "dup", label: "Duplicate line", group: "organise", onSelect: act }] },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Sub-hire 2" }));
    expect(sub).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /Accessories/ }));
    expect(drill).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("button", { name: "Duplicate line" }));
    expect(act).toHaveBeenCalledTimes(1);
  });
});
