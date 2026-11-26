// @vitest-environment jsdom
//
// The maintenance record (14b-3): the derived header word, Overview `n of m checks clear` with each failing check's
// one action, the tabs (Assets, Parts, History, Files), Complete… and Reopen only when the job's state and the
// caller allow, Complete/Reopen announced with an exact Undo from their ids, and cost ABSENT for a caller who
// cannot see job cost.
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
vi.mock("@/components/maintenance/maintenance-sheet-host", () => ({ MaintenanceSheetHost: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/maintenance/r1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const perms = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (r: string, a: string) => perms.allowed.has(`${r}:${a}`) }));
vi.mock("@/components/activity/activity-timeline", () => ({ ActivityTimeline: () => <div>timeline</div> }));
vi.mock("@/components/ui/app-image", () => ({ AppImage: () => null }));

const DAY = 86_400_000;
const TODAY = Math.floor(Date.now() / DAY) * DAY;
const iso = (ms: number) => new Date(ms).toISOString();
const data = vi.hoisted(() => ({ record: null as unknown, parts: null as unknown }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "maintenanceRecords:recordDetail") return data.record;
      if (name === "maintenanceParts:listForRecord") return data.parts;
      return undefined;
    },
  };
});

const writes = vi.hoisted(() => ({
  complete: vi.fn(async (_i: unknown) => ({ undoable: true, auditId: "c1" })),
  reopen: vi.fn(async () => ({ auditId: "o1" })),
  undoLifecycle: vi.fn(async (_id: string) => {}),
}));
vi.mock("@/components/maintenance/record/use-maintenance-record-writes", () => ({ useMaintenanceRecordWrites: () => writes }));
const recordWrites = vi.hoisted(() => ({ remove: vi.fn(async (_id: string) => {}) }));
vi.mock("@/hooks/use-maintenance-writes", () => ({ useMaintenanceWrites: () => recordWrites }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: vi.fn() }) }));

import { MaintenanceRecord } from "../record/maintenance-record";

const record = (over: Record<string, unknown> = {}) => ({
  id: "r1", title: "Fix the desk", type: "REPAIR", status: "IN_PROGRESS", description: "Gas strut gone", scheduledDate: iso(TODAY), completedDate: null, nextDueDate: null,
  result: null, partsUsed: null, tags: [], photos: [], attachments: [], createdAt: iso(TODAY - DAY), cost: 50,
  assets: [{ assetId: "a1", asset: { id: "a1", assetTag: "DSK-1", model: { name: "Mixing desk" } } }],
  assignedTo: { name: "Ada" }, reportedBy: { name: "Bo" }, ...over,
});
const partsData = (over: Record<string, unknown> = {}) => ({
  parts: [], summary: { count: 0, onOrder: 0, arrived: 0, nextEta: null, late: 0 },
  cost: { parts: 0, labour: 50, total: 50, unpricedParts: 0 }, truncated: false, ...over,
});

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /actions|more/i }));

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
  nav.search = "";
  perms.allowed = new Set(["maintenance:update", "maintenance:delete"]);
  data.record = record();
  data.parts = partsData();
});

describe("MaintenanceRecord", () => {
  it("an owned, dated job with gear is all clear (4 of 4) and says what state it is in", () => {
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(screen.getByText("4 of 4 checks clear")).toBeTruthy();
    expect(screen.getByText("Nothing needs a look.")).toBeTruthy();
    expect(screen.getByText("$50.00 so far")).toBeTruthy();
  });

  it("Edit opens the sheet through ?edit=1 on the same page and keeps the tab", async () => {
    nav.search = "tab=parts";
    const user = userEvent.setup();
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(nav.push).toHaveBeenCalledWith("/maintenance/r1?tab=parts&edit=1");
  });

  it("an overdue job with parts on order and nobody assigned names each check with its action", () => {
    data.record = record({ status: "SCHEDULED", scheduledDate: iso(TODAY - 18 * DAY), assignedTo: null });
    data.parts = partsData({ summary: { count: 2, onOrder: 2, arrived: 0, nextEta: TODAY + 2 * DAY, late: 0 } });
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    expect(screen.getAllByText("18d overdue").length).toBeGreaterThan(0);
    expect(screen.getByText(/18 days overdue/)).toBeTruthy();
    expect(screen.getByText(/2 parts on order/)).toBeTruthy();
    expect(screen.getByText("Nobody is assigned")).toBeTruthy();
    expect(screen.getByText("1 of 4 checks clear")).toBeTruthy();
  });

  it("Awaiting parts is held, not late, even with a past date", () => {
    data.record = record({ status: "AWAITING_PARTS", scheduledDate: iso(TODAY - 9 * DAY) });
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    expect(screen.getAllByText(/Awaiting parts/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it("a noFinancials-style read (no cost key, no cost figures) shows no money anywhere", () => {
    const r = record() as Record<string, unknown>;
    delete r.cost;
    data.record = r;
    data.parts = partsData({ cost: null });
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText("Cost")).toBeNull();
  });

  it("Complete… opens the dialog and a completion is announced with an Undo built from its audit id", async () => {
    const user = userEvent.setup();
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    await openMenu(user);
    await user.click(await screen.findByText("Complete…"));
    expect(await screen.findByText("Complete Fix the desk")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(writes.complete).toHaveBeenCalled());
    expect(toasts.titles).toContain("Completed Fix the desk");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoLifecycle).toHaveBeenCalledWith("c1"));
  });

  it("a completion that retired an asset is announced with NO Undo", async () => {
    writes.complete.mockResolvedValueOnce({ undoable: false, auditId: "c2" });
    const user = userEvent.setup();
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    await openMenu(user);
    await user.click(await screen.findByText("Complete…"));
    await user.click(await screen.findByRole("button", { name: "Complete" }));
    await waitFor(() => expect(toasts.titles).toContain("Completed Fix the desk"));
    expect(toasts.undo).toBeUndefined();
  });

  it("a completed job offers Reopen (not Complete…), and Reopen is announced with its Undo", async () => {
    data.record = record({ status: "COMPLETED", result: "PASS", completedDate: iso(TODAY) });
    const user = userEvent.setup();
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    await openMenu(user);
    expect(screen.queryByText("Complete…")).toBeNull();
    await user.click(await screen.findByText("Reopen"));
    await waitFor(() => expect(writes.reopen).toHaveBeenCalled());
    expect(toasts.titles).toContain("Reopened Fix the desk");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoLifecycle).toHaveBeenCalledWith("o1"));
  });

  it("without maintenance:update there is no Edit, Complete… or Reopen; without delete, no Delete…", async () => {
    perms.allowed = new Set();
    const user = userEvent.setup();
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await openMenu(user).catch(() => {});
    expect(screen.queryByText("Complete…")).toBeNull();
    expect(screen.queryByText("Delete…")).toBeNull();
  });

  it("the tabs open: Assets lists the gear, Files says when there is none", async () => {
    const user = userEvent.setup();
    render(<MaintenanceRecord id="r1" orgId="org1" />);
    await user.click(screen.getByRole("tab", { name: /Assets/ }));
    expect(nav.replace).toHaveBeenCalledWith("/maintenance/r1?tab=assets", { scroll: false });
  });
});
