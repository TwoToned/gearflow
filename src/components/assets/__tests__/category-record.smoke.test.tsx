// @vitest-environment jsdom
//
// The gear Category record (14b-5): the derived header word, Overview with the default Test & tag class + interval, the
// Models tab with `Including subcategories` (which re-asks the read), Delete announced with an exact Undo from its own
// audit id (and named in the confirm), and Edit / Delete only for a caller who may.
import React from "react";
import type { FunctionReference } from "convex/server";
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

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("@/components/assets/category/category-sheet-host", () => ({ CategorySheetHost: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/assets/categories/c1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const perms = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (r: string, a: string) => perms.allowed.has(`${r}:${a}`) }));
vi.mock("@/components/activity/activity-timeline", () => ({ ActivityTimeline: () => <div>timeline</div> }));
vi.mock("@/hooks/use-categories", () => ({ useCategories: () => [] }));

const data = vi.hoisted(() => ({ detail: null as unknown, lastArgs: undefined as unknown }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      if (getFunctionName(query) === "categories:detail") {
        data.lastArgs = args;
        return data.detail;
      }
      return undefined;
    },
  };
});

const writes = vi.hoisted(() => ({
  deleteMoving: vi.fn(async (_id: string) => ({ id: "c1", auditId: "d1", movedModels: 2, movedKits: 0, movedSubcategories: 1 })),
  undoDelete: vi.fn(async (_id: string, _a: string) => ({ id: "c1" })),
}));
vi.mock("@/hooks/use-category-writes", () => ({ useCategoryWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: vi.fn() }) }));

import { CategoryRecord } from "../category/category-record";

const detail = (over: Record<string, unknown> = {}) => ({
  id: "c1", name: "Power", icon: "⚡", description: "Leads and boards", tags: ["a"], parentId: "root", defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6,
  parent: { id: "root", name: "Audio" },
  children: [{ id: "c2", name: "Leads", icon: null, _count: { models: 3, kits: 0, children: 0 } }],
  kits: [{ id: "k1", name: "Power kit", assetTag: "K-1", _count: { serializedItems: 2, bulkItems: 1 } }],
  models: [
    { id: "m1", name: "Board 6", manufacturer: "Acme", modelNumber: "B6", dailyRate: 10, weeklyRate: null, _count: { assets: 4 } },
    { id: "m2", name: "Lead 10m", manufacturer: null, modelNumber: null, dailyRate: null, weeklyRate: null, _count: { assets: 1 } },
  ],
  _count: { models: 2, kits: 1, children: 1 }, ...over,
});

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /actions|more/i }));

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
  nav.search = "";
  perms.allowed = new Set(["model:update", "model:delete"]);
  data.detail = detail();
});

describe("CategoryRecord", () => {
  it("the header word counts models without rates; Overview shows the default T&T class and interval", () => {
    render(<CategoryRecord id="c1" orgId="org1" />);
    expect(screen.getAllByText("1 model without rates").length).toBeGreaterThan(0);
    expect(screen.getByText("Class II · every 6 months")).toBeTruthy();
    expect(screen.getByText("Its own models, unless a model sets its own")).toBeTruthy();
  });

  it("a category with no default says so", () => {
    data.detail = detail({ defaultEquipmentClass: null, defaultTestIntervalMonths: null });
    render(<CategoryRecord id="c1" orgId="org1" />);
    expect(screen.getByText("None set")).toBeTruthy();
  });

  it("Models lists each model (No rate flagged); `Including subcategories` re-asks the read with it", async () => {
    nav.search = "tab=models";
    const user = userEvent.setup();
    render(<CategoryRecord id="c1" orgId="org1" />);
    expect(screen.getByText("Board 6")).toBeTruthy();
    expect(screen.getByText("No rate")).toBeTruthy();
    expect((data.lastArgs as { includeSubcategories?: boolean }).includeSubcategories).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Including subcategories" }));
    await waitFor(() => expect((data.lastArgs as { includeSubcategories?: boolean }).includeSubcategories).toBe(true));
  });

  it("Delete names what happens, is announced with an Undo from its own audit id, and goes to the parent", async () => {
    const user = userEvent.setup();
    render(<CategoryRecord id="c1" orgId="org1" />);
    await openMenu(user);
    await user.click(await screen.findByText("Delete…"));
    expect(await screen.findByText(/2 models and 1 kit become Uncategorised; 1 subcategory moves up to Audio/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(writes.deleteMoving).toHaveBeenCalledWith("c1"));
    expect(toasts.titles).toContain("Deleted Power");
    expect(nav.push).toHaveBeenCalledWith("/assets/categories/root");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoDelete).toHaveBeenCalledWith("c1", "d1"));
  });

  it("Edit opens the sheet through ?edit=1 and keeps the tab", async () => {
    nav.search = "tab=kits";
    const user = userEvent.setup();
    render(<CategoryRecord id="c1" orgId="org1" />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(nav.push).toHaveBeenCalledWith("/assets/categories/c1?tab=kits&edit=1");
  });

  it("without model:update / model:delete there is no Edit and no Delete…", async () => {
    perms.allowed = new Set();
    const user = userEvent.setup();
    render(<CategoryRecord id="c1" orgId="org1" />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await openMenu(user).catch(() => {});
    expect(screen.queryByText("Delete…")).toBeNull();
  });
});
