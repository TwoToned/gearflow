// @vitest-environment jsdom
//
// The wizard's What step uses the Equipment tab's own pieces: the row ⋯ comes from
// buildGearLineActions (a handler a draft lacks is ABSENT, so no dead Edit / Move
// items), flags come from equipmentRowModel, and the bulk bar from BulkBar.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const removeMany = vi.fn(async (ids: string[]) => ({ removed: ids.length, skipped: 0 }));
vi.mock("@/hooks/use-line-item-writes", () => ({
  useLineItemWrites: () => ({ enabled: true, removeMany, update: vi.fn() }),
  updateLineItemFromPayload: vi.fn(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/projects/equipment-add-bar", () => ({ EquipmentAddBar: () => <div data-testid="add-bar" /> }));

import { StepWhat } from "../new-job/step-what";

const line = (id: string, description: string, over: Record<string, unknown> = {}) => ({
  id, description, quantity: 2, unitPrice: 500, lineTotal: 1000, modelId: "m1", type: "EQUIPMENT", ...over,
});
const data = (lines: ReturnType<typeof line>[], overbooked = {}) =>
  ({ lines, overbooked, total: 0, isLoading: false }) as unknown as Parameters<typeof StepWhat>[0]["data"];

describe("StepWhat", () => {
  it("shows the add bar, the Equipment rows' flags, and a ⋯ with only what a draft can do", async () => {
    const user = userEvent.setup();
    render(<StepWhat draftId="d1" orgId="org1" data={data([line("l1", "Barco UDX", { unitPrice: null, lineTotal: null }), line("l2", "Shure SM58")], { l2: { overBy: 1, totalStock: 4, effectiveStock: 4 } })} />);
    expect(screen.getByTestId("add-bar")).toBeTruthy();
    expect(screen.getByText("Barco UDX")).toBeTruthy();
    // equipmentRowModel's own flags.
    expect(screen.getAllByText(/short/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/unpriced/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Barco UDX actions" }));
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items.join(" ")).toMatch(/Delete/);
    expect(items.join(" ")).not.toMatch(/Edit|Move to|Needs review|Follow up/);
  });

  it("ticking a row shows the bulk bar; its Delete asks first, then removes exactly the ticked lines", async () => {
    const user = userEvent.setup();
    removeMany.mockClear();
    render(<StepWhat draftId="d1" orgId="org1" data={data([line("l1", "Barco UDX"), line("l2", "Shure SM58")])} />);
    await user.click(screen.getByRole("checkbox", { name: /Barco UDX/ }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    await user.click(within(bar).getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText("Remove from this job")).toBeTruthy();
    expect(removeMany).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox"), "DELETE");
    await user.click(screen.getByRole("button", { name: "Remove 1 line" }));
    await vi.waitFor(() => expect(removeMany).toHaveBeenCalledWith(["l1"]));
  });

  it("without a draft it says what to do first", () => {
    render(<StepWhat draftId={undefined} orgId="org1" data={data([])} />);
    expect(screen.getByText(/Name the job on the first step/)).toBeTruthy();
  });
});
