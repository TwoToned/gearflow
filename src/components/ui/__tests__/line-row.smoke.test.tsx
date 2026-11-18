// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LineRowList, LineRowSection, visibleRowIds, type LineRowListSection } from "@/components/ui/line-row";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import type { FactColumn, LineRowData } from "@/lib/primitives/types";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const columns: FactColumn[] = [
  { id: "qty", header: "Qty", align: "end" },
  { id: "price", header: "Price", align: "end" },
];

const menu = { items: [{ key: "e", label: "Edit", group: "edit" as const, onSelect: vi.fn() }] };
const rows: LineRowData[] = [
  {
    id: "a", kind: "gear", title: "Moving head", subtitle: "LX", tags: ["MH-01"],
    flags: [{ label: "Short 2", tone: "error" }],
    glyphs: [{ key: "plannedCase", tooltip: "Planned → LX-04" }],
    facts: { qty: { kind: "qty", value: 4 }, price: { kind: "money", amount: null } },
    menu,
    children: [{ id: "a1", kind: "gear", title: "Clamp", facts: { qty: { kind: "qty", value: 4 } } }],
  },
  { id: "b", kind: "gear", title: "Par can", facts: { qty: { kind: "qty", value: 2 }, price: { kind: "money", amount: 10 } }, menu },
  { id: "c", kind: "gear", title: "Fresnel", facts: { qty: { kind: "qty", value: 1 } }, menu },
];

function Harness({ onOpen }: { onOpen?: () => void }) {
  const ids = rows.map((r) => r.id);
  const selection = useRowSelection(ids);
  const data = onOpen ? rows.map((r) => ({ ...r, onOpen })) : rows;
  return (
    <>
      <span data-testid="count">{selection.count}</span>
      <LineRowList rows={data} columns={columns} selection={selection} />
    </>
  );
}

