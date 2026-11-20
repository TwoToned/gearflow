// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/collaboration/comment-thread-panel", () => ({
  CommentThreadPanel: ({ children }: { children: React.ReactNode }) => <div data-testid="thread-trigger">{children}</div>,
}));

import { EquipmentRowEditor } from "./equipment-row-editor";
import type { LineItemData } from "./equipment-row-types";

const ITEM = {
  id: "l1",
  type: "EQUIPMENT",
  modelId: "m1",
  description: "SM58 on stage",
  quantity: 4,
  unitPrice: 50,
  duration: 1,
  discount: 20,
  discountMode: "$",
  model: { name: "SM58" },
  units: [{ id: "u1", status: "PENDING", asset: { id: "a1", assetTag: "MIC-001" } }],
} as unknown as LineItemData;

const comments = { orgId: "o1", projectId: "p1", counts: { l1: { open: 3, total: 3, blockingOpen: 0 } } };

function renderEditor(over: Partial<React.ComponentProps<typeof EquipmentRowEditor>> = {}) {
  const props = {
    target: { item: ITEM, over: { overBy: 2, inherited: false } as never },
    onClose: vi.fn(),
    comments,
    moneyLocked: false,
    onSave: vi.fn(async () => {}),
    onEditDetails: vi.fn(),
    onSubHireShortfall: vi.fn(),
    ...over,
  };
  render(<EquipmentRowEditor {...props} />);
  return props;
}

describe("EquipmentRowEditor (phone row tap)", () => {
  beforeEach(() => cleanup());

  it("opens with qty/price/discount and carries the discussion badge, serial indicator and shortfall shortcut", async () => {
    const p = renderEditor();
    expect(await screen.findByLabelText("Quantity")).toBeTruthy();
    expect((screen.getByLabelText("Discount") as HTMLInputElement).value).toBe("20");
    expect(screen.getByRole("radio", { name: "Dollars" }).getAttribute("aria-checked")).toBe("true");
    // the discussion badge (count) and the serial indicator render in the sheet, not only in desktop cells
    expect(screen.getByRole("button", { name: "3 open comments" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 asset assigned" })).toBeTruthy();
    // availability + sub-hire shortcut closes this sheet and opens the shortfall one
    await userEvent.click(screen.getByRole("button", { name: "Sub-hire shortfall" }));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onSubHireShortfall).toHaveBeenCalledWith(ITEM, 2);
  });

  it("saves through onSave with only the changed fields", async () => {
    const p = renderEditor();
    await userEvent.click(await screen.findByRole("button", { name: "Increase quantity" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(ITEM, { quantity: 5 }));
  });

  it("surfaces a refused save (e.g. cleared price that still has a discount) and stays open", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Remove the discount before clearing the price");
    });
    const p = renderEditor({ onSave });
    await userEvent.click(await screen.findByRole("button", { name: "Increase quantity" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Remove the discount before clearing the price");
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("has no shortcut without subHire permission, and no price fields while pricing is locked", async () => {
    renderEditor({ onSubHireShortfall: undefined, moneyLocked: true });
    await screen.findByLabelText("Quantity");
    expect(screen.queryByRole("button", { name: "Sub-hire shortfall" })).toBeNull();
    expect(screen.queryByLabelText("Price")).toBeNull();
    expect(screen.getByText(/2 short on this job/)).toBeTruthy();
  });
});
