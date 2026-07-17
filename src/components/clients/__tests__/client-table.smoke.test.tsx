// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix (docs/designs/perf-convex-efficiency-2026-06.md):
// ClientTable used to mount a whole-org useClients live subscription and
// filter/sort/paginate client-side. It now calls clients.listPage
// (server-side filter + sort) via useAuthedQuery.
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
vi.mock("@/hooks/use-client-project-counts", () => ({
  useClientProjectCounts: () => ({}),
}));
vi.mock("@/hooks/use-native-client-writes", () => ({
  useClientWrites: () => ({ bulkArchive: vi.fn(async () => ({ archived: 0 })) }),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => undefined),
}));

const currentFilters: Record<string, string | string[] | undefined> = {};
vi.mock("@/lib/use-table-preferences", () => ({
  useTablePreferences: () => ({
    sortBy: "name",
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

const CLIENTS_PAGE = {
  items: [
    { id: "c1", name: "Acme Corp", type: "COMPANY", isActive: true, tags: [] },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastClientsPageArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "clients:listPage") {
        lastClientsPageArgs = args;
        return CLIENTS_PAGE;
      }
      return undefined;
    },
  };
});

import { ClientTable } from "../client-table";

describe("ClientTable (smoke)", () => {
  it("renders a page of clients from clients.listPage (not a client-side whole-org filter)", () => {
    render(<ClientTable />);
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThan(0);
  });

  it("passes the current org id + default sort/page as listPage args", () => {
    render(<ClientTable />);
    expect(lastClientsPageArgs).toMatchObject({
      orgId: "org1",
      sortBy: "name",
      sortOrder: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<ClientTable />);
    const input = screen.getByPlaceholderText("Search by name, contact, or email...");
    fireEvent.change(input, { target: { value: "acme" } });
    expect((lastClientsPageArgs as { search?: string })?.search).toBeUndefined();
  });
});
