// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PullSheetData } from "@/components/warehouse/pull-sheet-document";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

const sheet: PullSheetData = {
  project: { id: "p1", projectNumber: "2341", name: "Gala", status: "CONFIRMED", clientName: "Acme", rentalStartDate: null, rentalEndDate: null, loadInDate: null },
  groups: [{
    name: "Audio",
    rows: [
      { id: "l1", name: "Shure SM58", quantity: 3, tag: "", location: "A-01", kind: "item", supplier: null, short: "self", children: [] },
      { id: "k1", name: "Rack", quantity: 1, tag: "K-1", location: "", kind: "kit", supplier: null, short: null,
        children: [{ id: "c1", name: "Amp", quantity: 1, tag: "SK-9", location: "B-02", kind: "member", supplier: null, short: null, children: [] }] },
    ],
  }],
};

vi.mock("@/server/warehouse", () => ({ getProjectPullSheet: vi.fn(async () => sheet) }));

import { PullSheetDialog } from "@/components/warehouse/pull-sheet-dialog";

describe("PullSheetDialog", () => {
  it("opens with the sheet, its rows and their shelves; Print and Save PDF act", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const onClose = vi.fn();
    render(<PullSheetDialog projectIds={["p1"]} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog");
    const doc = await within(dialog).findByRole("article", { name: "Pull sheet #2341" });
    expect(within(doc).getByText("Shure SM58")).toBeTruthy();
    expect(within(doc).getByText("short")).toBeTruthy();
    expect(within(doc).getByText("[Kit] Rack")).toBeTruthy();
    expect(within(doc).getByText("B-02")).toBeTruthy();
    expect(within(doc).getByText(/2 lines · 4 items/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /Print/ }));
    expect(print).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: /Save PDF/ }));
    expect(open).toHaveBeenCalledWith("/api/documents/p1?type=pull-slip", "_blank");
  });

  it("is closed with no jobs", () => {
    render(<PullSheetDialog projectIds={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
