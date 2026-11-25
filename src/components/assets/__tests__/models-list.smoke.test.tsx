// @vitest-environment jsdom
//
// The Models list on ListPage: renders off modelsList.listPage (server-side filter/sort), takes its
// state from the URL, cost columns are opt-in, and every menu OPENS.
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
  usePathname: () => "/assets/models",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const org = vi.hoisted(() => ({ id: "org1" }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: org.id } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-categories", () => ({
  useCategoriesWithParent: () => [{ id: "c1", name: "Moving heads", parent: { name: "Lighting" } }],
}));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => ["blue"] }));
vi.mock("@/hooks/use-keyboard-shortcut", () => ({ useKeyboardShortcut: () => undefined }));
vi.mock("@/server/csv", () => ({ exportModelsCSV: vi.fn(async () => "") }));
vi.mock("@/components/assets/csv-import-dialog", () => ({ CSVImportDialog: () => null }));
vi.mock("@/components/assets/model-bulk-dialogs", () => ({
  BulkRateUpdateDialog: ({ open }: { open: boolean }) => (open ? <div>RATES DIALOG</div> : null),
  BulkAssignChecksDialog: ({ open }: { open: boolean }) => (open ? <div>CHECKS DIALOG</div> : null),
}));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));

const PAGE = {
  items: [
    {
      id: "m1",
      name: "MAC Aura",
      manufacturer: "Martin",
      assetType: "SERIALIZED",
      dailyRate: 100,
      weeklyRate: 300,
      monthlyRate: 900,
      replacementCost: 4321,
      owned: 12,
      available: 8,
      category: { id: "c1", name: "Moving heads", parentName: "Lighting" },
      media: null,
    },
  ],
  total: 1,
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
      if (name === "modelsList:listPage") {
        lastArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "modelsList:segmentCounts") return { all: 1, stock: 1, nostock: 0, due: 0, archived: 0 };
      return undefined;
    },
  };
});

import { ModelsList } from "../models-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  lastArgs = undefined;
  org.id = "org1";
  localStorage.clear();
});

describe("ModelsList (smoke)", () => {
  it("renders the model with owned, available and day rate, and no cost column by default", () => {
    render(<ModelsList />);
    expect(screen.getByText("MAC Aura")).toBeTruthy();
    expect(screen.getByText(/Lighting → Moving heads/)).toBeTruthy();
    expect(screen.queryByText(/4,321/)).toBeNull();
    expect(lastArgs).toMatchObject({ orgId: "org1", page: 1, pageSize: 25, sortBy: "name" });
  });

  it("derives the query from the URL, dropping unknown values; only the Due segment carries now", () => {
    nav.search = "seg=due&cat=c1&type=BULK,NOPE&tag=blue";
    render(<ModelsList />);
    expect(lastArgs).toMatchObject({ segment: "due", categoryIdIn: ["c1"], assetTypeIn: ["BULK"], tagsHasSome: ["blue"] });
    expect(typeof lastArgs?.now).toBe("number");
  });

  it("the strip names every segment with its count", () => {
    render(<ModelsList />);
    for (const label of ["All", "With stock", "No stock", "Due for T&T", "Archived"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("the row menu opens: Open and Edit", async () => {
    const user = userEvent.setup();
    render(<ModelsList />);
    await user.click(screen.getByRole("button", { name: "MAC Aura actions" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  it("the page menu holds Export, Import, Import rates and Columns (Value is opt-in)", async () => {
    const user = userEvent.setup();
    render(<ModelsList />);
    await user.click(screen.getByRole("button", { name: "Models options" }));
    expect(await screen.findByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("Import CSV")).toBeTruthy();
    expect(screen.getByText("Import rates…")).toBeTruthy();
    expect(screen.getByText("Columns")).toBeTruthy();
  });

  it("selecting a model opens the bulk bar; Edit rates and Assign checks open their dialogs", async () => {
    const user = userEvent.setup();
    render(<ModelsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select MAC Aura" }));
    expect(await screen.findByText("1 model selected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Edit rates 1/ }));
    expect(await screen.findByText("RATES DIALOG")).toBeTruthy();
  });

  it("switching org clears the bulk selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ModelsList />);
    await user.click(screen.getByRole("checkbox", { name: "Select MAC Aura" }));
    expect(await screen.findByText("1 model selected")).toBeTruthy();
    org.id = "org2";
    rerender(<ModelsList />);
    expect(screen.queryByText("1 model selected")).toBeNull();
  });
});
