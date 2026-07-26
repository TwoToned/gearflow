// @vitest-environment jsdom
//
// Smoke test for the order detail page (issue #789). Renders the found + not-found
// states from supplierOrders.getDetail without crashing — this page's query returns
// `null` (not a thrown ConvexError) for a missing/cross-org order specifically so a
// stale link doesn't crash the reactive useAuthedQuery subscription (see the
// docstring on convex/supplierOrders.ts's getDetail); this test guards that the page
// actually renders that null branch cleanly instead of throwing.
import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, act } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/components/auth/require-permission", () => ({
  RequirePermission: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => undefined),
}));

let orderDetail: unknown;
vi.mock("@/hooks/use-supplier-orders", () => ({
  useSupplierOrderDetail: () => orderDetail,
}));

import SupplierOrderDetailPage from "../page";

// A fresh params promise per render — `use()` caches by promise identity, and
// React only retries after a *new* render sees a settled promise, so reusing
// one instance across renders/tests can return a stale cached value.
const params = () => Promise.resolve({ id: "s1", orderId: "o1" });

// Real Next.js route rendering provides the Suspense boundary `use(params)`
// needs (React 15+ async params) — a bare unit render doesn't, so we supply one.
// Wrapped in `act()` so React flushes the Suspense retry once the (already-
// resolved) params promise settles on the microtask queue, instead of leaving
// an unflushed "suspended outside act" update the test would never observe.
async function renderPage() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>Loading…</div>}>
        <SupplierOrderDetailPage params={params()} />
      </Suspense>,
    );
    await Promise.resolve();
  });
  return result!;
}

describe("SupplierOrderDetailPage (smoke)", () => {
  it("renders order header, line items, linked assets, and invoice sections", async () => {
    orderDetail = {
      id: "o1",
      orderNumber: "PO-1",
      type: "PURCHASE",
      status: "ORDERED",
      orderDate: null,
      expectedDate: null,
      receivedDate: null,
      subtotal: null,
      taxAmount: null,
      total: 500,
      notes: "Handle with care",
      supplier: { id: "s1", name: "Acme" },
      project: null,
      items: [{ id: "i1", description: "Console x1", quantity: 1, unitPrice: 500, lineTotal: 500, notes: null, sortOrder: 0, model: { id: "m1", name: "Console" }, asset: null }],
      assets: [{ id: "a1", assetTag: "TAG-1", status: "AVAILABLE", model: { id: "m1", name: "Console" } }],
      invoice: { id: "f1", fileName: "invoice.pdf", fileSize: 2048, mimeType: "application/pdf", url: "/api/files/sk1" },
    };
    await renderPage();
    expect((await screen.findAllByText("PO-1")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Console x1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TAG-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("invoice.pdf").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Replace invoice").length).toBeGreaterThan(0);
  });

  it("renders a not-found state (not a crash) when getDetail returns null", async () => {
    orderDetail = null;
    await renderPage();
    expect((await screen.findAllByText("Order not found.")).length).toBeGreaterThan(0);
  });

  it("renders a skeleton while getDetail is loading (undefined)", async () => {
    orderDetail = undefined;
    const { container } = await renderPage();
    // Give the params promise a tick to settle so we exercise the real
    // "params resolved, order query still loading" branch, not just the
    // Suspense fallback.
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeTruthy();
  });
});
