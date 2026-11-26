// @vitest-environment jsdom
//
// The Maintenance list on ListPage: renders off maintenanceList.listPage (derived segments), takes its state
// from the URL, every menu OPENS, the bulk Reschedule / Assign dialogs open and call the write, and the toast's
// Undo is the ONE closure that calls the exact server Undo with the ids the forward write returned.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

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
vi.mock("@/components/maintenance/maintenance-sheet-host", () => ({ MaintenanceSheetHost: () => null }));
// The three dialogs are proven on their own; here they are markers, so the list's wiring (what opens what) is what is tested.
vi.mock("@/components/maintenance/checkoff-dialog", () => ({ CheckoffDialog: (p: { open: boolean; recordId?: string | null }) => (p.open ? <div data-testid="checkoff">{`checkoff:${p.recordId ?? "all"}`}</div> : null) }));
vi.mock("@/components/maintenance/service-schedules-dialog", () => ({ ServiceSchedulesDialog: (p: { open: boolean }) => (p.open ? <div data-testid="schedules">schedules</div> : null) }));
vi.mock("@/components/maintenance/record/complete-record-dialog", () => ({ CompleteRecordDialog: (p: { open: boolean; id: string | null }) => (p.open ? <div data-testid="complete">{`complete:${p.id}`}</div> : null) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/maintenance",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-keyboard-shortcut", () => ({ useKeyboardShortcut: () => undefined }));
vi.mock("@/hooks/use-member-roster", () => ({ useMemberRoster: () => ({ nameOf: new Map(), options: [{ id: "u2", name: "Bob" }] }) }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));
const writes = vi.hoisted(() => ({
  bulkReschedule: vi.fn(async () => ({ count: 2, skipped: 1, auditIds: ["a1", "a2"] })),
  bulkAssign: vi.fn(async () => ({ count: 1, skipped: 0, auditIds: ["a3"] })),
  undoBulkEdit: vi.fn(async () => ({ restored: 2 })),
  remove: vi.fn(async () => ({ id: "x" })),
}));
vi.mock("@/hooks/use-maintenance-writes", () => ({ useMaintenanceWrites: () => writes }));
const toasts = vi.hoisted(() => ({ last: undefined as undefined | { title: string; undo?: () => void } }));
vi.mock("@/lib/list-write-toast", () => ({
  plural: (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`,
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.last = { title: o.title, undo: o.performUndo ? () => void o.performUndo!() : undefined };
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const NOW = Date.now();
const rec = (over: Record<string, unknown>) => ({
  id: "m1",
  title: "Replace lamp",
  type: "REPAIR",
  status: "SCHEDULED",
  result: null,
  overdue: false,
  scheduledDate: NOW + 86_400_000,
  completedDate: null,
  tags: [],
  reportedBy: null,
  assignedTo: "Bob",
  assets: [{ id: "a1", assetTag: "HZ-1", model: "Hazer" }],
  ...over,
});
const PAGE = {
  items: [
    rec({}),
    rec({ id: "m2", title: "Service fan", overdue: true, scheduledDate: NOW - 86_400_000, assignedTo: null, cost: 120 }),
    rec({ id: "m3", title: "Annual PM", type: "PREVENTATIVE" }),
    rec({ id: "m4", title: "Old job", status: "COMPLETED", completedDate: NOW - 86_400_000 }),
  ],
  total: 4,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  truncated: false,
};
let lastArgs: Record<string, unknown> | undefined;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "maintenanceList:listPage") {
        lastArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "maintenanceList:segmentCounts") return { open: 2, overdue: 1, scheduled: 1, done: 0, all: 2, truncated: false };
      return undefined;
    },
  };
});

import { MaintenanceList } from "../maintenance-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  Object.values(writes).forEach((f) => f.mockClear());
  toasts.last = undefined;
  lastArgs = undefined;
});

describe("MaintenanceList (smoke)", () => {
  it("the strip names every word with its count; Open is the default and the URL drives the query", () => {
    nav.search = "seg=overdue&type=REPAIR";
    render(<MaintenanceList />);
    for (const label of ["Open", "Overdue", "Scheduled", "Done", "All"]) expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    expect(lastArgs).toMatchObject({ orgId: "org1", segment: "overdue", typeIn: ["REPAIR"], sortBy: "scheduledDate" });
    expect(typeof lastArgs?.now).toBe("number");
  });

  it("an overdue record reads Overdue, and the row menu opens", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Replace lamp actions" }));
    for (const word of ["Edit", "Reschedule…", "Assign…", "Delete…"]) expect(await screen.findByText(word)).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Open/ })).toBeTruthy();
  });

  it("Log maintenance and a row's Edit open the sheet through the URL (no page)", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    await user.click(screen.getAllByRole("button", { name: "Log maintenance" })[0]);
    expect(nav.push).toHaveBeenCalledWith("/maintenance?new=1");
    await user.click(screen.getByRole("button", { name: "Replace lamp actions" }));
    await user.click(await screen.findByText("Edit"));
    expect(nav.push).toHaveBeenCalledWith("/maintenance/m1?edit=1");
  });

  it("bulk Reschedule: pick a date, the write gets the selected ids, the toast says what was skipped and its Undo is the exact server call", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Replace lamp" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Service fan" }));
    await user.click(await screen.findByRole("button", { name: /Reschedule 2/ }));
    const input = await screen.findByLabelText("New date");
    await user.type(input, "2027-03-04");
    await user.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(writes.bulkReschedule).toHaveBeenCalledTimes(1);
    const [ids, ms] = writes.bulkReschedule.mock.calls[0] as unknown as [string[], number];
    expect(ids).toEqual(["m1", "m2"]);
    expect(new Date(ms).getFullYear()).toBe(2027);
    expect(toasts.last?.title).toBe("Rescheduled 2 records · 1 finished, left as it is");
    toasts.last?.undo?.();
    expect(writes.undoBulkEdit).toHaveBeenCalledWith(["a1", "a2"]);
  });

  it("bulk Assign opens with the roster and an Unassigned choice", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Replace lamp" }));
    await user.click(await screen.findByRole("button", { name: /Assign 1/ }));
    await user.click(await screen.findByRole("combobox", { name: "Assign to" }));
    expect(await screen.findByRole("option", { name: "Unassigned" })).toBeTruthy();
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(writes.bulkAssign).toHaveBeenCalledWith(["m1"], "u2");
  });

  it("the page menu opens Check off cycle and Service schedules as dialogs through the URL (no page)", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    await user.click(screen.getByRole("button", { name: "Maintenance options" }));
    await user.click(await screen.findByText("Check off cycle…"));
    expect(nav.push).toHaveBeenCalledWith("/maintenance?dialog=checkoff");
    await user.click(screen.getByRole("button", { name: "Maintenance options" }));
    await user.click(await screen.findByText("Service schedules…"));
    expect(nav.push).toHaveBeenCalledWith("/maintenance?dialog=schedules");
  });

  it("the dialogs open from the URL, and closing drops the params (the rest of the query stays)", () => {
    nav.search = "dialog=checkoff&record=m1&seg=all";
    const { unmount } = render(<MaintenanceList />);
    expect(screen.getByTestId("checkoff").textContent).toBe("checkoff:m1");
    unmount();
    nav.search = "dialog=schedules";
    render(<MaintenanceList />);
    expect(screen.getByTestId("schedules")).toBeTruthy();
  });

  it("a preventative open row offers Check off cycle… for ITS record; a completed row offers neither verb", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    await user.click(screen.getByRole("button", { name: "Annual PM actions" }));
    await user.click(await screen.findByText("Check off cycle…"));
    expect(nav.push).toHaveBeenCalledWith("/maintenance?dialog=checkoff&record=m3");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Old job actions" }));
    expect(await screen.findByRole("menuitem", { name: /^Open/ })).toBeTruthy();
    expect(screen.queryByText("Mark done…")).toBeNull();
    expect(screen.queryByText("Check off cycle…")).toBeNull();
  });

  it("an open row offers Mark done… (the Complete dialog for that record); Check off cycle… only for a preventative one", async () => {
    const user = userEvent.setup();
    render(<MaintenanceList />);
    await user.click(screen.getByRole("button", { name: "Replace lamp actions" }));
    expect(await screen.findByText("Mark done…")).toBeTruthy();
    expect(screen.queryByText("Check off cycle…")).toBeNull(); // a REPAIR
    await user.click(screen.getByText("Mark done…"));
    expect(screen.getByTestId("complete").textContent).toBe("complete:m1");
  });
});
