// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix (docs/designs/perf-convex-efficiency-2026-06.md):
// AssetTable used to mount 5 whole-org live subscriptions (useAssets/useBulkAssets/
// useModels/useLocations/useCategories) and filter/sort/paginate client-side. It now
// calls assets.listPage / bulkAssets.listPage (server-side filtered + paginated) via
// useAuthedQuery. This test pins that AssetTable renders correctly off a listPage-shaped
// page — no live Convex client needed.
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
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-asset-writes", () => ({ useAssetWrites: () => ({}) }));
vi.mock("@/hooks/use-warehouse-writes", () => ({ useWarehouseWrites: () => ({}) }));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/server/csv", () => ({
  exportAssetsCSV: vi.fn(async () => ""),
  exportBulkAssetsCSV: vi.fn(async () => ""),
}));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: { assetPhotos: {}, modelPhotos: {} } }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => ({ assetPhotos: {}, modelPhotos: {} })) }),
  useConvexAuth: () => ({ isAuthenticated: true }),
  useMutation: () => vi.fn(async () => undefined),
}));

const currentFilters: Record<string, string | string[] | undefined> = {};
vi.mock("@/lib/use-table-preferences", () => ({
  useTablePreferences: () => ({
    sortBy: "assetTag",
    sortOrder: "asc" as const,
    view: "serialized" as const,
    pageSize: 25,
    page: 1,
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    setView: vi.fn(),
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

const ASSET_PAGE = {
  assets: [
    {
      id: "a1",
      assetTag: "AV-001",
      status: "AVAILABLE",
      condition: "GOOD",
      tags: [],
      modelId: "m1",
      model: { id: "m1", name: "Shure QLXD Receiver", category: null },
      location: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};
const EMPTY_BULK_PAGE = { bulkAssets: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };

let lastAssetsPageArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "assets:listPage") {
        lastAssetsPageArgs = args;
        return ASSET_PAGE;
      }
      if (name === "bulkAssets:listPage") return EMPTY_BULK_PAGE;
      return undefined;
    },
  };
});

import { AssetTable } from "../asset-table";

describe("AssetTable (smoke)", () => {
  it("renders a page of assets from assets.listPage (not a client-side whole-org filter)", () => {
    // Desktop table + mobile card both render in jsdom (the breakpoint that picks
    // one is a CSS media query, invisible here) — assert presence via getAllByText,
    // same pattern as data-table-cards.smoke.test.tsx.
    render(<AssetTable />);
    expect(screen.getAllByText("AV-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shure QLXD Receiver").length).toBeGreaterThan(0);
  });

  it("passes the current org id + default sort/page as listPage args", () => {
    render(<AssetTable />);
    expect(lastAssetsPageArgs).toMatchObject({
      orgId: "org1",
      sortBy: "assetTag",
      sortOrder: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("debounces the search box instead of firing a query per keystroke", async () => {
    render(<AssetTable />);
    const input = screen.getByPlaceholderText("Search by tag, serial, or name...");
    fireEvent.change(input, { target: { value: "shure" } });
    // Immediately after typing, the debounced value hasn't flushed yet — the args
    // passed to listPage should NOT already reflect the new search term.
    expect((lastAssetsPageArgs as { search?: string })?.search).toBeUndefined();
  });
});
