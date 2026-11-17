// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockIsMobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockIsMobile }));

import { AddBar, moveIndex, resolveEnter, type AddBarResult } from "@/components/ui/add-bar";

const gear: AddBarResult[] = [
  { id: "m1", kind: "gear", title: "Shure ULXD", subtitle: "Wireless", detail: "$40/day" },
  { id: "m2", kind: "gear", title: "Shure SM58" },
];

function setup() {
  const search = vi.fn(async (_q: string, kind: string | null) => (kind === "kit" ? [] : gear));
  const onAdd = vi.fn();
  const onOpenEditor = vi.fn();
  render(
    <AddBar
      kinds={[{ key: "gear", label: "Gear" }, { key: "kit", label: "Kit" }]}
      search={search}
      onAdd={onAdd}
      onOpenEditor={onOpenEditor}
      placeholder="Add gear"
    />,
  );
  return { search, onAdd, onOpenEditor };
}

describe("AddBar", () => {
  beforeEach(() => {
    cleanup();
    mockIsMobile = false;
  });

  it("pure helpers: Enter adds, then edits the same result; arrows wrap", () => {
    expect(resolveEnter(gear, 0, null)).toEqual({ type: "add", result: gear[0] });
    expect(resolveEnter(gear, 0, "m1")).toEqual({ type: "edit", result: gear[0] });
    expect(resolveEnter([], 0, null)).toEqual({ type: "none" });
    expect(moveIndex(1, 1, 2)).toBe(0);
    expect(moveIndex(0, -1, 2)).toBe(1);
  });

  it("desktop: type, Enter adds, second Enter opens the row editor", async () => {
    const { onAdd, onOpenEditor } = setup();
    const input = screen.getByLabelText("Add to list");
    await userEvent.type(input, "shure");
    expect(await screen.findByRole("option", { name: /Shure ULXD/ })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(gear[0]);
    await userEvent.keyboard("{Enter}");
    expect(onOpenEditor).toHaveBeenCalledWith(gear[0]);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("a kind chip narrows the search", async () => {
    const { search } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Kit" }));
    await userEvent.type(screen.getByLabelText("Add to list"), "x");
    await waitFor(() => expect(search).toHaveBeenCalledWith("x", "kit"));
    expect(await screen.findByText("No matches")).toBeTruthy();
  });

  it("phone: opens as a bottom sheet; Enter twice works inside it", async () => {
    mockIsMobile = true;
    const { onAdd, onOpenEditor } = setup();
    expect(screen.queryByLabelText("Add to list")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    const input = await screen.findByLabelText("Add to list");
    await userEvent.type(input, "shure");
    await screen.findByRole("option", { name: /Shure ULXD/ });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(gear[1]));
    await userEvent.keyboard("{Enter}");
    expect(onOpenEditor).toHaveBeenCalledWith(gear[1]);
  });
});
