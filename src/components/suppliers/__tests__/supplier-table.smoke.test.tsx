// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix (docs/designs/perf-convex-efficiency-2026-06.md):
// SupplierTable used to mount a whole-org useSuppliers live subscription and
// filter/sort/paginate client-side. It now calls suppliers.listPage
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
vi.mock("@/hooks/use-supplier-counts", () => ({
  useSupplierCounts: () => ({}),
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

const SUPPLIERS_PAGE = {
  items: [{ id: "s1", name: "Acme Rentals", isActive: true, tags: [] }],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastSuppliersPageArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "suppliers:listPage") {
        lastSuppliersPageArgs = args;
        return SUPPLIERS_PAGE;
      }
      return undefined;
    },
  };
});

import { SupplierTable } from "../supplier-table";

describe("SupplierTable (smoke)", () => {
  it("renders a page of suppliers from suppliers.listPage (not a client-side whole-org filter)", () => {
    render(<SupplierTable />);
    expect(screen.getAllByText("Acme Rentals").length).toBeGreaterThan(0);
  });

  it("passes the current org id + default sort/page as listPage args", () => {
    render(<SupplierTable />);
    expect(lastSuppliersPageArgs).toMatchObject({
      orgId: "org1",
      sortBy: "name",
      sortOrder: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<SupplierTable />);
    const input = screen.getByPlaceholderText("Search by name, contact, account #...");
    fireEvent.change(input, { target: { value: "acme" } });
    expect((lastSuppliersPageArgs as { search?: string })?.search).toBeUndefined();
  });
});
