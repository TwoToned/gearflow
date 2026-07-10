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
    fireEvent.click(within(card).getByText("Splendour Main Stage"));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("does not give the card a button role, which would nest its inner links", () => {
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", cell: (r) => <a href={`/p/${r.id}`}>{r.name}</a> },
    ];
    render(<DataTable data={ROWS} columns={columns} onRowClick={vi.fn()} />);

    const card = within(cardList()).getAllByRole("listitem")[0];
    expect(within(card).queryByRole("button")).toBeNull();
    // The title link stays the keyboard entry point, as in the desktop table.
    expect(within(card).getByRole("link", { name: "Splendour Main Stage" })).toBeTruthy();
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

  it("drops a meta pair whose cell would only render a dash, via the accessor", () => {
    // `owner` has BOTH a custom cell and an accessorKey — the cell prints "—" for
    // a null owner, so the accessor is what tells us there's nothing to show.
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      {
        id: "owner",
        header: "Owner",
        accessorKey: "owner",
        cell: (r) => <span>{r.owner ?? "—"}</span>,
        mobile: "meta",
      },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const cards = within(cardList()).getAllByRole("listitem");
    expect(within(cards[0]).getByText("Jo")).toBeTruthy();
    expect(within(cards[1]).queryByText("Owner")).toBeNull();
    expect(within(cards[1]).queryByText("—")).toBeNull();
  });

  it("honours an explicit mobileEmpty predicate for cells with no accessor", () => {
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      {
        id: "rate",
        header: "Day rate",
        cell: (r) => <span>{r.owner ? "$500.00" : "—"}</span>,
        mobileEmpty: (r) => !r.owner,
        mobile: "meta",
      },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const cards = within(cardList()).getAllByRole("listitem");
    expect(within(cards[0]).getByText("$500.00")).toBeTruthy();
    expect(within(cards[1]).queryByText("Day rate")).toBeNull();
  });

  it("keeps a meta pair whose cell coalesces a null accessor into real content", () => {
    // Regression: asset-table's `availableQuantity` has a nullable accessorKey but
    // its cell renders `?? 0` plus a deployment bar. Keying `isCellEmpty` off the
    // accessor alone silently dropped the pair from the card while the desktop
    // table still showed "0". `mobileEmpty: () => false` is the opt-out.
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      {
        id: "available",
        header: "Available",
        accessorKey: "owner", // null on ROWS[1]
        mobileEmpty: () => false,
        cell: (r) => <span>{r.owner ?? "0"} available</span>,
        mobile: "meta",
      },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const cards = within(cardList()).getAllByRole("listitem");
    expect(within(cards[1]).getByText("0 available")).toBeTruthy();
    expect(within(cards[1]).getByText("Available")).toBeTruthy();
  });

  it("renders no card list when mobileCards is disabled", () => {
    const columns: ColumnDef<Row>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    render(<DataTable data={ROWS} columns={columns} mobileCards={false} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("promotes the first meta column to the title when a table declares roles but no title", () => {
    // Roles are declared (so the no-annotation fallback is skipped) but none is
    // `title` — the `layout.title ??= layout.meta.shift()` branch must still give
    // the card a headline rather than leaving it title-less.
    const columns: ColumnDef<Row>[] = [
      { id: "status", header: "Status", accessorKey: "status", mobile: "badge" },
      { id: "client", header: "Client", accessorKey: "client", mobile: "meta" },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const card = within(cardList()).getAllByRole("listitem")[0];
    // The first meta column ("client") is promoted, so its value is the headline...
    expect(within(card).getByText("Live Nation")).toBeTruthy();
    // ...and it is no longer rendered as a labelled meta pair (no "Client" <dt>).
    expect(within(card).queryByText("Client")).toBeNull();
    // The badge column still renders alongside the promoted title.
    expect(within(card).getByText("ACTIVE")).toBeTruthy();
  });

  it("keeps a meta cell that has a custom renderer but no accessor or mobileEmpty", () => {
    // isCellEmpty's final precedence branch: with no mobileEmpty and no
    // accessorKey to introspect, a column with a `cell` is assumed to have
    // something to show, so its meta pair renders on every row (never dropped).
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      { id: "note", header: "Note", cell: (r) => <span>note-{r.id}</span>, mobile: "meta" },
    ];
    render(<DataTable data={ROWS} columns={columns} />);

    const cards = within(cardList()).getAllByRole("listitem");
    // Both rows keep the pair, including the one whose accessor-derived columns are empty.
    expect(within(cards[0]).getByText("note-1")).toBeTruthy();
    expect(within(cards[1]).getByText("note-2")).toBeTruthy();
    expect(within(cards[1]).getByText("Note")).toBeTruthy();
  });

  it("renders an `actions` column in its own slot and isolates it from the row tap", () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    const columns: ColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name", mobile: "title" },
      {
        id: "actions",
        header: "",
        cell: (r) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction(r.id);
            }}
          >
            Menu
          </button>
        ),
        mobile: "actions",
      },
    ];
    render(<DataTable data={ROWS} columns={columns} onRowClick={onRowClick} />);

    const card = within(cardList()).getAllByRole("listitem")[0];
    fireEvent.click(within(card).getByRole("button", { name: "Menu" }));

    // The action fired; the card's row-level onRowClick did not.
    expect(onAction).toHaveBeenCalledWith("1");
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
