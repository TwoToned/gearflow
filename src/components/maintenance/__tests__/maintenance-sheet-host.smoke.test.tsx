// @vitest-environment jsdom
//
// The Maintenance sheet host: it opens from ?new=1 / ?edit=1 only for a caller who may (create for New, update for
// Edit); otherwise the param is dropped with a toast, once their permissions have arrived. Permissions still loading
// are "not known yet", never "no".
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/maintenance/r1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const role = vi.hoisted(() => ({ permissions: null as null | Record<string, string[]> }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: role.permissions }) }));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toasts.error } }));
vi.mock("@/components/maintenance/maintenance-sheet", () => ({ MaintenanceSheet: ({ open }: { open: boolean }) => <div data-testid="sheet">{open ? "OPEN" : "CLOSED"}</div> }));

import { MaintenanceSheetHost } from "../maintenance-sheet-host";

const REC = { id: "r1", status: "SCHEDULED", labourVisible: true, title: "Fix", type: "REPAIR", description: "", scheduledDate: "", nextDueDate: "", assignedToId: "", reportedById: "", tags: [], photos: [], cost: "", assetIds: ["a1"] };

beforeEach(() => {
  nav.search = "";
  nav.replace.mockClear();
  toasts.error.mockClear();
  role.permissions = { maintenance: ["create", "read", "update"] };
});

describe("MaintenanceSheetHost", () => {
  it("opens for New and Edit when the caller may; Edit waits for the record", () => {
    nav.search = "new=1";
    render(<MaintenanceSheetHost mode="new" />);
    nav.search = "edit=1";
    render(<MaintenanceSheetHost mode="edit" record={REC} />);
    render(<MaintenanceSheetHost mode="edit" record={null} />);
    expect(screen.getAllByTestId("sheet").map((e) => e.textContent)).toEqual(["OPEN", "OPEN", "CLOSED"]);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("without maintenance:update, ?edit=1 is dropped with a toast and never opens", () => {
    role.permissions = { maintenance: ["create", "read"] };
    nav.search = "edit=1&tab=parts";
    render(<MaintenanceSheetHost mode="edit" record={REC} />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).toHaveBeenCalledWith("You don't have permission to edit maintenance.");
    expect(nav.replace).toHaveBeenCalledWith("/maintenance/r1?tab=parts");
  });

  it("without maintenance:create, ?new=1 is dropped with a toast", () => {
    role.permissions = { maintenance: ["read", "update"] };
    nav.search = "new=1";
    render(<MaintenanceSheetHost mode="new" />);
    expect(toasts.error).toHaveBeenCalledWith("You don't have permission to log maintenance.");
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
  });

  it("permissions still loading: nothing opens and nothing is dropped yet; no param, no toast", () => {
    role.permissions = null;
    nav.search = "new=1";
    render(<MaintenanceSheetHost mode="new" />);
    expect(screen.getByTestId("sheet").textContent).toBe("CLOSED");
    expect(toasts.error).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
