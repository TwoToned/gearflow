// @vitest-environment jsdom
//
// The Category Edit sheet (14b-5, D77): it opens with the category's values (incl. the default T&T class and interval),
// an unchanged save says so and offers no Undo, a save sends only what CHANGED against what it opened with (so a newer edit
// by someone else is not reverted) and its toast Undo is the exact server call, and an invalid interval is refused.
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
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-categories", () => ({ useCategoriesWithParent: () => [{ id: "root", name: "Audio", parent: null }, { id: "c1", name: "Power", parent: { name: "Audio" } }, { id: "c2", name: "Leads", parent: { name: "Power" } }] }));
vi.mock("@/components/settings/xero-coding-fields", () => ({ XeroAccountCodeField: () => null }));
const writes = vi.hoisted(() => ({
  edit: vi.fn(async (_id: string, _v: unknown) => ({ id: "c1", auditId: "ed1", changed: true })),
  undoEdit: vi.fn(async (_id: string, _a: string) => ({ id: "c1" })),
}));
vi.mock("@/hooks/use-category-writes", () => ({ useCategoryWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], errors: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: (t: string) => void toasts.errors.push(t) }) }));

import { CategorySheet } from "../category/category-sheet";
import { categorySheetInitialOf } from "@/lib/category-sheet";

const CAT = categorySheetInitialOf({ id: "c1", name: "Power", parentId: "root", description: "d", tags: [], defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6 });

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.errors = [];
  toasts.undo = undefined;
});

describe("CategorySheet", () => {
  it("opens with the category's values, including the default T&T class and interval", () => {
    render(<CategorySheet open onOpenChange={() => {}} category={CAT} excludedParentIds={["c1", "c2"]} />);
    expect(screen.getByText("Edit Power")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Power");
    expect((screen.getByLabelText("Test interval") as HTMLInputElement).value).toBe("6");
    expect(screen.getByRole("combobox", { name: "Equipment class" }).textContent).toBe("Class II");
  });

  it("an unchanged save says so and offers no Undo", async () => {
    const user = userEvent.setup();
    writes.edit.mockResolvedValueOnce({ id: "c1", auditId: "ed2", changed: false });
    render(<CategorySheet open onOpenChange={() => {}} category={CAT} excludedParentIds={["c1"]} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    expect(toasts.titles).toContain("Nothing changed");
    expect(toasts.undo).toBeUndefined();
    const [, input] = writes.edit.mock.calls[0] as unknown as [string, { set: object; clear: string[] }];
    expect(input).toEqual({ set: {}, clear: [] });
  });

  it("only what this sheet changed is sent, even if someone else edited other fields meanwhile; its Undo takes the audit id", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CategorySheet open onOpenChange={() => {}} category={CAT} excludedParentIds={["c1"]} />);
    rerender(<CategorySheet open onOpenChange={() => {}} category={{ ...CAT, description: "theirs", defaultEquipmentClass: "CLASS_I" }} excludedParentIds={["c1"]} />);
    await user.clear(screen.getByLabelText("Test interval"));
    await user.type(screen.getByLabelText("Test interval"), "12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    const [id, input] = writes.edit.mock.calls[0] as unknown as [string, { set: Record<string, unknown>; clear: string[] }];
    expect(id).toBe("c1");
    expect(input).toEqual({ set: { defaultTestIntervalMonths: 12 }, clear: [] });
    expect(toasts.titles).toContain("Updated Power");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoEdit).toHaveBeenCalledWith("c1", "ed1"));
  });

  it("clearing the interval CLEARS the default; an invalid interval is refused before the write", async () => {
    const user = userEvent.setup();
    render(<CategorySheet open onOpenChange={() => {}} category={CAT} excludedParentIds={["c1"]} />);
    await user.clear(screen.getByLabelText("Test interval"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalledTimes(1));
    expect((writes.edit.mock.calls[0] as unknown as [string, { clear: string[] }])[1].clear).toEqual(["defaultTestIntervalMonths"]);
    await user.type(screen.getByLabelText("Test interval"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.edit).toHaveBeenCalledTimes(1);
    expect(toasts.errors.join(" ")).toMatch(/interval/);
  });
});