describe("LineRow", () => {
  beforeEach(() => {
    mobile.value = false;
  });

  it("desktop: renders a table with facts as columns, blank money as a dash, ⋯ always rendered", () => {
    render(<Harness />);
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /actions$/ })).toHaveLength(3);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Short 2")).toBeTruthy();
  });

  it("desktop: shift-click selects the range in DOM order and the header box follows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Select Moving head" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Fresnel" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("count").textContent).toBe("3");
    expect(screen.getByRole("checkbox", { name: "Select page" }).getAttribute("data-state")).toBe("checked");
    await user.click(screen.getByRole("checkbox", { name: "Select page" }));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("desktop: children expand to 44px rows with no ⋯", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    const child = document.querySelector("[data-child-row]")!;
    expect(child.className).toContain("h-11");
    expect(child.querySelector("button")).toBeNull();
  });

  it("opens on a whole-row click but not on a control inside it", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpen={onOpen} />);
    await user.click(screen.getByText("Par can"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("checkbox", { name: "Select Par can" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a glyph tooltip opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.hover(screen.getByRole("button", { name: "Planned → LX-04" }));
    expect((await screen.findAllByText("Planned → LX-04")).length).toBeGreaterThan(0);
  });

  it("phone: a card with folded facts, first qty on the right, 40px ⋯, 22px checkbox", async () => {
    mobile.value = true;
    render(<Harness />);
    expect(document.querySelector("table")).toBeNull();
    const card = document.querySelector("[data-row-id='b']")!;
    expect(card.textContent).toContain("2");
    expect(card.textContent).toContain("$10");
    expect(card.textContent).not.toContain("$10.00"); // no cents in lists
    const more = screen.getAllByRole("button", { name: /actions$/ })[0];
    expect(more.className).toContain("size-10");
    expect(screen.getAllByRole("checkbox")[0].className).toContain("[&>span]:size-[22px]");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /actions$/ })).toHaveLength(3));
  });

  it("desktop money is whole dollars; blank money is a dash", () => {
    render(<Harness />);
    expect(screen.getByText("$10")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("phone: a blank money fact is skipped in the subtitle, not shown as a dash", () => {
    mobile.value = true;
    render(<Harness />);
    expect(document.querySelector("[data-row-id='a']")!.textContent).not.toContain("—");
  });

  it("a flag never wraps or shrinks beside a truncating title", () => {
    mobile.value = true;
    render(<Harness />);
    const flag = screen.getByText("Short 2");
    expect(flag.className).toContain("whitespace-nowrap");
    expect(flag.className).toContain("shrink-0");
    expect(flag.parentElement!.querySelector("span.truncate, a.truncate")).toBeTruthy();
  });

  it("an accessory child renders its primary button and ⋯; other children get neither", async () => {
    const onPrimary = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    const parent: LineRowData = {
      id: "p", kind: "gear", title: "Desk", facts: {},
      children: [
        { id: "acc", kind: "accessory", title: "PSU", facts: {}, primary: { label: "Pack 2 with parent", onSelect: onPrimary }, menu },
        { id: "kit", kind: "gear", title: "Cable", facts: {}, primary: { label: "Nope", onSelect: vi.fn() }, menu },
      ],
    };
    render(<LineRowList rows={[parent]} columns={[]} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    await user.click(screen.getByRole("button", { name: "Pack 2 with parent" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "PSU actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nope" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cable actions" })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("desktop: a cell override wins over the fact, on a row and on a child; phone ignores it", async () => {
    const user = userEvent.setup();
    const row: LineRowData = {
      id: "r", kind: "gear", title: "Desk",
      facts: { qty: { kind: "qty", value: 4 } },
      cells: { qty: <input aria-label="qty cell" defaultValue="9" /> },
      children: [{ id: "k", kind: "accessory", title: "PSU", facts: { qty: { kind: "qty", value: 1 } }, cells: { qty: <span>7/12</span> } }],
    };
    const { unmount } = render(<LineRowList rows={[row]} columns={columns} />);
    expect(screen.getByLabelText("qty cell")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("7/12")).toBeTruthy();
    unmount();
    mobile.value = true;
    render(<LineRowList rows={[row]} columns={columns} />);
    expect(screen.queryByLabelText("qty cell")).toBeNull();
    expect(document.querySelector("[data-row-id='r']")!.textContent).toContain("4");
  });

  it("wrapRow wraps the row element and dragHandle renders in the select cell (desktop)", () => {
    const wrap = vi.fn((_r: LineRowData, el: React.ReactElement) => React.cloneElement(el as React.ReactElement<{ "data-wrapped": string }>, { "data-wrapped": "yes" }));
    render(<LineRowList rows={rows} columns={columns} wrapRow={wrap} dragHandle={(r) => <i data-testid={`grip-${r.id}`} />} />);
    expect(wrap).toHaveBeenCalledTimes(3);
    expect(document.querySelector("tr[data-row-id='b']")!.getAttribute("data-wrapped")).toBe("yes");
    expect(screen.getByTestId("grip-b")).toBeTruthy();
  });
});

describe("LineRowSection", () => {
  beforeEach(() => {
    mobile.value = false;
  });
  const onSelectAll = vi.fn();
  const section = {
    id: "s", title: "Lighting", count: 3, amount: null as number | null, flags: [{ label: "Sealed", tone: "warning" as const }],
    menu: { items: [{ key: "r", label: "Rename", group: "edit" as const, onSelect: vi.fn() }] },
    selectState: "some" as const, onToggleSelect: onSelectAll,
  };

  it("desktop: full-width row with count, flag, blank subtotal, tri-state box, menu that opens, collapse", async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    render(
      <table><tbody>
        <LineRowSection section={section} columns={columns} onCollapsedChange={onCollapse} wrapSection={(el) => React.cloneElement(el as React.ReactElement<{ "data-wrapped": string }>, { "data-wrapped": "y" })} />
      </tbody></table>,
    );
    const tr = document.querySelector("tr[data-section-id='s']")!;
    expect(tr.getAttribute("data-wrapped")).toBe("y");
    expect(tr.querySelector("td")!.getAttribute("colspan")).toBe("5");
    expect(screen.getByText("Sealed")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: "Select all in Lighting" });
    expect(box.getAttribute("data-state")).toBe("indeterminate");
    await user.click(box);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(onCollapse).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Lighting actions" }));
    expect(await screen.findByText("Rename")).toBeTruthy();
  });

  it("phone: a hairline head with a subtotal and the menu", async () => {
    mobile.value = true;
    render(<LineRowSection section={{ ...section, amount: 1200 }} columns={columns} />);
    const head = document.querySelector("[data-section-id='s']")!;
    expect(head.tagName).toBe("DIV");
    expect(head.textContent).toContain("$1,200");
    expect(screen.getByRole("button", { name: "Lighting actions" })).toBeTruthy();
  });

  it("collapsed is controllable", () => {
    render(<table><tbody><LineRowSection section={section} columns={columns} collapsed /></tbody></table>);
    expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
  });
});

describe("LineRowList sections", () => {
  beforeEach(() => {
    mobile.value = false;
  });
  const mk = (id: string): LineRowData => ({ id, kind: "gear", title: `Item ${id}`, facts: { qty: { kind: "qty", value: 1 } } });
  const secs: LineRowListSection[] = [
    { section: { id: "s1", title: "Lighting", count: 2 }, rows: [mk("a"), mk("b")] },
    { section: { id: "s2", title: "Sound", count: 1 }, rows: [mk("c")] },
  ];

  function SecHarness() {
    const [owned] = React.useState<ReadonlySet<string>>(new Set());
    const ids = visibleRowIds(secs, owned);
    const selection = useRowSelection(ids);
    return (
      <>
        <span data-testid="count">{selection.count}</span>
        <LineRowList sections={secs} columns={columns} selection={selection} />
      </>
    );
  }

  it("one table, one header row, each section head followed by its rows in DOM order", () => {
    render(<SecHarness />);
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect(document.querySelectorAll("thead tr")).toHaveLength(1);
    const order = [...document.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-section-id") ?? r.getAttribute("data-row-id"));
    expect(order).toEqual(["s1", "a", "b", "s2", "c"]);
  });

  it("collapsing hides only that section's rows", async () => {
    const user = userEvent.setup();
    render(<SecHarness />);
    await user.click(within(document.querySelector("[data-section-id='s1']") as HTMLElement).getByRole("button", { name: "Collapse" }));
    expect(document.querySelector("[data-row-id='a']")).toBeNull();
    expect(document.querySelector("[data-row-id='c']")).toBeTruthy();
  });

  it("shift-range selects across a section boundary", async () => {
    const user = userEvent.setup();
    render(<SecHarness />);
    await user.click(screen.getByRole("checkbox", { name: "Select Item b" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Item c" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("visibleRowIds skips collapsed sections (controlled and list-owned)", () => {
    expect(visibleRowIds([{ ...secs[0], collapsed: true }, secs[1]])).toEqual(["c"]);
    expect(visibleRowIds(secs, new Set(["s2"]))).toEqual(["a", "b"]);
  });

  it("phone: section heads and rows in one list, in order", () => {
    mobile.value = true;
    render(<SecHarness />);
    expect(document.querySelector("table")).toBeNull();
    const order = [...document.querySelectorAll("[data-section-id], [data-row-id]")].map((r) => r.getAttribute("data-section-id") ?? r.getAttribute("data-row-id"));
    expect(order).toEqual(["s1", "a", "b", "s2", "c"]);
  });
});

describe("selectable accessory children", () => {
  const withKids: LineRowListSection[] = [{
    section: { id: "s", title: "Case", count: 2 },
    rows: [
      {
        id: "p", kind: "gear", title: "Handheld", facts: { qty: { kind: "qty", value: 1 } },
        children: [
          { id: "acc1", kind: "accessory", title: "Battery", facts: {} },
          { id: "acc2", kind: "accessory", title: "Strap", facts: {}, selectable: false },
          { id: "k1", kind: "gear", title: "Clamp", facts: {} },
        ],
      },
      { id: "q", kind: "gear", title: "Par", facts: { qty: { kind: "qty", value: 1 } } },
    ],
  }];

  function Kids() {
    const selection = useRowSelection(visibleRowIds(withKids));
    return (
      <>
        <span data-testid="sel">{[...selection.selected].join(",")}</span>
        <LineRowList sections={withKids} columns={columns} selection={selection} />
      </>
    );
  }

  it("visibleRowIds lists selectable accessory children after their parent, and only those", () => {
    expect(visibleRowIds(withKids)).toEqual(["p", "acc1", "q"]);
  });

  it.each([false, true])("an expanded accessory child has its own checkbox; others do not (phone=%s)", async (phone) => {
    mobile.value = phone;
    render(<Kids />);
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("checkbox", { name: "Select Battery" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Select Strap" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Select Clamp" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Battery" }));
    expect(screen.getByTestId("sel").textContent).toBe("acc1");
  });

  it("a shift-range from the parent to the next row takes the accessory child between them", async () => {
    mobile.value = false;
    const user = userEvent.setup();
    render(<Kids />);
    await user.click(screen.getByRole("checkbox", { name: "Select Handheld" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select Par" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("sel").textContent).toBe("p,acc1,q");
  });
});
