// @vitest-environment jsdom
//
// The Test & tag Edit sheet (14b-4, D80): it opens with the item's values, has NO status field and no tag id box, an
// unchanged save says so and offers no Undo, a save is the one edit write (set filled / clear blank, never status) and
// its toast Undo is the exact server call, and an invalid value is refused client-side.
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn(async () => ({ assets: [], bulkAssets: [] })) }), useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-test-profiles", () => ({ useTestProfiles: () => [{ id: "p1", name: "Class I", isActive: true }] }));
const writes = vi.hoisted(() => ({
  edit: vi.fn(async (_id: string, _v: unknown) => ({ id: "t1", auditId: "ed1", changed: true })),
  undoEdit: vi.fn(async (_id: string, _a: string) => ({ id: "t1" })),
}));
vi.mock("@/hooks/use-test-tag-writes", () => ({ useTestTagWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], errors: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: (t: string) => void toasts.errors.push(t) }) }));

import { TestTagSheet } from "../test-tag-sheet";
import { testTagSheetInitialOf } from "@/lib/test-tag-sheet";

const ITEM = testTagSheetInitialOf({ id: "t1", testTagId: "TT0001", description: "Hammer drill", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", make: "Acme", testIntervalMonths: 3 });

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.errors = [];
  toasts.undo = undefined;
});

describe("TestTagSheet", () => {
  it("opens with the item's values; there is no status field and no tag id box", () => {
    render(<TestTagSheet open onOpenChange={() => {}} item={ITEM} />);
    expect(screen.getByText("Edit TT0001")).toBeTruthy();
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Hammer drill");
    expect((screen.getByLabelText("Make") as HTMLInputElement).value).toBe("Acme");
    expect((screen.getByLabelText("Test interval") as HTMLInputElement).value).toBe("3");
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByLabelText(/Tag ID|Test tag id/i)).toBeNull();
  });

  it("an unchanged save says so and offers no Undo", async () => {
    const user = userEvent.setup();
    writes.edit.mockResolvedValueOnce({ id: "t1", auditId: "ed2", changed: false });
    render(<TestTagSheet open onOpenChange={() => {}} item={ITEM} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    expect(toasts.titles).toContain("Nothing changed");
    expect(toasts.undo).toBeUndefined();
  });

  it("a change is the one edit write (set the filled, clear the blank, never status) and its Undo takes the audit id", async () => {
    const user = userEvent.setup();
    render(<TestTagSheet open onOpenChange={() => {}} item={ITEM} />);
    await user.clear(screen.getByLabelText("Make"));
    await user.clear(screen.getByLabelText("Test interval"));
    await user.type(screen.getByLabelText("Test interval"), "6");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    const [id, input] = writes.edit.mock.calls[0] as unknown as [string, { set: Record<string, unknown>; clear: string[] }];
    expect(id).toBe("t1");
    expect(input.set.testIntervalMonths).toBe(6);
    expect(input.set).not.toHaveProperty("status");
    expect(input.set).not.toHaveProperty("make");
    expect(input.clear).toContain("make");
    expect(toasts.titles).toContain("Updated TT0001");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoEdit).toHaveBeenCalledWith("t1", "ed1"));
  });

  it("only what this sheet changed is sent: someone else's edit made after it opened is not reverted", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TestTagSheet open onOpenChange={() => {}} item={ITEM} />);
    // The item changes underneath the open sheet (another user set the make to "Bosch").
    rerender(<TestTagSheet open onOpenChange={() => {}} item={{ ...ITEM, make: "Bosch" }} />);
    await user.type(screen.getByLabelText("Notes"), "mine");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    const [, input] = writes.edit.mock.calls[0] as unknown as [string, { set: Record<string, unknown>; clear: string[] }];
    expect(input.set).toEqual({ notes: "mine" });
    expect(input.clear).toEqual([]);
  });

  it("an invalid interval is refused before the write", async () => {
    const user = userEvent.setup();
    render(<TestTagSheet open onOpenChange={() => {}} item={ITEM} />);
    await user.clear(screen.getByLabelText("Test interval"));
    await user.type(screen.getByLabelText("Test interval"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.edit).not.toHaveBeenCalled();
    expect(toasts.errors.join(" ")).toMatch(/interval/);
  });
});
