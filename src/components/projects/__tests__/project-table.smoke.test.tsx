// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix (docs/designs/perf-convex-efficiency-2026-06.md):
// ProjectTable used to mount 3 whole-org live subscriptions (useProjects/useClients/
// useLocations) and filter/join/sort/paginate client-side. It now calls
// projects.listPage (server-side filter + sort + client/location joins) via
// useAuthedQuery. This test pins that the table renders off a listPage-shaped page.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => undefined),
}));
vi.mock("@/server/projects", () => ({
  getProjectIssueFlags: vi.fn(async () => ({})),
}));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: {} }),
}));

const currentFilters: Record<string, string | string[] | undefined> = {};
vi.mock("@/lib/use-table-preferences", () => ({
  useTablePreferences: () => ({
    sortBy: "rentalStartDate",
    sortOrder: "asc" as const,
    pageSize: 25,
    page: 1,
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    handleSort: vi.fn(),
    columnVisibility: {},
    toggleColumnVisibility: vi.fn(),
    resetPreferences: vi.fn(),
    filters: currentFilters,
    setFilter: vi.fn(),
    currentConfig: undefined,
    applyConfig: vi.fn(),
  }),
}));

const PROJECTS_PAGE = {
  items: [
    {
      id: "p1",
      projectNumber: "P-001",
      name: "Splendour Main Stage",
      status: "CONFIRMED",
      type: "FESTIVAL",
      client: { name: "Acme Corp" },
      tags: [],
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastProjectsPageArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "projects:listPage") {
        lastProjectsPageArgs = args;
        return PROJECTS_PAGE;
      }
      return undefined;
    },
  };
});

import { ProjectTable } from "../project-table";

describe("ProjectTable (smoke)", () => {
  it("renders a page of projects from projects.listPage (not a client-side whole-org filter)", () => {
    render(<ProjectTable />);
    expect(screen.getAllByText("Splendour Main Stage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThan(0);
  });

  it("passes the current org id + default sort/page as listPage args", () => {
    render(<ProjectTable />);
    expect(lastProjectsPageArgs).toMatchObject({
      orgId: "org1",
      sortBy: "rentalStartDate",
      sortOrder: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<ProjectTable />);
    const input = screen.getByPlaceholderText("Search by name, project #, or location...");
    fireEvent.change(input, { target: { value: "splendour" } });
    expect((lastProjectsPageArgs as { search?: string })?.search).toBeUndefined();
  });
});
