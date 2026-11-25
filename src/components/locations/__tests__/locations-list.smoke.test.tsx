// @vitest-environment jsdom
//
// The Locations list on ListPage: capacity, fill and Last movement ("—" when absent), strip from the URL,
// every menu OPENS, and Move contents's toast Undo is the ONE closure calling the exact server Undo.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.print = vi.fn();
});

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/locations",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-keyboard-shortcut", () => ({ useKeyboardShortcut: () => undefined }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [{ id: "w", name: "Warehouse A" }, { id: "v", name: "Van 2" }] }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));
const writes = vi.hoisted(() => ({
  moveContents: vi.fn(async () => ({ auditId: "aud1", moved: 4, skipped: [{ reason: "out on a job", count: 1 }] })),
  undoMoveContents: vi.fn(async () => ({ restored: 4, left: 0 })),
  setLabelsPrinted: vi.fn(async () => ({ count: 1 })),
  remove: vi.fn(async () => ({ id: "x" })),
}));
vi.mock("@/hooks/use-location-writes", () => ({ useLocationWrites: () => writes }));
const toasts = vi.hoisted(() => ({ last: undefined as undefined | { title: string; opts?: { action?: { onClick: () => void } } } }));
vi.mock("sonner", () => ({
  toast: { success: (title: string, opts?: { action?: { onClick: () => void } }) => void (toasts.last = { title, opts }), error: vi.fn() },
}));
vi.mock("react-qr-code", () => ({ default: () => <svg data-testid="qr" /> }));

const PAGE = {
  items: [
    { id: "w", name: "Warehouse A", type: "WAREHOUSE", address: null, tags: [], parentName: null, stored: 412, binCount: 11, capacity: 600, fill: 69, lastMovement: null, labelState: "printed" },
    { id: "v", name: "Van 2", type: "VEHICLE", address: null, tags: [], parentName: null, stored: 0, binCount: 0, capacity: null, fill: null, lastMovement: 1_700_000_000_000, labelState: "not-printed" },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};
let lastArgs: Record<string, unknown> | undefined;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "locationsList:listPage") {
        lastArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "locationsList:segmentCounts") return { all: 2, warehouses: 1, vehicles: 1, sites: 0, empty: 1 };
      return undefined;
    },
  };
});

import { LocationsList } from "../locations-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  for (const f of Object.values(writes)) f.mockClear();
  toasts.last = undefined;
  lastArgs = undefined;
});

describe("LocationsList (smoke)", () => {
  it("prints capacity with fill, 'not set' without one, and a dash for a location that never recorded a movement", () => {
    render(<LocationsList />);
    expect(screen.getByText("412 / 600 · 69%")).toBeTruthy();
    expect(screen.getByText("not set")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/11 bins/)).toBeTruthy();
    expect(lastArgs).toMatchObject({ orgId: "org1", sortBy: "name" });
  });

  it("the strip words come from the URL: Sites maps to the sites segment", () => {
    nav.search = "seg=sites&type=VENUE,NOPE";
    render(<LocationsList />);
    for (const label of ["All", "Warehouses", "Vehicles", "Sites", "Empty"]) expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    expect(lastArgs).toMatchObject({ segment: "sites", typeIn: ["VENUE"] });
  });

  it("the row menu opens with Open, Edit, Move contents, Print bin label and Delete last", async () => {
    const user = userEvent.setup();
    render(<LocationsList />);
    await user.click(screen.getByRole("button", { name: "Warehouse A actions" }));
    for (const t of ["Open", "Edit", "Move contents…", "Print bin label", "Delete…"]) expect(await screen.findByText(t)).toBeTruthy();
  });

  it("Move contents: choose a destination, the toast names what was skipped, and Undo is the exact server Undo, once", async () => {
    const user = userEvent.setup();
    render(<LocationsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Warehouse A" }));
    await user.click(await screen.findByRole("button", { name: /Move contents 1/ }));
    await user.click(await screen.findByRole("combobox", { name: "Move to" }));
    await user.click(await screen.findByRole("option", { name: "Van 2" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(writes.moveContents).toHaveBeenCalledWith(["w"], "v");
    await vi.waitFor(() => expect(toasts.last?.title).toBe("Moved 4 items to Van 2 · skipped 1 (1 out on a job)"));
    toasts.last?.opts?.action?.onClick();
    toasts.last?.opts?.action?.onClick();
    await vi.waitFor(() => expect(writes.undoMoveContents).toHaveBeenCalledTimes(1));
    expect(writes.undoMoveContents).toHaveBeenCalledWith("aud1");
  });

  it("Print bin labels opens the sheet; with a mix it offers unprinted only and records exactly those printed", async () => {
    const user = userEvent.setup();
    render(<LocationsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Warehouse A" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Van 2" }));
    await user.click(await screen.findByRole("button", { name: /Print bin labels 2/ }));
    expect(await screen.findByText("Print bin labels")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Unprinted only \(1\)/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Print 1" }));
    expect(writes.setLabelsPrinted).toHaveBeenCalledWith(["v"]);
  });
});
