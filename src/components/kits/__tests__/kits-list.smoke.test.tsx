// @vitest-environment jsdom
//
// The Kits list on ListPage: renders off kitsList.listPage (server-side, derived state), takes its state
// from the URL, and every menu OPENS. Force return appears only for a kit that is out.
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
});

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/kits",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const org = vi.hoisted(() => ({ id: "org1" }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: org.id } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [{ id: "c1", name: "Backline" }] }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [{ id: "l1", name: "Warehouse A" }] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-keyboard-shortcut", () => ({ useKeyboardShortcut: () => undefined }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));
const wh = vi.hoisted(() => ({ forceReturnKits: vi.fn(async (ids: string[]) => ({ count: ids.length, succeeded: ids, errors: [] })) }));
vi.mock("@/hooks/use-warehouse-writes", () => ({ useWarehouseWrites: () => wh }));
vi.mock("@/hooks/use-kit-writes", () => ({ useKitWrites: () => ({ markComplete: vi.fn(), undoMarkComplete: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const kit = (over: Record<string, unknown>) => ({
  id: "k1",
  assetTag: "K-0042",
  name: "Shure ULXD4Q",
  condition: "GOOD",
  tags: [],
  itemCount: 5,
  category: { name: "Audio" },
  location: { name: "Warehouse A" },
  media: null,
  state: { key: "AVAILABLE", missing: [], booking: null },
  ...over,
});
const PAGE = {
  items: [
    kit({ state: { key: "INCOMPLETE", missing: [{ label: "PA805", why: "lost" }], booking: null } }),
    kit({ id: "k2", assetTag: "K-0043", name: "Drum Kit", state: { key: "CHECKED_OUT", missing: [], booking: { projectNumber: "#2341", projectName: "Gig" } } }),
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
      if (name === "kitsList:listPage") {
        lastArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "kitsList:segmentCounts") return { all: 2, complete: 1, missing: 1, onjob: 1 };
      return undefined;
    },
  };
});

import { KitsList } from "../kits-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  wh.forceReturnKits.mockClear();
  lastArgs = undefined;
  org.id = "org1";
});

describe("KitsList (smoke)", () => {
  it("prints the derived state: a missing item is a red flag, the job a kit is out on is a fact", () => {
    render(<KitsList />);
    expect(screen.getByText("1 item missing")).toBeTruthy();
    expect(screen.getByText("#2341 Gig")).toBeTruthy();
    expect(lastArgs).toMatchObject({ orgId: "org1", page: 1, pageSize: 25, sortBy: "assetTag" });
    expect(typeof lastArgs?.now).toBe("number");
  });

  it("the strip names every segment with its count; Missing items comes from the URL", () => {
    nav.search = "seg=missing&cat=c1&loc=l1";
    render(<KitsList />);
    for (const label of ["All", "Complete", "Missing items", "On a job"]) expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    expect(lastArgs).toMatchObject({ segment: "missing", categoryIdIn: ["c1"], locationIdIn: ["l1"] });
  });

  it("the row menu offers Force return only on the kit that is out", async () => {
    const user = userEvent.setup();
    render(<KitsList />);
    await user.click(screen.getByRole("button", { name: "K-0042 actions" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByText("Force return…")).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "K-0043 actions" }));
    expect(await screen.findByText("Force return…")).toBeTruthy();
  });

  it("the bulk bar: Print list always, Force return n only when a selected kit is out, with a confirm", async () => {
    const user = userEvent.setup();
    render(<KitsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select K-0042" }));
    expect(await screen.findByRole("button", { name: /Print list 1/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Force return/ })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select K-0043" }));
    await user.click(await screen.findByRole("button", { name: /Force return 1/ }));
    expect(await screen.findByText("Force return the selected kits?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Force return" }));
    expect(wh.forceReturnKits).toHaveBeenCalledWith(["k2"]);
  });

  it("switching org clears the selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<KitsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select K-0042" }));
    expect(await screen.findByText("1 kit selected")).toBeTruthy();
    org.id = "org2";
    rerender(<KitsList />);
    expect(screen.queryByText("1 kit selected")).toBeNull();
  });
});
