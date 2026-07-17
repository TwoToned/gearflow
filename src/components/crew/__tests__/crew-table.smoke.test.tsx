// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix (docs/designs/perf-convex-efficiency-2026-06.md):
// CrewTable used to mount 2 whole-org live subscriptions (useCrewMembers/useCrewRoles)
// and filter/join/sort/paginate client-side. It now calls crewMembers.listPage
// (server-side filter + sort + crewRole join) via useAuthedQuery.
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
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: {} }),
}));

const currentFilters: Record<string, string | string[] | undefined> = {};
vi.mock("@/lib/use-table-preferences", () => ({
  useTablePreferences: () => ({
    sortBy: "lastName",
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

const CREW_PAGE = {
  items: [
    {
      id: "cm1",
      firstName: "Alice",
      lastName: "Smith",
      status: "ACTIVE",
      type: "EMPLOYEE",
      tags: [],
      crewRole: { id: "role1", name: "Sound Engineer", color: "#123456" },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastCrewPageArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "crewMembers:listPage") {
        lastCrewPageArgs = args;
        return CREW_PAGE;
      }
      return undefined;
    },
  };
});
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => ({})) }),
  useConvexAuth: () => ({ isAuthenticated: true }),
  useMutation: () => vi.fn(async () => undefined),
}));

import { CrewTable } from "../crew-table";

describe("CrewTable (smoke)", () => {
  it("renders a page of crew from crewMembers.listPage (not a client-side whole-org filter)", () => {
    render(<CrewTable />);
    expect(screen.getAllByText("Alice Smith").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sound Engineer").length).toBeGreaterThan(0);
  });

  it("passes the current org id + default sort/page as listPage args", () => {
    render(<CrewTable />);
    expect(lastCrewPageArgs).toMatchObject({
      orgId: "org1",
      sortBy: "lastName",
      sortOrder: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<CrewTable />);
    const input = screen.getByPlaceholderText("Search by name, email, department...");
    fireEvent.change(input, { target: { value: "alice" } });
    expect((lastCrewPageArgs as { search?: string })?.search).toBeUndefined();
  });
});
