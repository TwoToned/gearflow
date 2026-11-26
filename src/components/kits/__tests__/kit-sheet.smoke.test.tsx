// @vitest-environment jsdom
//
// The Kit sheet (14b-2): it OPENS for create, edit and duplicate; there is NO status field (a kit's state is
// derived, D75); create pre-fills the next tag, validates the name, and the toast Undo is the one exact server
// call; an unchanged edit says so and offers none; clearing a purchase price is sent as blank.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroLinked: () => false }));
vi.mock("@/hooks/use-categories", () => ({ useCategoriesWithParent: () => [{ id: "c1", name: "Audio", parent: null }] }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [{ id: "wh", name: "Warehouse A", type: "WAREHOUSE", parentId: null }] }));
vi.mock("@/components/assets/quick-create-location", () => ({ QuickCreateLocation: () => null }));
vi.mock("@/components/settings/xero-coding-fields", () => ({ XeroAccountCodeField: () => null }));
vi.mock("@/server/settings", () => ({ peekNextAssetTags: async () => ["KIT-0042"] }));
const writes = vi.hoisted(() => ({
  create: vi.fn(async (_v: unknown) => ({ id: "new1", auditId: "cr1" })),
  edit: vi.fn(async (_id: string, _v: unknown) => ({ id: "k1", auditId: "ed1", changed: true })),
  undoCreate: vi.fn(async () => ({})),
  undoEdit: vi.fn(async () => ({})),
}));
vi.mock("@/hooks/use-kit-writes", () => ({ useKitWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: vi.fn() }) }));

import { KitSheet } from "@/components/kits/kit-sheet";

const KIT = { id: "k1", name: "Mic case", assetTag: "KIT-1", condition: "GOOD" as const, checkMode: "KIT_LEVEL" as const, weight: undefined, purchasePrice: 250, tags: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
});

describe("KitSheet", () => {
  it("create: opens with the next tag, has no status field, validates the name, Undo is the exact server call", async () => {
    const user = userEvent.setup();
    render(<KitSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("New kit")).toBeTruthy();
    expect(screen.queryByLabelText("Status")).toBeNull();
    await waitFor(() => expect((screen.getByPlaceholderText("e.g. KIT-AUD-001") as HTMLInputElement).value).toBe("KIT-0042"));
    await user.click(screen.getByRole("button", { name: "Create kit" }));
    expect(writes.create).not.toHaveBeenCalled();
    await user.type(screen.getByPlaceholderText("Wireless mic case"), "Wireless case");
    await user.click(screen.getByRole("button", { name: "Create kit" }));
    await waitFor(() => expect(writes.create).toHaveBeenCalled());
    expect(toasts.titles).toContain("Created KIT-0042");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoCreate).toHaveBeenCalledWith("new1", "cr1"));
    expect(nav.push).toHaveBeenCalledWith("/kits/new1");
  });

  it("duplicate: pre-fills the name with (copy) and a fresh tag", async () => {
    render(<KitSheet open onOpenChange={() => {}} copyOf={KIT} />);
    expect(screen.getByText("Duplicate KIT-1")).toBeTruthy();
    await waitFor(() => expect((screen.getByPlaceholderText("Wireless mic case") as HTMLInputElement).value).toBe("Mic case (copy)"));
    await waitFor(() => expect((screen.getByPlaceholderText("e.g. KIT-AUD-001") as HTMLInputElement).value).toBe("KIT-0042"));
  });

  it("edit: opens with its values, an unchanged save offers no Undo", async () => {
    const user = userEvent.setup();
    writes.edit.mockResolvedValueOnce({ id: "k1", auditId: "ed2", changed: false });
    render(<KitSheet open onOpenChange={() => {}} kit={KIT} />);
    expect(screen.getByText("Edit KIT-1")).toBeTruthy();
    expect((screen.getByPlaceholderText("Wireless mic case") as HTMLInputElement).value).toBe("Mic case");
    expect(screen.queryByLabelText("Status")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    expect(toasts.titles).toContain("Nothing changed");
    expect(toasts.undo).toBeUndefined();
  });

  it("edit: a stored 0 weight and 0 price survive an unchanged save (0 is a value, not blank), and the date shows as yyyy-mm-dd", async () => {
    const user = userEvent.setup();
    render(<KitSheet open onOpenChange={() => {}} kit={{ ...KIT, weight: 0, purchasePrice: 0, purchaseDate: "2026-03-05" }} />);
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-03-05");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    const values = (writes.edit.mock.calls[0] as unknown as [string, { weight?: number; purchasePrice?: number }])[1];
    expect(values.weight).toBe(0);
    expect(values.purchasePrice).toBe(0);
  });

  it("duplicate: keeps the case (a 0 weight too) but not what the original cost or when it was bought", async () => {
    const user = userEvent.setup();
    render(<KitSheet open onOpenChange={() => {}} copyOf={{ ...KIT, weight: 0, purchasePrice: 250, purchaseDate: "2026-03-05" }} />);
    await waitFor(() => expect((screen.getByPlaceholderText("e.g. KIT-AUD-001") as HTMLInputElement).value).toBe("KIT-0042"));
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Create kit" }));
    await waitFor(() => expect(writes.create).toHaveBeenCalled());
    const values = (writes.create.mock.calls[0] as unknown as [{ weight?: number; purchasePrice?: number; purchaseDate?: unknown }])[0];
    expect(values.weight).toBe(0);
    expect(values.purchasePrice).toBeUndefined();
    expect(values.purchaseDate).toBeUndefined();
  });

  it("edit: clearing the purchase price is sent as blank, and Undo reverses exactly that edit", async () => {
    const user = userEvent.setup();
    render(<KitSheet open onOpenChange={() => {}} kit={KIT} />);
    await user.clear(screen.getByPlaceholderText("0.00"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    expect((writes.edit.mock.calls[0] as unknown as [string, { purchasePrice?: number }])[1].purchasePrice).toBeUndefined();
    toasts.undo?.();
    await waitFor(() => expect(writes.undoEdit).toHaveBeenCalledWith("k1", "ed1"));
  });
});
