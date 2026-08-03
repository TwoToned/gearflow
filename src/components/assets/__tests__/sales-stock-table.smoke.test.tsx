// @vitest-environment jsdom
//
// Sales Stock tab (Assets -> Sales Stock, WS11 #950 follow-up): lists every
// active model's saleStockQuantity and offers a per-row restock action. This
// guards render correctness (oversold badge, restock dialog wiring) off a
// mocked useModels() list — no live Convex client needed.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
vi.mock("@/hooks/use-categories", () => ({ useCategoriesWithParent: () => [] }));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// DataTable's toolbar mounts SavedViewsMenu -> useSavedTableViews -> useAuthedQuery,
// which needs a live ConvexQueryCacheProvider ancestor to subscribe — stub the hook
// directly rather than fight the cache package's context requirement.
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => ({})) }),
  useConvexAuth: () => ({ isAuthenticated: false }),
  useMutation: () => vi.fn(async () => undefined),
}));

const adjustSaleStock = vi.fn(async () => ({ id: "m1", saleStockQuantity: 25 }));
vi.mock("@/hooks/use-model-writes", () => ({
  useModelWrites: () => ({ adjustSaleStock }),
}));

const MODELS = [
  { id: "m1", name: "Shure SM58", sku: "SM58", isActive: true, salePrice: 199, saleStockQuantity: 5, categoryId: undefined },
  { id: "m2", name: "Sennheiser G4", sku: "G4", isActive: true, salePrice: 450, saleStockQuantity: -2, categoryId: undefined },
];
vi.mock("@/hooks/use-models", () => ({ useModels: () => MODELS }));

import { SalesStockTable } from "../sales-stock-table";

describe("SalesStockTable (smoke)", () => {
  it("renders every active model with its sale price and stock", () => {
    render(<SalesStockTable />);
    expect(screen.getAllByText("Shure SM58").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sennheiser G4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$199.00").length).toBeGreaterThan(0);
  });

  it("badges a negative pool as oversold", () => {
    render(<SalesStockTable />);
    expect(screen.getAllByText(/-2 — oversold/).length).toBeGreaterThan(0);
  });

  it("opens the restock dialog and submits a delta", async () => {
    render(<SalesStockTable />);
    const [restockButton] = screen.getAllByRole("button", { name: /restock/i });
    fireEvent.click(restockButton);

    const input = await waitFor(() => screen.getByLabelText("Quantity"));
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(adjustSaleStock).toHaveBeenCalled());
  });
});
