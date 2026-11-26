// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  client: { create: vi.fn(), update: vi.fn() },
  supplier: { create: vi.fn(), update: vi.fn() },
  crew: { create: vi.fn(), update: vi.fn() },
  order: { create: vi.fn(), update: vi.fn() },
  mutation: vi.fn(),
  announce: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("convex/react", () => ({ useMutation: () => h.mutation, useConvex: () => ({ query: vi.fn() }), useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }),
}));
vi.mock("@/lib/list-write-toast", () => ({ announceListWrite: (a: unknown) => h.announce(a) }));
vi.mock("@/lib/show-error", () => ({ showError: (e: unknown) => h.error(e) }));
vi.mock("@/hooks/use-native-client-writes", () => ({ useClientWrites: () => h.client }));
vi.mock("@/hooks/use-supplier-writes", () => ({ useSupplierWrites: () => h.supplier }));
vi.mock("@/hooks/use-crew-writes", () => ({ useCrewWrites: () => h.crew }));
vi.mock("@/hooks/use-supplier-order-writes", () => ({ useSupplierOrderWrites: () => h.order }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-crew", () => ({ useCrewRoles: () => [] }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: [] }) }));
vi.mock("@/lib/use-org-country", () => ({ useOrgCountry: () => "AU" }));
vi.mock("@/components/ui/address-input", () => ({ AddressInput: () => null }));

import { ClientSheet } from "../client-sheet";
import { SupplierSheet } from "../supplier-sheet";
import { CrewSheet } from "../crew-sheet";
import { OrderSheet } from "../order-sheet";
import { clientToFormValues } from "../edit-values";

// The Radix checkbox measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

// Radix Select needs pointer-capture / scrollIntoView, which jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const saved = { id: "r1", auditId: "a1" };
const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const w of [h.client, h.supplier, h.crew, h.order]) { w.create.mockResolvedValue(saved); w.update.mockResolvedValue(saved); }
});

