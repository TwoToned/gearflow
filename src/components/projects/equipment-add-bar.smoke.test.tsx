// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const add = vi.hoisted(() => vi.fn());
const addKit = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useConvex: () => ({ query }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-line-item-writes", () => ({
  useLineItemWrites: () => ({ enabled: true, add, addKit, remove: vi.fn() }),
}));

import { EquipmentAddBar } from "./equipment-add-bar";

const onOpenDialog = vi.fn();
const invalidate = vi.fn();

function setup() {
  render(<EquipmentAddBar projectId="p1" orgId="o1" invalidate={invalidate} onOpenDialog={onOpenDialog} />);
  return screen.getByRole("combobox");
}

describe("EquipmentAddBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    add.mockResolvedValue({ id: "l1", merged: false });
    // With no kind chip active the bar searches models first, then kits.
    query.mockReset();
    query.mockResolvedValueOnce([{ id: "m1", name: "Moving head", isActive: true, manufacturer: "Robe" }]).mockResolvedValue([]);
  });

  it("Enter adds a gear line with a blank price; a second Enter opens the dialog with the model", async () => {
    const input = setup();
    await userEvent.type(input, "mov");
    await screen.findByRole("option", { name: /Moving head/ });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const parsed = add.mock.calls[0][1];
    expect(parsed).toMatchObject({ type: "EQUIPMENT", modelId: "m1", quantity: 1 });
    expect(parsed.unitPrice).toBeUndefined();
    expect(onOpenDialog).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onOpenDialog).toHaveBeenCalledWith("own-stock", "m1");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("the Custom kind opens the dialog instead of adding", async () => {
    const input = setup();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(input, "gaffer");
    await screen.findByRole("option", { name: /custom item/ });
    await userEvent.keyboard("{Enter}");
    expect(onOpenDialog).toHaveBeenCalledWith("custom");
    expect(add).not.toHaveBeenCalled();
  });
});
