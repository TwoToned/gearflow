// @vitest-environment jsdom
//
// The Assets registry on ListPage: renders off assets.listPage / bulkAssets.listPage
// (server-side filter/sort, never a client-side whole-org filter), takes its state from
// the URL (Table is the default; Kind switches the list), and every menu OPENS.
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
  usePathname: () => "/assets/registry",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const org = vi.hoisted(() => ({ id: "org1" }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: org.id } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [{ id: "l1", name: "Warehouse" }] }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [{ id: "c1", name: "Lighting" }] }));
vi.mock("@/hooks/use-models", () => ({ useModels: () => [{ id: "m1", name: "Par 64" }] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => ["blue"] }));
vi.mock("@/hooks/use-asset-writes", () => ({ useAssetWrites: () => ({ archive: vi.fn(async () => ({ ok: true })) }) }));
vi.mock("@/hooks/use-warehouse-writes", () => ({ useWarehouseWrites: () => ({ bulkForceReturnAssets: vi.fn() }) }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: { assetPhotos: {}, modelPhotos: {} } }) }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => ({})) }),
  useConvexAuth: () => ({ isAuthenticated: true }),
  useMutation: () => vi.fn(async () => undefined),
}));
vi.mock("@/server/csv", () => ({ exportAssetsCSV: vi.fn(async () => ""), exportBulkAssetsCSV: vi.fn(async () => "") }));
vi.mock("@/components/assets/asset-gallery", () => ({ AssetGallery: () => <div>GALLERY</div> }));
vi.mock("@/components/assets/csv-import-dialog", () => ({ CSVImportDialog: () => null }));
vi.mock("@/components/assets/bulk-asset-dialogs", () => ({
  BulkEditDialog: () => null,
  BulkAddTagsDialog: () => null,
}));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));

const ASSET_PAGE = {
  assets: [
    {
      id: "a1",
      assetTag: "AV-001",
      modelId: "m1",
      status: "CHECKED_OUT",
      condition: "GOOD",
      tags: [],
      model: { name: "Par 64", category: { name: "Lighting" } },
      location: { name: "Warehouse" },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  dueCap: null,
};
const BULK_PAGE = {
  bulkAssets: [{ id: "b1", assetTag: "XLR-1", modelId: "m1", status: "ACTIVE", totalQuantity: 10, availableQuantity: 7, tags: [], model: { name: "XLR", category: null }, location: null }],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

let lastAssetArgs: Record<string, unknown> | undefined;
let lastBulkArgs: Record<string, unknown> | undefined;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "assets:listPage") {
        lastAssetArgs = args as Record<string, unknown>;
        return ASSET_PAGE;
      }
      if (name === "bulkAssets:listPage") {
        lastBulkArgs = args as Record<string, unknown>;
        return BULK_PAGE;
      }
      if (name === "assets:rowExtras") return { a1: { nextDue: null, job: { id: "p1", name: "Gig", number: "P-1" } } };
      return undefined;
    },
  };
});

import { AssetsList } from "../assets-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  lastAssetArgs = undefined;
  lastBulkArgs = undefined;
  org.id = "org1";
  localStorage.clear();
});

describe("AssetsList (smoke)", () => {
  it("defaults to the Table of serialized assets with the job it is out on", () => {
    render(<AssetsList />);
    expect(screen.getByText("AV-001")).toBeTruthy();
    expect(screen.getByText("P-1 Gig")).toBeTruthy();
    expect(lastBulkArgs).toBeUndefined();
    expect(lastAssetArgs).toMatchObject({ orgId: "org1", page: 1, pageSize: 25, sortBy: "assetTag" });
  });

  it("derives the query from the URL, dropping unknown values; the T&T segments carry a stable now", () => {
    nav.search = "seg=due&status=AVAILABLE,NOPE&condition=BOGUS&loc=l1&tag=blue";
    render(<AssetsList />);
    expect(lastAssetArgs).toMatchObject({ segment: "due", statusIn: ["AVAILABLE"], locationIdIn: ["l1"], tagsHasSome: ["blue"] });
    expect(lastAssetArgs?.conditionIn).toBeUndefined();
    expect(typeof lastAssetArgs?.now).toBe("number");
  });

  it("kind=bulk switches to bulkAssets.listPage with its own columns and only the segments that apply", () => {
    nav.search = "kind=bulk";
    render(<AssetsList />);
    expect(screen.getByText("XLR-1")).toBeTruthy();
    expect(lastAssetArgs).toBeUndefined();
    expect(lastBulkArgs).toMatchObject({ orgId: "org1" });
    expect(screen.queryByRole("tab", { name: /Due for T&T/ })).toBeNull();
  });

  it("view=grid shows the gallery and hides the segments and filters it ignores", () => {
    nav.search = "view=grid";
    render(<AssetsList />);
    expect(screen.getByText("GALLERY")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Needs attention/ })).toBeNull();
  });

  it("the row menu opens: Open, Edit and Retire last", async () => {
    const user = userEvent.setup();
    render(<AssetsList />);
    await user.click(screen.getByRole("button", { name: "AV-001 actions" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Retire")).toBeTruthy();
  });

  it("the page menu holds Export and Import; Columns holds the opt-in Tags", async () => {
    const user = userEvent.setup();
    render(<AssetsList />);
    await user.click(screen.getByRole("button", { name: "Assets options" }));
    expect(await screen.findByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("Import CSV")).toBeTruthy();
    expect(screen.getByText("Columns")).toBeTruthy();
  });

  it("selecting an asset opens the bulk bar with Edit, Add tag, Force return (deployed) and Retire", async () => {
    const user = userEvent.setup();
    render(<AssetsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select AV-001" }));
    expect(await screen.findByText("1 asset selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add tag 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Force return 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retire 1/ })).toBeTruthy();
  });

  it("switching org clears the bulk selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AssetsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select AV-001" }));
    expect(await screen.findByText("1 asset selected")).toBeTruthy();
    org.id = "org2";
    rerender(<AssetsList />);
    expect(screen.queryByText("1 asset selected")).toBeNull();
  });
});
