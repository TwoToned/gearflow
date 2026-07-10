// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";

interface Row {
  id: string;
  name: string;
  client: string;
  status: string;
  owner: string | null;
}

const ROWS: Row[] = [
  { id: "1", name: "Splendour Main Stage", client: "Live Nation", status: "ACTIVE", owner: "Jo" },
  { id: "2", name: "Corporate Gala", client: "Acme", status: "DRAFT", owner: null },
];

/**
 * The card list and the desktop table are both in the DOM; which one shows is a
 * pure CSS breakpoint concern (`md:hidden` / `hidden md:block`), which jsdom
 * doesn't evaluate. So these tests assert against the card <ul> subtree
 * specifically rather than the whole document.
 */
function cardList() {
  return screen.getByRole("list");
}

describe("DataTable mobile card mode", () => {
  it("renders one card per row, with the first column as the title by default", () => {
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "client", header: "Client", accessorKey: "client" },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const cards = within(cardList()).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Splendour Main Stage")).toBeTruthy();
    // The non-title column becomes a labelled meta pair.
    expect(within(cards[0]).getByText("Client")).toBeTruthy();
    expect(within(cards[0]).getByText("Live Nation")).toBeTruthy();
  });

  it("honours explicit mobile roles and omits `hidden` columns", () => {
    const columns: ColumnDef<Row>[] = [
      { id: "status", header: "Status", accessorKey: "status", mobile: "badge" },
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      { id: "client", header: "Client", accessorKey: "client", mobile: "subtitle" },
      { id: "owner", header: "Owner", accessorKey: "owner", mobile: "hidden" },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const card = within(cardList()).getAllByRole("listitem")[0];
    expect(within(card).getByText("Splendour Main Stage")).toBeTruthy();
    expect(within(card).getByText("Live Nation")).toBeTruthy();
    expect(within(card).getByText("ACTIVE")).toBeTruthy();
    // `hidden` role keeps the column out of the card entirely.
    expect(within(card).queryByText("Owner")).toBeNull();
    expect(within(card).queryByText("Jo")).toBeNull();
  });

  it("skips meta pairs whose accessor value is empty rather than printing a dash", () => {
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      { id: "owner", header: "Owner", accessorKey: "owner", mobile: "meta" },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const cards = within(cardList()).getAllByRole("listitem");
    expect(within(cards[0]).getByText("Owner")).toBeTruthy(); // owner: "Jo"
    expect(within(cards[1]).queryByText("Owner")).toBeNull(); // owner: null
  });

  it("makes the whole card the tap target when onRowClick is set (§15)", () => {
    const onRowClick = vi.fn();
    const columns: ColumnDef<Row>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    render(<DataTable data={ROWS} columns={columns} onRowClick={onRowClick} />);

    const card = within(cardList()).getAllByRole("listitem")[0];
    const target = within(card).getByRole("button");
    fireEvent.click(target);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);

    // Keyboard-reachable too.
    onRowClick.mockClear();
    fireEvent.keyDown(target, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("does not fire the row click when toggling a row's selection checkbox", () => {
    const onRowClick = vi.fn();
    const onSelectionChange = vi.fn();
    const columns: ColumnDef<Row>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    render(
      <DataTable
        data={ROWS}
        columns={columns}
        onRowClick={onRowClick}
        enableRowSelection
        selectedRows={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );

    const card = within(cardList()).getAllByRole("listitem")[0];
    fireEvent.click(within(card).getByLabelText("Select row"));

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(["1"]));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders no card list when mobileCards is disabled", () => {
    const columns: ColumnDef<Row>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    render(<DataTable data={ROWS} columns={columns} mobileCards={false} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
