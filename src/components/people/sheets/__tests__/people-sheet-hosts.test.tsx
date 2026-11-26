// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  search: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
  can: true,
  client: undefined as unknown,
  supplier: undefined as unknown,
  order: undefined as unknown,
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => h.params,
  useSearchParams: () => h.search,
  usePathname: () => "/here",
  useRouter: () => ({ replace: h.replace, push: h.push }),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }), useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => h.can }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined, isLoading: true }) }));
vi.mock("@/hooks/use-clients", () => ({ useClient: () => h.client }));
vi.mock("@/hooks/use-suppliers", () => ({ useSupplier: () => h.supplier }));
vi.mock("@/hooks/use-supplier-orders", () => ({ useSupplierOrderDetail: () => h.order }));
vi.mock("../client-sheet", () => ({ ClientSheet: (p: { initialData?: { name: string } }) => <div>client-sheet:{p.initialData?.name ?? "new"}</div> }));
vi.mock("../supplier-sheet", () => ({ SupplierSheet: (p: { initialData?: { name: string } }) => <div>supplier-sheet:{p.initialData?.name ?? "new"}</div> }));
vi.mock("../crew-sheet", () => ({ CrewSheet: () => <div>crew-sheet:new</div> }));
vi.mock("../order-sheet", () => ({ OrderSheet: (p: { initialData?: { orderNumber: string }; supplierName: string }) => <div>order-sheet:{p.initialData?.orderNumber ?? "new"}:{p.supplierName}</div> }));

import { ClientSheetHost, CrewSheetHost, SupplierSheetHost } from "../people-sheet-hosts";

const at = (params: Record<string, string>, qs: string) => { h.params = params; h.search = new URLSearchParams(qs); };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.can = true;
  h.client = { id: "k1", name: "Hilton", isActive: true, tags: [] };
  h.supplier = { id: "s1", name: "Scene", isActive: true, tags: [] };
  h.order = { id: "o1", orderNumber: "PO-1", type: "PURCHASE", status: "DRAFT", supplier: { name: "Scene" } };
});

describe("the URL opens the sheet", () => {
  it("clients: ?new=1 on the list creates, ?edit=1 on a record edits, no param renders nothing", () => {
    at({}, "new=1");
    render(<ClientSheetHost />);
    expect(screen.getByText("client-sheet:new")).toBeTruthy();
    cleanup(); at({ id: "k1" }, "edit=1");
    render(<ClientSheetHost />);
    expect(screen.getByText("client-sheet:Hilton")).toBeTruthy();
    cleanup(); at({ id: "k1" }, "");
    render(<ClientSheetHost />);
    expect(screen.queryByText(/client-sheet/)).toBeNull();
  });

  it("suppliers: new, edit, new-order on a supplier and edit on an order each open their own sheet", () => {
    at({}, "new=1"); render(<SupplierSheetHost />);
    expect(screen.getByText("supplier-sheet:new")).toBeTruthy();
    cleanup(); at({ id: "s1" }, "edit=1"); render(<SupplierSheetHost />);
    expect(screen.getByText("supplier-sheet:Scene")).toBeTruthy();
    cleanup(); at({ id: "s1" }, "new-order=1"); render(<SupplierSheetHost />);
    expect(screen.getByText("order-sheet:new:Scene")).toBeTruthy();
    cleanup(); at({ id: "s1", orderId: "o1" }, "edit=1"); render(<SupplierSheetHost />);
    expect(screen.getByText("order-sheet:PO-1:Scene")).toBeTruthy();
  });

  it("crew: ?new=1 on the list opens the create sheet (and an id with ?new=1 does not)", () => {
    at({}, "new=1"); render(<CrewSheetHost />);
    expect(screen.getByText("crew-sheet:new")).toBeTruthy();
    cleanup(); at({ id: "c1" }, "new=1"); render(<CrewSheetHost />);
    expect(screen.queryByText(/crew-sheet/)).toBeNull();
  });
});

describe("a gated or unknown target never opens an empty or forbidden sheet", () => {
  it("without the permission nothing renders", () => {
    h.can = false;
    at({}, "new=1"); render(<ClientSheetHost />);
    expect(screen.queryByText(/client-sheet/)).toBeNull();
  });

  it("an unknown client says so once and closes (drops the param)", () => {
    h.client = null;
    at({ id: "nope" }, "edit=1&tab=notes");
    render(<ClientSheetHost />);
    expect(h.toastError).toHaveBeenCalledWith("Client not found");
    expect(h.replace).toHaveBeenCalledWith("/here?tab=notes", { scroll: false });
    expect(screen.queryByText(/client-sheet/)).toBeNull();
  });
});
