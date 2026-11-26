// @vitest-environment jsdom
//
// Overbookings on ListPage: the board's six sections are ONE list (flattened in memory), the strip is the
// window (and drives the board's range), Kind is a filter word, every row menu OPENS, Sub-hire is offered only
// on a hard gear row and opens the prefilled dialog, Reorder only on sale stock, and the old `?days=` link is
// an alias that is rewritten into the strip word.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/overbookings",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const perms = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (resource: string, action: string) => perms.allowed.has(`${resource}:${action}`) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));

const board = vi.hoisted(() => ({ days: 0 }));
const BOARD_DATA = {
  range: { start: 0, end: 30 * 86_400_000 },
  gearHard: [{ modelId: "m1", modelName: "SM58", qty: 2, spanStart: Date.UTC(2026, 10, 16), spanEnd: Date.UTC(2026, 10, 18), projects: [{ id: "p1", name: "Big Show", projectNumber: "PRJ-1" }] }],
  gearPencilled: [{ modelId: "m3", modelName: "Hazer", qty: 1, spanStart: Date.UTC(2026, 10, 20), spanEnd: Date.UTC(2026, 10, 21), projects: [{ id: "p2", name: "Gala", projectNumber: "PRJ-2" }] }],
  saleStockToProcure: [{ modelId: "m2", modelName: "Gaffer Tape", shortfallQty: 3, contributingSaleLines: [{ lineItemId: "l1", projectId: "p1", projectName: "Big Show", projectNumber: "PRJ-1", quantity: 3 }] }],
  servicesMissingCrew: [
    {
      serviceId: "s1", projectId: "p1", projectName: "Big Show", projectNumber: "PRJ-1", title: "Show run",
      date: Date.UTC(2026, 10, 16), endDate: Date.UTC(2026, 10, 18), crewCountRequired: 1, assignedCount: 0, shortfall: 1,
      shortDays: [{ day: Date.UTC(2026, 10, 17), shortfall: 1 }, { day: Date.UTC(2026, 10, 18), shortfall: 1 }],
    },
  ],
  unconfirmedCrew: [],
  crewDoubleBookings: [],
};
vi.mock("@/hooks/use-native-overbooking-board", () => ({
  useNativeOverbookingBoard: (_org: string | undefined, days: number) => {
    board.days = days;
    return { data: BOARD_DATA, isLoading: false };
  },
}));

import { OverbookingsList } from "../overbookings-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  board.days = 0;
  perms.allowed = new Set(["subHire:create", "model:read"]);
});

describe("OverbookingsList (smoke)", () => {
  it("one list: gear, pencilled, sale stock and crew rows, hard before soft; the crew run names its short days", () => {
    render(<OverbookingsList />);
    for (const t of ["SM58", "Hazer", "Gaffer Tape"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText(/Show run: PRJ-1 Big Show/)).toBeTruthy();
    expect(screen.getByText(/Tue, Wed short/)).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
    expect(screen.getByText("2 short")).toBeTruthy();
    expect(screen.getByText("3 to procure")).toBeTruthy();
  });

  it("the strip is the window and drives the board's range: This week is 7 days, Next 30 days is 30, All is 90", () => {
    render(<OverbookingsList />);
    expect(board.days).toBe(7); // This week is the default
    expect(screen.getByRole("tab", { name: /This week/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Next 30 days/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /All/ })).toBeTruthy();
    nav.search = "seg=month";
    render(<OverbookingsList />);
    expect(board.days).toBe(30);
  });

  it("Kind is a filter word from the URL: Sale stock leaves only the sale-stock row", () => {
    nav.search = "kind=sale";
    render(<OverbookingsList />);
    expect(screen.getByText("Gaffer Tape")).toBeTruthy();
    expect(screen.queryByText("SM58")).toBeNull();
    expect(screen.queryByText(/Show run/)).toBeNull();
  });

  it("Sub-hire… is on the hard gear row only, and opens the prefilled dialog listing the job", async () => {
    const user = userEvent.setup();
    render(<OverbookingsList />);
    await user.click(screen.getByRole("button", { name: "Hazer actions" }));
    expect(await screen.findByText("Open model")).toBeTruthy();
    expect(screen.queryByText("Sub-hire…")).toBeNull(); // pencilled: warns, never offers a cover
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Show run: PRJ-1 Big Show actions/ }));
    expect(await screen.findByText("Open job")).toBeTruthy();
    expect(screen.queryByText("Sub-hire…")).toBeNull(); // a crew row never offers it
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "SM58 actions" }));
    await user.click(await screen.findByText("Sub-hire…"));
    expect(await screen.findByText(/Sub-hire SM58/)).toBeTruthy();
    expect(screen.getByText(/PRJ-1 — Big Show/)).toBeTruthy();
  });

  it("Reorder is on the sale-stock row only and goes to Sales stock filtered to the model", async () => {
    const user = userEvent.setup();
    render(<OverbookingsList />);
    await user.click(screen.getByRole("button", { name: "Gaffer Tape actions" }));
    await user.click(await screen.findByText("Reorder"));
    expect(nav.push).toHaveBeenCalledWith("/assets/sales-stock?q=Gaffer%20Tape");
  });

  it("Sub-hire… is ABSENT (not disabled) without subHire:create, while Open model stays", async () => {
    perms.allowed = new Set(["model:read"]);
    const user = userEvent.setup();
    render(<OverbookingsList />);
    await user.click(screen.getByRole("button", { name: "SM58 actions" }));
    expect(await screen.findByText("Open model")).toBeTruthy();
    expect(screen.queryByText("Sub-hire…")).toBeNull();
  });

  it("Reorder is ABSENT without model:read (the Sales stock page it opens needs it)", async () => {
    perms.allowed = new Set(["subHire:create"]);
    const user = userEvent.setup();
    render(<OverbookingsList />);
    await user.click(screen.getByRole("button", { name: "Gaffer Tape actions" }));
    expect(await screen.findByText("Open job")).toBeTruthy();
    expect(screen.queryByText("Reorder")).toBeNull();
  });

  it("Open model is ABSENT without model:read, and a caller with neither right still gets Open job", async () => {
    perms.allowed = new Set();
    const user = userEvent.setup();
    render(<OverbookingsList />);
    await user.click(screen.getByRole("button", { name: "SM58 actions" }));
    expect(await screen.findByText("Open job")).toBeTruthy();
    expect(screen.queryByText("Open model")).toBeNull();
    expect(screen.queryByText("Sub-hire…")).toBeNull();
  });

  it("the old ?days= link becomes the strip word and is dropped from the URL", () => {
    nav.search = "days=30";
    render(<OverbookingsList />);
    expect(nav.replace).toHaveBeenCalledWith("/overbookings?seg=month");
  });
});
