// @vitest-environment jsdom
//
// The Location sheet: it OPENS (create and edit), a blank capacity stays blank (null on edit, absent on
// create), Save and add another keeps parent + type, the toast Undo is the one exact server closure, and an
// unchanged edit says so and offers none. Plus the pure descendant filter.
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
vi.mock("@/lib/use-org-country", () => ({ useOrgCountry: () => "AU" }));
vi.mock("@/hooks/use-locations", () => ({
  useLocations: () => [
    { id: "wh", name: "Warehouse A", type: "WAREHOUSE", parentId: null },
    { id: "bin", name: "B2", type: "WAREHOUSE", parentId: "wh" },
    { id: "van", name: "Van 2", type: "VEHICLE", parentId: null },
  ],
}));
vi.mock("@/components/assets/quick-create-location", () => ({ QuickCreateLocation: () => null }));
vi.mock("@/components/ui/address-input", () => ({ AddressInput: () => <input aria-label="Address" /> }));
const writes = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "new1", auditId: "cr1" })),
  update: vi.fn(async () => ({ id: "wh", auditId: "ed1", changed: true, undoable: true })),
  undoCreate: vi.fn(async () => ({ id: "new1" })),
  undoUpdate: vi.fn(async () => ({ id: "wh" })),
}));
vi.mock("@/hooks/use-location-writes", () => ({ useLocationWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: vi.fn() }) }));

import { LocationSheet, selfAndDescendants } from "@/components/locations/location-sheet";

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
});

describe("LocationSheet", () => {
  it("create: opens, validates the name, saves with a blank capacity left blank, Undo is the exact server call", async () => {
    const user = userEvent.setup();
    render(<LocationSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("New location")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create location" }));
    expect(writes.create).not.toHaveBeenCalled();
    await user.type(screen.getByPlaceholderText("Main warehouse"), "Van 3");
    await user.click(screen.getByRole("button", { name: "Create location" }));
    await waitFor(() => expect(writes.create).toHaveBeenCalled());
    expect((writes.create.mock.calls[0] as unknown as [{ capacity?: number }])[0].capacity).toBeUndefined();
    expect(toasts.titles).toContain("Created Van 3");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoCreate).toHaveBeenCalledWith("new1", "cr1"));
  });

  it("edit: opens with its values, excludes itself and its bins as parents, an unchanged save offers no Undo", async () => {
    const user = userEvent.setup();
    writes.update.mockResolvedValueOnce({ id: "wh", auditId: "ed2", changed: false, undoable: false });
    render(<LocationSheet open onOpenChange={() => {}} location={{ id: "wh", name: "Warehouse A", type: "WAREHOUSE", capacity: 100 }} />);
    expect(screen.getByText("Edit Warehouse A")).toBeTruthy();
    expect((screen.getByPlaceholderText("Main warehouse") as HTMLInputElement).value).toBe("Warehouse A");
    expect((screen.getByPlaceholderText("e.g. 600") as HTMLInputElement).value).toBe("100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.update).toHaveBeenCalled());
    expect(toasts.titles).toContain("Nothing changed");
    expect(toasts.undo).toBeUndefined();
  });

  it("edit: clearing the capacity is sent as blank, and the toast Undo reverses exactly that edit", async () => {
    const user = userEvent.setup();
    render(<LocationSheet open onOpenChange={() => {}} location={{ id: "wh", name: "Warehouse A", capacity: 100 }} />);
    await user.clear(screen.getByPlaceholderText("e.g. 600"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.update).toHaveBeenCalled());
    expect((writes.update.mock.calls[0] as unknown as [string, { capacity?: number }])[1].capacity).toBeUndefined();
    toasts.undo?.();
    await waitFor(() => expect(writes.undoUpdate).toHaveBeenCalledWith("wh", "ed1"));
  });
});

describe("selfAndDescendants", () => {
  it("returns the location and everything beneath it, at any depth", () => {
    const all = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
      { id: "d", parentId: null },
    ];
    expect([...selfAndDescendants(all, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...selfAndDescendants(all, "d")]).toEqual(["d"]);
  });
});