describe("create: validates, writes once, toasts with the server's exact Undo, closes", () => {
  it("client", async () => {
    const onClose = vi.fn(); const onSaved = vi.fn();
    render(<ClientSheet onClose={onClose} onSaved={onSaved} />);
    expect(screen.getByRole("dialog", { name: "New client" })).toBeTruthy();
    await click("Create client");
    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(h.client.create).not.toHaveBeenCalled();
    await userEvent.type(screen.getByPlaceholderText("e.g. Acme Productions"), "Hilton");
    await click("Create client");
    await waitFor(() => expect(h.client.create).toHaveBeenCalledTimes(1));
    expect(h.client.create.mock.calls[0][0]).toMatchObject({ name: "Hilton", type: "COMPANY" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(onClose).toHaveBeenCalled();
    // The toast's Undo is the create Undo with ids only.
    const a = h.announce.mock.calls[0][0] as { title: string; performUndo: () => Promise<unknown> };
    expect(a.title).toBe("Created client Hilton");
    await a.performUndo();
    expect(h.mutation).toHaveBeenCalledWith({ orgId: "org1", kind: "client", id: "r1", forwardAuditId: "a1", now: expect.any(Number), actor: { userId: "u1", userName: "Alice" } });
  });

  it("supplier", async () => {
    const onClose = vi.fn();
    render(<SupplierSheet onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "New supplier" })).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("e.g. Sennheiser Australia"), "Scene Hire");
    await click("Create supplier");
    await waitFor(() => expect(h.supplier.create).toHaveBeenCalledTimes(1));
    expect(h.supplier.create.mock.calls[0][0]).toMatchObject({ name: "Scene Hire" });
    expect(onClose).toHaveBeenCalled();
    expect((h.announce.mock.calls[0][0] as { title: string }).title).toBe("Created supplier Scene Hire");
  });

  it("order: the number is required; Create order writes with the supplier", async () => {
    const onClose = vi.fn();
    render(<OrderSheet supplierId="s1" supplierName="Scene Hire" onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "New order" })).toBeTruthy();
    await click("Create order");
    expect(await screen.findByText("Order number is required")).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("e.g. PO-2024-001"), "PO-9");
    await click("Create order");
    await waitFor(() => expect(h.order.create).toHaveBeenCalledTimes(1));
    expect(h.order.create.mock.calls[0][0]).toMatchObject({ supplierId: "s1", orderNumber: "PO-9", type: "PURCHASE" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("crew: Save and add another", () => {
  it("saves, keeps the sheet open, clears the name and keeps the type; the plain Create closes", async () => {
    const onClose = vi.fn();
    render(<CrewSheet onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "New crew member" })).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("e.g. John"), "Bob");
    await userEvent.type(screen.getByPlaceholderText("e.g. Smith"), "Ryan");
    await click("Save and add another");
    await waitFor(() => expect(h.crew.create).toHaveBeenCalledTimes(1));
    expect(h.crew.create.mock.calls[0][0]).toMatchObject({ firstName: "Bob", lastName: "Ryan", type: "FREELANCER" });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByPlaceholderText("e.g. John") as HTMLInputElement).value).toBe(""));
    await userEvent.type(screen.getByPlaceholderText("e.g. John"), "Cy");
    await userEvent.type(screen.getByPlaceholderText("e.g. Smith"), "Dee");
    await click("Create crew member");
    await waitFor(() => expect(h.crew.create).toHaveBeenCalledTimes(2));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("edit: opens with the stored values, saves with the exact field-edit Undo", () => {
  it("client edit toasts Saved and its Undo is the people undo with the forward audit id", async () => {
    const onClose = vi.fn();
    render(<ClientSheet initialData={clientToFormValues({ id: "k1", name: "Hilton", type: "COMPANY", notes: "n", isActive: true, tags: [] } as never)} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Edit Hilton" })).toBeTruthy();
    await userEvent.clear(screen.getByPlaceholderText("e.g. Acme Productions"));
    await userEvent.type(screen.getByPlaceholderText("e.g. Acme Productions"), "Hilton Sydney");
    await click("Save");
    await waitFor(() => expect(h.client.update).toHaveBeenCalledWith("k1", expect.objectContaining({ name: "Hilton Sydney" })));
    const a = h.announce.mock.calls[0][0] as { title: string; performUndo: () => Promise<unknown> };
    expect(a.title).toBe("Saved client Hilton Sydney");
    h.mutation.mockResolvedValueOnce({ restored: ["k1"], kept: [] });
    await a.performUndo();
    expect(h.mutation).toHaveBeenCalledWith(expect.objectContaining({ kind: "client", items: [{ id: "r1", auditId: "a1" }] }));
  });

  it("order edit hides the fixed number and type, and its Undo is the order Undo", async () => {
    render(<OrderSheet supplierId="s1" supplierName="Scene" initialData={{ id: "o1", supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", status: "DRAFT", orderDate: "", expectedDate: "", notes: "" }} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit order PO-1" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("e.g. PO-2024-001")).toBeNull();
    await click("Save");
    await waitFor(() => expect(h.order.update).toHaveBeenCalledWith("o1", expect.objectContaining({ status: "DRAFT" })));
    const a = h.announce.mock.calls[0][0] as { performUndo: () => Promise<unknown> };
    await a.performUndo();
    expect(h.mutation).toHaveBeenCalledWith({ id: "r1", orgId: "org1", forwardAuditId: "a1", now: expect.any(Number), actor: { userId: "u1", userName: "Alice" } });
  });

  it("a failed write is shown, keeps the sheet open and announces nothing", async () => {
    const onClose = vi.fn();
    h.supplier.update.mockRejectedValue(new Error("nope"));
    render(<SupplierSheet initialData={{ id: "s1", name: "Scene" } as never} onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText("e.g. Sennheiser Australia"), "x");
    await click("Save");
    await waitFor(() => expect(h.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();
  });
});

describe("the order sheet's status select offers only legal moves", () => {
  const open = async (status: string) => {
    render(<OrderSheet supplierId="s1" supplierName="Scene" initialData={{ id: "o1", supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", status: status as never, orderDate: "", expectedDate: "", notes: "" }} onClose={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    return screen.getAllByRole("option").map((o) => o.textContent);
  };

  it("DRAFT can stay, go to Ordered or be Cancelled (not jump to Received)", async () => {
    expect(await open("DRAFT")).toEqual(["Draft", "Ordered", "Cancelled"]);
  });

  it("a terminal status offers only itself", async () => {
    expect(await open("RECEIVED")).toEqual(["Received"]);
  });

  it("a new order may start in any status", async () => {
    render(<OrderSheet supplierId="s1" supplierName="Scene" onClose={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("combobox")[1]);
    expect(screen.getAllByRole("option")).toHaveLength(5);
  });
});
