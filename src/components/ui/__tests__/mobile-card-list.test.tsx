// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MobileCardList } from "@/components/ui/data-table";
import type { ColumnDef } from "@/components/ui/data-table";

interface Row {
  id: string;
  name: string;
  status: string;
  qty: number;
}

const rows: Row[] = [
  { id: "a", name: "Shure SM58", status: "Available", qty: 12 },
  { id: "b", name: "DI Box", status: "On hire", qty: 3 },
];

const columns: ColumnDef<Row>[] = [
  { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
  { id: "status", header: "Status", accessorKey: "status", mobile: "badge" },
  { id: "qty", header: "Qty", accessorKey: "qty", mobile: "meta" },
];

describe("MobileCardList", () => {
  it("renders one card per row with the title and meta", () => {
    render(<MobileCardList data={rows} columns={columns} getRowId={(r) => r.id} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Shure SM58")).toBeTruthy();
    // meta pair prints the column header as a label.
    expect(within(items[0]).getByText("Qty")).toBeTruthy();
    expect(within(items[0]).getByText("12")).toBeTruthy();
  });

  it("renders nothing (or an empty message) for an empty list", () => {
    const { container, rerender } = render(
      <MobileCardList data={[]} columns={columns} getRowId={(r) => r.id} />,
    );
    expect(container.innerHTML).toBe("");
    rerender(
      <MobileCardList data={[]} columns={columns} getRowId={(r) => r.id} emptyMessage="No items yet" />,
    );
    expect(screen.getByText("No items yet")).toBeTruthy();
  });

  it("applies the passed className to the wrapper (so callers can gate it with md:hidden)", () => {
    const { container } = render(
      <MobileCardList data={rows} columns={columns} getRowId={(r) => r.id} className="md:hidden" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain("md:hidden");
  });
});
