// @vitest-environment jsdom
//
// The Sales stock list: derived On hand / Reserved / Available, the Adjust stock dialog OPENS from the
// row ⋯ and the bulk bar, and the toast's Undo is the ONE closure that calls the exact server Undo.
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
  usePathname: () => "/assets/sales-stock",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [{ id: "c1", name: "Consumables" }] }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));

const writes = vi.hoisted(() => ({
  adjustSaleStockMany: vi.fn(async (ids: string[]) => ({ auditIds: ids.map((i) => `aud-${i}`), count: ids.length })),
  undoSaleStock: vi.fn(async () => ({ restored: 1 })),
}));
vi.mock("@/hooks/use-model-writes", () => ({ useModelWrites: () => writes }));

const toasts = vi.hoisted(() => ({ last: undefined as undefined | { title: string; opts?: { action?: { onClick: () => void } } } }));
vi.mock("sonner", () => ({
  toast: { success: (title: string, opts?: { action?: { onClick: () => void } }) => void (toasts.last = { title, opts }), error: vi.fn() },
}));

const PAGE = {
  items: [
    { id: "m1", name: "Gaffer tape", sku: "GT-1", salePrice: 12, reorderLevel: 20, category: { name: "Consumables" }, onHand: 12, reserved: 12, available: 0, state: "OUT" },
    { id: "m2", name: "Batteries", sku: null, salePrice: 5, reorderLevel: 10, category: null, onHand: 8, reserved: 0, available: 8, state: "LOW" },
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
      if (name === "modelsList:saleStockPage") {
        lastArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "modelsList:saleStockSegmentCounts") return { all: 2, low: 1, out: 1 };
      return undefined;
    },
  };
});

import { SalesStockList } from "../sales-stock-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  writes.adjustSaleStockMany.mockClear();
  writes.undoSaleStock.mockClear();
  toasts.last = undefined;
  lastArgs = undefined;
});

describe("SalesStockList (smoke)", () => {
  it("prints the OUT and LOW flags inline and the strip", () => {
    render(<SalesStockList />);
    // The flag and the strip word share a label: two matches each (row flag + tab).
    expect(screen.getAllByText("Out of stock").length).toBe(2);
    expect(screen.getAllByText("Low stock").length).toBe(2);
    expect(screen.getByRole("tab", { name: /Out of stock/ })).toBeTruthy();
    expect(lastArgs).toMatchObject({ orgId: "org1", sortBy: "available" });
  });

  it("the primary `Reorder 1 low` only filters the list (a URL change, never a write)", async () => {
    const user = userEvent.setup();
    render(<SalesStockList />);
    await user.click(screen.getByRole("button", { name: "Reorder 1 low" }));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining("seg=low"), expect.anything());
    expect(writes.adjustSaleStockMany).not.toHaveBeenCalled();
  });

  it("row ⋯ opens, Adjust stock opens the dialog, Save writes once and Undo is the exact server Undo", async () => {
    const user = userEvent.setup();
    render(<SalesStockList />);
    await user.click(screen.getByRole("button", { name: "Gaffer tape actions" }));
    await user.click(await screen.findByText("Adjust stock…"));
    await user.type(await screen.findByLabelText("Quantity"), "20");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.adjustSaleStockMany).toHaveBeenCalledWith(["m1"], 20, undefined);
    expect(toasts.last?.title).toBe("+20 on 1 model");
    toasts.last?.opts?.action?.onClick();
    toasts.last?.opts?.action?.onClick();
    await vi.waitFor(() => expect(writes.undoSaleStock).toHaveBeenCalledTimes(1));
    expect(writes.undoSaleStock).toHaveBeenCalledWith(["aud-m1"]);
  });

  it("the bulk bar opens with Adjust stock n and Export n; a zero or blank quantity cannot save", async () => {
    const user = userEvent.setup();
    render(<SalesStockList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Gaffer tape" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Batteries" }));
    expect(await screen.findByRole("button", { name: /Export 2/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Adjust stock 2/ }));
    const save = await screen.findByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Quantity"), "0");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
