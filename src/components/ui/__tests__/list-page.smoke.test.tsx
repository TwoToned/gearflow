// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ListPage, type ListPageProps } from "@/components/ui/list-page";
import type { ListUrlSpec } from "@/lib/list-url-state";
import type { LineRowData } from "@/lib/primitives/types";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const nav = vi.hoisted(() => ({
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const spec: ListUrlSpec = {
  segments: ["all", "booked"],
  filters: ["status", "type"],
  sorts: ["start", "title"],
  defaultSort: "start:desc",
  views: ["table", "board"],
};

const row = (id: string): LineRowData => ({
  id,
  kind: "gear",
  title: `Job ${id}`,
  facts: { total: { kind: "money", amount: 100 } },
  menu: { items: [{ key: "o", label: "Open", group: "edit", onSelect: vi.fn() }] },
});

function Page(over: Partial<ListPageProps> = {}) {
  return (
    <ListPage
      spec={spec}
      title="Jobs"
      noun="jobs"
      bulkNoun="job"
      searchPlaceholder="Search jobs"
      segments={[
        { key: "all", label: "All", count: 38 },
        { key: "booked", label: "Booked", count: 4 },
      ]}
      filters={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "CONFIRMED", label: "Confirmed" },
            { value: "QUOTED", label: "Quoted" },
          ],
        },
      ]}
      views={[
        { key: "table", label: "Table" },
        { key: "board", label: "Board" },
      ]}
      columns={[{ id: "total", header: "Total", align: "end", sortKey: "start" }]}
      rows={[row("a"), row("b")]}
      total={38}
      loading={false}
      itemHeader="Job"
      itemSortKey="title"
      primary={{ label: "New job", onSelect: vi.fn() }}
      pageMenu={{ items: [{ key: "t", label: "Templates", group: "organise", onSelect: vi.fn() }] }}
      bulk={(ids) => [{ key: "x", label: (n) => `Export ${n}`, group: "reporting", onSelect: vi.fn(() => void ids) }]}
      empty={{ title: "No jobs yet", action: { label: "New job", onSelect: vi.fn() } }}
      renderView={(v) => (v === "board" ? <div>BOARD</div> : null)}
      {...over}
    />
  );
}

describe("ListPage", () => {
  beforeEach(() => {
    mobile.value = false;
    nav.search = "";
    nav.push.mockClear();
    nav.replace.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("desktop: title, segments with counts, header sort, footer and the one primary", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Booked/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Job/ })).toBeTruthy();
    expect(screen.getByText(/38 jobs · 1–25/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New job" })).toHaveLength(1);
  });

  it("segment, sort header and pager push URL state; defaults are omitted", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("tab", { name: /Booked/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/projects?seg=booked", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Job" }));
    expect(nav.push).toHaveBeenLastCalledWith("/projects?sort=title%3Aasc", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(nav.push).toHaveBeenLastCalledWith("/projects?page=2", { scroll: false });
  });

  it("opens a filter word, picks values, prints them and clears with the ✕", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page />);
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("checkbox", { name: "Confirmed" }));
    expect(nav.push).toHaveBeenLastCalledWith("/projects?status=CONFIRMED", { scroll: false });
    nav.search = "status=CONFIRMED,QUOTED";
    rerender(<Page />);
    expect(screen.getByRole("button", { name: "Status: 2 chosen" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear Status" }));
    expect(nav.push).toHaveBeenLastCalledWith("/projects", { scroll: false });
  });

  it("search replaces after the debounce, not on every key", async () => {
    vi.useFakeTimers();
    render(<Page />);
    const box = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(box, { target: { value: "h" } });
    fireEvent.change(box, { target: { value: "hil" } });
    expect(nav.replace).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenLastCalledWith("/projects?q=hil", { scroll: false });
  });

  it("view words switch to the board and keep other params", async () => {
    const user = userEvent.setup();
    nav.search = "tab=x";
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Board" }));
    expect(nav.push).toHaveBeenLastCalledWith("/projects?tab=x&view=board", { scroll: false });
  });

  it("renders the board view in place of the table when the URL says so", () => {
    nav.search = "view=board";
    render(<Page />);
    expect(screen.getByText("BOARD")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens the page menu", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Jobs options" }));
    expect(await screen.findByRole("menuitem", { name: /Templates/ })).toBeTruthy();
  });

  it("selecting rows shows the bulk bar with the count and the verbs", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("checkbox", { name: "Select Job a" }));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bar).getByText("1 job selected")).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Export 1" })).toBeTruthy();
  });

  it("empty: none-yet offers the next action; filtered offers Clear filters", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page rows={[]} total={0} />);
    expect(screen.getByText("No jobs yet")).toBeTruthy();
    nav.search = "q=zzz";
    rerender(<Page rows={[]} total={0} />);
    expect(screen.getByText("Nothing matches")).toBeTruthy();
    // The toolbar word and the empty state both offer it.
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[1]);
    expect(nav.push).toHaveBeenLastCalledWith("/projects", { scroll: false });
  });

  it("phone: cards not a table, sticky primary, Show more, and bulk replaces the primary", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<Page />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Job a")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New job" })).toBeTruthy();
    expect(screen.getByText("Showing 2 of 38 jobs")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show 25 more" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/projects?page=2", { scroll: false });
    await user.click(screen.getByRole("checkbox", { name: "Select Job a" }));
    expect(screen.queryByRole("button", { name: "New job" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeTruthy();
  });
});
