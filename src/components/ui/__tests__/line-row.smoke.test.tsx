// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LineRowList } from "@/components/ui/line-row";
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
});
