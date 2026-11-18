// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LineRowList, visibleRowIds } from "@/components/ui/line-row";
import { buildOrdersSection, type OrderSource } from "./equipment-orders-section";
import { equipmentColumns } from "./equipment-sections";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const NOW = new Date("2026-06-10T00:00:00Z");
const order = (over: Partial<OrderSource> = {}): OrderSource => ({
  id: "o1",
  orderNumber: "SH-0001",
  status: "DRAFT",
  supplier: { name: "Acme Hire" },
  totalCharge: 500,
  totalCost: 300,
  _count: { items: 2 },
  ...over,
});

function setup(orders: OrderSource[]) {
  const onOpen = vi.fn();
  const onSetStatus = vi.fn();
  const section = buildOrdersSection(orders, { now: NOW, showCost: false, onOpen, onSetStatus })!;
  return { section, onOpen, onSetStatus };
}

describe("Orders section", () => {
  it("is absent with no orders, and its rows are never selectable", () => {
    expect(buildOrdersSection([], { now: NOW, showCost: false, onOpen: vi.fn(), onSetStatus: vi.fn() })).toBeNull();
    const { section } = setup([order()]);
    expect(section.rows[0].selectable).toBe(false);
    expect(visibleRowIds([section])).toEqual([]);
  });

  it("an ON_HIRE order past its end reads Overdue", () => {
    const { section } = setup([order({ status: "ON_HIRE", hireEnd: "2026-06-01T00:00:00Z" })]);
    expect(section.rows[0].status).toMatchObject({ label: "Overdue", intent: "error" });
  });

  it("renders as rows and the ⋯ opens with the next step, which fires the one status write", async () => {
    const { section, onSetStatus, onOpen } = setup([order()]);
    const user = userEvent.setup();
    render(<LineRowList sections={[section]} columns={equipmentColumns(false)} />);
    expect(screen.getByText("SH-0001")).toBeTruthy();
    expect(screen.getByText("Acme Hire")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "SH-0001 actions" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Confirm/ })).toBeTruthy());
    expect(screen.getByRole("menuitem", { name: /Edit order/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Cancel order/ })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: /Confirm/ }));
    expect(onSetStatus).toHaveBeenCalledWith("o1", "CONFIRMED");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a RETURNED order offers Edit only (absent, not disabled)", async () => {
    const { section } = setup([order({ status: "RETURNED" })]);
    const user = userEvent.setup();
    render(<LineRowList sections={[section]} columns={equipmentColumns(false)} />);
    await user.click(screen.getByRole("button", { name: "SH-0001 actions" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Edit order/ })).toBeTruthy());
    expect(screen.queryByRole("menuitem", { name: /Cancel order/ })).toBeNull();
  });
});
