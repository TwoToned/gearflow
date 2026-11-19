// @vitest-environment jsdom
//
// The Jobs page on ListPage: renders off a `projects.listPage` page (server-side
// filter/sort, never a client-side whole-org filter), takes its state from the
// URL, and every menu (row, page, bulk) actually OPENS.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const org = vi.hoisted(() => ({ id: "org1" }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: org.id } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/server/projects", () => ({ getProjectIssueFlags: vi.fn(async () => ({})) }));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: { p1: { hasOverbooked: true, hasReducedStock: false } } }),
}));
vi.mock("@/hooks/use-confirm-status-gate", () => ({
  useConfirmStatusGate: () => ({ requestStatusChange: vi.fn(), checking: false, pending: null, confirmPending: vi.fn(), cancelPending: vi.fn() }),
}));
vi.mock("@/hooks/use-native-project-writes", () => ({
  useNativeProjectStatus: () => ({ enabled: true, updateStatus: vi.fn(async () => undefined) }),
  useProjectWrites: () => ({ archive: vi.fn(), remove: vi.fn(), addTag: vi.fn(async () => ({ changed: [], full: [] })), removeTag: vi.fn(async () => ({ changed: [], full: [] })) }),
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn(async () => []) }) }));
vi.mock("@/components/projects/project-board", () => ({ ProjectBoard: ({ search }: { search?: string }) => <div>BOARD {search}</div> }));
vi.mock("@/hooks/use-org-members", () => ({
  useOrgMembers: () => ({ data: [{ userId: "u1", user: { name: "Pat PM" } }] }),
}));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));
vi.mock("@/components/projects/duplicate-project-dialog", () => ({
  DuplicateProjectDialog: ({ mode }: { mode: string }) => <div>DIALOG {mode}</div>,
}));

const PAGE = {
  items: [
    {
      id: "p1",
      projectNumber: "P-001",
      name: "Splendour Main Stage",
      status: "CONFIRMED",
      type: "FESTIVAL",
      client: { name: "Acme Corp" },
      tags: [],
      total: 1200,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastListArgs: Record<string, unknown> | undefined;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "projects:listPage") {
        lastListArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "projects:segmentCounts") return { all: 1, quoting: 0, booked: 1, out: 0, done: 0, needs: 0 };
      if (name === "clients:list") return [{ id: "c1", name: "Acme Corp" }];
      return undefined;
    },
  };
});

import { JobsList } from "../jobs-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  lastListArgs = undefined;
});

describe("JobsList (smoke)", () => {
  it("renders a page of jobs from projects.listPage with the client, a red flag and the segment counts", () => {
    render(<JobsList />);
    expect(screen.getByText("Splendour Main Stage")).toBeTruthy();
    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("Overbooked")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Booked/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New job" })).toBeTruthy();
  });

  it("derives the query from the URL: segment, filters, sort, page size 25 and a stable now", () => {
    nav.search = "seg=booked&status=CONFIRMED&sort=total:desc&show=cancelled";
    render(<JobsList />);
    expect(lastListArgs).toMatchObject({
      orgId: "org1",
      segment: "booked",
      statusIn: ["CONFIRMED"],
      sortBy: "total",
      sortOrder: "desc",
      includeCancelled: true,
      page: 1,
      pageSize: 25,
    });
    expect(typeof lastListArgs?.now).toBe("number");
  });

  it("?view=board still shows the board, passes the search through and hides what it ignores", async () => {
    nav.search = "view=board&q=hilton&status=QUOTED";
    const user = userEvent.setup();
    render(<JobsList />);
    expect(screen.getByText("BOARD hilton")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Segments" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Status/ })).toBeNull();
    expect(screen.queryByText("Clear filters")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Jobs options" }));
    expect(await screen.findByText("Templates")).toBeTruthy();
    expect(screen.queryByText("Show cancelled")).toBeNull();
  });

  it("⋯ › Columns opts PM in and keeps it in localStorage colVis", async () => {
    const user = userEvent.setup();
    localStorage.removeItem("colVis");
    render(<JobsList />);
    expect(screen.queryByRole("columnheader", { name: "PM" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Jobs options" }));
    // Keyboard-open the submenu: pointer grace-area logic is not reliable in jsdom.
    (await screen.findByRole("menuitem", { name: /Columns/ })).focus();
    await user.keyboard("{ArrowRight}");
    (await screen.findByRole("menuitem", { name: "Show PM" })).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("columnheader", { name: "PM" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("colVis") ?? "{}").jobs).toEqual(["pm"]);
  });

  it("the row menu opens with its verbs; Cancel job is last", async () => {
    const user = userEvent.setup();
    render(<JobsList />);
    await user.click(screen.getByRole("button", { name: "Splendour Main Stage actions" }));
    expect(await screen.findByText("Set status")).toBeTruthy();
    expect(screen.getByText("Duplicate")).toBeTruthy();
    expect(screen.getByText("Save as template")).toBeTruthy();
    expect(screen.getByText("Cancel job")).toBeTruthy();
  });

  it("the page menu holds Templates, Overbookings and Show cancelled", async () => {
    const user = userEvent.setup();
    render(<JobsList />);
    await user.click(screen.getByRole("button", { name: "Jobs options" }));
    expect(await screen.findByText("Templates")).toBeTruthy();
    expect(screen.getByText("Overbookings")).toBeTruthy();
    await user.click(screen.getByText("Show cancelled"));
    expect(nav.push).toHaveBeenCalledWith("/projects?show=cancelled", { scroll: false });
  });

  it("selecting a job opens the bulk bar; Add tag opens its prompt", async () => {
    const user = userEvent.setup();
    render(<JobsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Splendour Main Stage" }));
    expect(await screen.findByText("1 job selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cancel 1 job/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Add tag 1/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Tag")).toBeTruthy();
  });

  it("switching org clears the bulk selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<JobsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Splendour Main Stage" }));
    expect(await screen.findByText("1 job selected")).toBeTruthy();
    org.id = "org2";
    rerender(<JobsList />);
    expect(screen.queryByText("1 job selected")).toBeNull();
    org.id = "org1";
  });
});
