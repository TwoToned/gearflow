// @vitest-environment jsdom
//
// The Kit sheet host: it opens from ?new=1 / ?edit=1 / ?copy=1 only for a caller who may (create for New and
// Duplicate, update for Edit); otherwise the param is dropped with a toast, once their permissions have arrived.
// Permissions still loading are "not known yet", never "no".
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/kits",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const role = vi.hoisted(() => ({ permissions: null as null | Record<string, string[]> }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: role.permissions }) }));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toasts.error } }));
vi.mock("@/components/kits/kit-sheet", () => ({ KitSheet: ({ open }: { open: boolean }) => <div data-testid="sheet">{open ? "OPEN" : "CLOSED"}</div> }));

import { KitSheetHost } from "../kit-sheet-host";

const KIT = { id: "k1", name: "Rack", assetTag: "K-1", condition: "GOOD" as const, checkMode: "KIT_LEVEL" as const, weight: undefined, purchasePrice: undefined, tags: [] };

beforeEach(() => {
  nav.search = "";
  nav.replace.mockClear();
  toasts.error.mockClear();
  role.permissions = { kit: ["create", "read", "update"] };
});

describe("KitSheetHost", () => {
  it("opens for New, Edit and Duplicate when the caller may", () => {
    nav.search = "new=1";
    render(<KitSheetHost mode="new" />);
    nav.search = "edit=1";
    render(<KitSheetHost mode="edit" kit={KIT} />);
    nav.search = "copy=1";
    render(<KitSheetHost mode="copy" kit={KIT} />);
    expect(screen.getAllByTestId("sheet").map((e) => e.textContent)).toEqual(["OPEN", "OPEN", "OPEN"]);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("without kit:update, ?edit=1 is dropped with a toast and never opens", () => {
    role.permissions = { kit: ["create", "read"] };
    nav.search = "edit=1&tab=checks";
    render(<KitSheetHost mode="edit" kit={KIT} />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).toHaveBeenCalledWith("You don't have permission to edit kits.");
    expect(nav.replace).toHaveBeenCalledWith("/kits?tab=checks");
  });

  it("without kit:create, ?new=1 and ?copy=1 are dropped with a toast", () => {
    role.permissions = { kit: ["read", "update"] };
    nav.search = "new=1";
    render(<KitSheetHost mode="new" />);
    nav.search = "copy=1";
    render(<KitSheetHost mode="copy" kit={KIT} />);
    expect(toasts.error).toHaveBeenCalledTimes(2);
    expect(toasts.error).toHaveBeenCalledWith("You don't have permission to create kits.");
    expect(screen.getAllByTestId("sheet").map((e) => e.textContent)).toEqual(["CLOSED", "CLOSED"]);
  });

  it("permissions still loading: nothing opens and nothing is dropped yet", () => {
    role.permissions = null;
    nav.search = "new=1";
    render(<KitSheetHost mode="new" />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("no param, no toast, even for a caller who may not", () => {
    role.permissions = { kit: ["read"] };
    render(<KitSheetHost mode="new" />);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
