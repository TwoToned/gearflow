// @vitest-environment jsdom
//
// The Category sheet host: it opens from ?edit=1 only for a caller who may (model:update); otherwise the param is dropped
// with a toast, once permissions have arrived. Permissions still loading are "not known yet", never "no".
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/assets/categories/c1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const role = vi.hoisted(() => ({ permissions: null as null | Record<string, string[]> }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: role.permissions }) }));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toasts.error } }));
vi.mock("@/components/assets/category/category-sheet", () => ({ CategorySheet: ({ open }: { open: boolean }) => <div data-testid="sheet">{open ? "OPEN" : "CLOSED"}</div> }));

import { CategorySheetHost } from "../category/category-sheet-host";

const CAT = { id: "c1", name: "Power", parentId: "", description: "", icon: "", tags: [], xeroAccountCode: "", defaultEquipmentClass: "", defaultTestIntervalMonths: "" };

beforeEach(() => {
  nav.search = "";
  nav.replace.mockClear();
  toasts.error.mockClear();
  role.permissions = { model: ["read", "update"] };
});

describe("CategorySheetHost", () => {
  it("opens for ?edit=1 when the caller may", () => {
    nav.search = "edit=1";
    render(<CategorySheetHost category={CAT} excludedParentIds={["c1"]} />);
    expect(screen.getByTestId("sheet").textContent).toBe("OPEN");
  });

  it("without model:update, ?edit=1 is dropped with a toast and never opens (the tab stays)", () => {
    role.permissions = { model: ["read"] };
    nav.search = "edit=1&tab=kits";
    render(<CategorySheetHost category={CAT} excludedParentIds={[]} />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).toHaveBeenCalledWith("You don't have permission to edit categories.");
    expect(nav.replace).toHaveBeenCalledWith("/assets/categories/c1?tab=kits");
  });

  it("permissions still loading: nothing opens and nothing is dropped yet; no param, no toast", () => {
    role.permissions = null;
    nav.search = "edit=1";
    render(<CategorySheetHost category={CAT} excludedParentIds={[]} />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    nav.search = "";
    role.permissions = { model: ["read"] };
    render(<CategorySheetHost category={CAT} excludedParentIds={[]} />);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
