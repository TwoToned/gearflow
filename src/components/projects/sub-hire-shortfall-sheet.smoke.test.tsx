// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { buildGearLineActions } from "@/lib/row-actions/gear-line";
import type { LineItemData } from "./equipment-row-types";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const writes = {
  create: vi.fn(async () => ({ id: "o-new" })),
  addItem: vi.fn(async () => ({ id: "it1" })),
  removeItem: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
};
vi.mock("@/hooks/use-sub-hire-writes", () => ({ useSubHireWrites: () => writes }));
vi.mock("@/hooks/use-suppliers", () => ({ useSupplierSearch: () => [], useSupplier: () => undefined }));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({
    data: [
      { supplierId: "s1", lastUnitCost: 30, pricingType: "PER_DAY", supplier: { name: "Acme Hire" } },
      { supplierId: "s2", lastUnitCost: 45, pricingType: "FLAT", supplier: { name: "Beta AV" } },
    ],
  }),
}));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: (o: { mutationFn: () => Promise<unknown>; onSuccess?: (d: unknown) => void; onError?: (e: Error) => void }) => ({
    isPending: false,
    mutate: () => void o.mutationFn().then((d) => o.onSuccess?.(d), (e) => o.onError?.(e)),
  }),
}));
vi.mock("@/server/sub-hires", () => ({ getSupplierRateHistory: vi.fn() }));

import { SubHireShortfallSheet } from "./sub-hire-shortfall-sheet";

const ITEM = {
  id: "li1",
  modelId: "m1",
  description: "SM58",
  quantity: 5,
  unitPrice: 50,
  model: { name: "SM58" },
} as unknown as LineItemData;

describe("SubHireShortfallSheet", () => {
  it("opens prefilled, shows a live margin from the chip's cached rate, and writes through the existing mutations", async () => {
    const onSetLineQuantity = vi.fn(async () => {});
    const onClose = vi.fn();
    render(
      <SubHireShortfallSheet
        target={{ item: ITEM, short: 2 }}
        projectId="p1"
        hireStart={new Date("2026-06-01T00:00:00Z")}
        hireEnd={new Date("2026-06-04T00:00:00Z")}
        draftOrders={[]}
        onSetLineQuantity={onSetLineQuantity}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/Sub-hire 2 × SM58/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Acme Hire/ }));
    // cost 30 × 2 × 3 days = 180; charge 50 × 2 × 3 = 300; margin 120
    const margin = within(screen.getByLabelText("Live margin"));
    expect(margin.getByText(/40%/)).toBeTruthy();
    expect(screen.getByText(/Creates a new draft order/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add sub-hire" }));
    await waitFor(() => expect(writes.addItem).toHaveBeenCalled());
    expect(writes.create).toHaveBeenCalled();
    expect(writes.addItem).toHaveBeenCalledWith("o-new", expect.objectContaining({ modelId: "m1", quantity: 2, unitCost: 30, unitCharge: 50, duration: 3 }));
    await waitFor(() => expect(onSetLineQuantity).toHaveBeenCalledWith(ITEM, 3));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("appends to the supplier's existing draft order instead of creating one", () => {
    render(
      <SubHireShortfallSheet
        target={{ item: ITEM, short: 2 }}
        projectId="p1"
        draftOrders={[{ id: "o-draft", orderNumber: "SH-0007", supplierId: "s2" }]}
        onSetLineQuantity={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Beta AV/ }));
    expect(screen.getByText(/Adds to draft order SH-0007/)).toBeTruthy();
  });
});

describe("Sub-hire shortfall menu entry", () => {
  const row = { title: "SM58", modelId: "m1" };
  it("is present only when the caller wires it (a short line)", () => {
    const keys = (h?: () => void) => buildGearLineActions(row, { onSubHireShortfall: h }).items.map((i) => i.key);
    expect(keys(() => {})).toContain("sub-hire-shortfall");
    expect(keys(undefined)).not.toContain("sub-hire-shortfall");
  });
});
