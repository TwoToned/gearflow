// @vitest-environment jsdom
//
// The Maintenance sheet (14b-3): it OPENS for log-a-job and edit; there is NO status field; edit carries labour only
// when the read did; the asset list is read-only once the job is under way; the save is the one edit write and the
// toast Undo is the exact server call; an unchanged save says so and offers none.
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
vi.mock("@/hooks/use-member-roster", () => ({ useMemberRoster: () => ({ nameOf: new Map(), options: [{ id: "u2", name: "Bob" }] }) }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => [{ id: "a1", label: "A-1 Drill" }, { id: "a2", label: "A-2 Saw" }] }));
vi.mock("@/components/ui/photo-grid-input", () => ({ PhotoGridInput: () => <div data-testid="photos" /> }));
const writes = vi.hoisted(() => ({
  create: vi.fn(async (_v: unknown) => ({ id: "new1" })),
  edit: vi.fn(async (_id: string, _v: unknown) => ({ id: "r1", auditId: "ed1", changed: true, undoable: true })),
  undoCreate: vi.fn(async () => ({})),
  undoEdit: vi.fn(async () => ({})),
}));
vi.mock("@/hooks/use-maintenance-writes", () => ({ useMaintenanceWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: vi.fn() }) }));

import { MaintenanceSheet } from "@/components/maintenance/maintenance-sheet";
import type { MaintenanceSheetInitial } from "@/lib/maintenance-sheet";

const REC: MaintenanceSheetInitial = { id: "r1", status: "SCHEDULED", labourVisible: true, title: "Fix desk", type: "REPAIR", description: "", scheduledDate: "", nextDueDate: "", assignedToId: "", reportedById: "", tags: [], photos: [], cost: "50", assetIds: ["a1"] };

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
});

describe("MaintenanceSheet", () => {
  it("log: no status field, no labour box, and nothing is created without a title and an asset", async () => {
    const user = userEvent.setup();
    render(<MaintenanceSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Log maintenance")).toBeTruthy();
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByLabelText("Labour")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Log job" }));
    expect(writes.create).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Title"), "Fix it");
    await user.click(screen.getByRole("button", { name: "Log job" })); // still no asset
    expect(writes.create).not.toHaveBeenCalled();
  });

  it("edit: opens with its values, has no status field, an unchanged save says so and offers no Undo", async () => {
    const user = userEvent.setup();
    writes.edit.mockResolvedValueOnce({ id: "r1", auditId: "ed2", changed: false, undoable: false });
    render(<MaintenanceSheet open onOpenChange={() => {}} record={REC} />);
    expect(screen.getByText("Edit Fix desk")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Fix desk");
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect((screen.getByLabelText("Labour") as HTMLInputElement).value).toBe("50");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    expect(toasts.titles).toContain("Nothing changed");
    expect(toasts.undo).toBeUndefined();
  });

  it("edit: a changed title is the one edit write (set, no status, no assets) and its Undo takes the audit id", async () => {
    const user = userEvent.setup();
    render(<MaintenanceSheet open onOpenChange={() => {}} record={REC} />);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Fix the desk");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.edit).toHaveBeenCalled());
    const [id, input] = writes.edit.mock.calls[0] as unknown as [string, { set: Record<string, unknown>; assetIds?: string[] }];
    expect(id).toBe("r1");
    expect(input.set.title).toBe("Fix the desk");
    expect(input.set).not.toHaveProperty("status");
    expect(input.assetIds).toBeUndefined();
    expect(toasts.titles).toContain("Updated Fix the desk");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoEdit).toHaveBeenCalledWith("r1", "ed1"));
  });

  it("edit: a caller whose read carried no labour does not see the box", () => {
    render(<MaintenanceSheet open onOpenChange={() => {}} record={{ ...REC, labourVisible: false, cost: "" }} />);
    expect(screen.queryByLabelText("Labour")).toBeNull();
  });

  it("edit: once the job is under way the assets are read-only (no picker, no remove)", () => {
    render(<MaintenanceSheet open onOpenChange={() => {}} record={{ ...REC, status: "IN_PROGRESS" }} />);
    expect(screen.queryByPlaceholderText("Search and select assets…")).toBeNull();
    expect(screen.queryByLabelText(/^Remove /)).toBeNull();
    expect(screen.getByText(/held while the job is under way/i)).toBeTruthy();
  });

  it("edit: a Scheduled job's assets can be removed, and saving with none is refused client-side", async () => {
    const user = userEvent.setup();
    render(<MaintenanceSheet open onOpenChange={() => {}} record={REC} />);
    await user.click(screen.getByLabelText("Remove A-1 Drill"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.edit).not.toHaveBeenCalled();
  });
});
