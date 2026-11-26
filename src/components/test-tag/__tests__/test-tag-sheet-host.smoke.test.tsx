// @vitest-environment jsdom
//
// The Test & tag Edit sheet host: it opens from ?edit=1 only for a caller who may (testTag:update) and only for an
// item that is not retired; otherwise the param is dropped with a toast, once permissions have arrived. Permissions
// still loading are "not known yet", never "no".
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/test-and-tag/t1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const role = vi.hoisted(() => ({ permissions: null as null | Record<string, string[]> }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: role.permissions }) }));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toasts.error } }));
vi.mock("@/components/test-tag/test-tag-sheet", () => ({ TestTagSheet: ({ open }: { open: boolean }) => <div data-testid="sheet">{open ? "OPEN" : "CLOSED"}</div> }));

import { TestTagSheetHost } from "../test-tag-sheet-host";

const ITEM = { id: "t1", testTagId: "TT1", description: "Drill", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", make: "", modelName: "", serialNumber: "", location: "", testIntervalMonths: "3", testProfileId: "", outletCount: "", notes: "", assetId: "", bulkAssetId: "" };

beforeEach(() => {
  nav.search = "";
  nav.replace.mockClear();
  toasts.error.mockClear();
  role.permissions = { testTag: ["read", "update"] };
});

describe("TestTagSheetHost", () => {
  it("opens for an active item when the caller may", () => {
    nav.search = "edit=1";
    render(<TestTagSheetHost item={ITEM} retired={false} />);
    expect(screen.getByTestId("sheet").textContent).toBe("OPEN");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("without testTag:update, ?edit=1 is dropped with a toast and never opens (the tab stays)", () => {
    role.permissions = { testTag: ["read"] };
    nav.search = "edit=1&tab=tests";
    render(<TestTagSheetHost item={ITEM} retired={false} />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).toHaveBeenCalledWith("You don't have permission to edit test & tag items.");
    expect(nav.replace).toHaveBeenCalledWith("/test-and-tag/t1?tab=tests");
  });

  it("a retired item is not edited: the param is dropped with a toast that says to reactivate", () => {
    nav.search = "edit=1";
    render(<TestTagSheetHost item={ITEM} retired />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).toHaveBeenCalledWith("A retired item can't be edited. Reactivate it first.");
    expect(nav.replace).toHaveBeenCalledWith("/test-and-tag/t1");
  });

  it("permissions still loading: nothing opens and nothing is dropped yet; no param, no toast", () => {
    role.permissions = null;
    nav.search = "edit=1";
    render(<TestTagSheetHost item={ITEM} retired={false} />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    nav.search = "";
    role.permissions = { testTag: ["read"] };
    render(<TestTagSheetHost item={ITEM} retired={false} />);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
