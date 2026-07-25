// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix (docs/designs/perf-convex-efficiency-2026-06.md):
// KitsPage used to mount 3 whole-org live subscriptions (useKits/useCategories/
// useLocations) and filter/join/sort/paginate client-side. It now calls
// kits.listPage (server-side filter + sort + category/location joins) via
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
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => true,
  useCurrentRole: () => ({
    role: "owner",
    roleName: "Owner",
    permissions: { kit: ["read", "create", "update", "delete"] },
    isLoading: false,
  }),
  useIsViewer: () => false,
}));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [] }));
vi.mock("@/hooks/use-kit-counts", () => ({ useKitCounts: () => ({}) }));
vi.mock("@/hooks/use-warehouse-writes", () => ({ useWarehouseWrites: () => ({}) }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => undefined),
}));

const currentFilters: Record<string, string | string[] | undefined> = {};
vi.mock("@/lib/use-table-preferences", () => ({
  useTablePreferences: () => ({
    sortBy: "assetTag",
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
    clearFilters: vi.fn(),
    currentConfig: undefined,
    applyConfig: vi.fn(),
  }),
}));

const KITS_PAGE = {
  items: [
    {
      id: "k1",
      assetTag: "KIT-001",
      name: "Drum Kit A",
      status: "AVAILABLE",
      tags: [],
      category: { id: "cat1", name: "Backline" },
      location: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastKitsPageArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "kits:listPage") {
        lastKitsPageArgs = args;
        return KITS_PAGE;
      }
      return undefined;
    },
  };
});

import KitsPage from "../page";

describe("KitsPage (smoke)", () => {
  it("renders a page of kits from kits.listPage (not a client-side whole-org filter)", () => {
    render(<KitsPage />);
    expect(screen.getAllByText("Drum Kit A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backline").length).toBeGreaterThan(0);
  });

  it("passes the current org id + default sort/page as listPage args", () => {
    render(<KitsPage />);
    expect(lastKitsPageArgs).toMatchObject({
      orgId: "org1",
      sortBy: "assetTag",
      sortOrder: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<KitsPage />);
    const input = screen.getByPlaceholderText("Search by tag or name...");
    fireEvent.change(input, { target: { value: "drum" } });
    expect((lastKitsPageArgs as { search?: string })?.search).toBeUndefined();
  });

  it("unwraps an enum filter (stored as string[]) to a single string before calling listPage", () => {
    // Regression test: filterType "enum" columns always store FilterValue as
    // string[] (src/lib/table-utils.ts), but kits.listPage's status/condition/
    // locationId/categoryId args are v.optional(v.string()) — passing the raw
    // array through throws a Convex ArgumentValidationError.
    currentFilters.status = ["AVAILABLE"];
    render(<KitsPage />);
    expect((lastKitsPageArgs as { status?: unknown })?.status).toBe("AVAILABLE");
    delete currentFilters.status;
  });
});
