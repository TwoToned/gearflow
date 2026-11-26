// @vitest-environment jsdom
//
// The Test & tag record (14b-4): the derived header word, Overview `n of m checks clear` with each failing check's
// one action, the Tests tab (readings), Retire and Reactivate each announced with an exact Undo, Delete only after
// Retire, and Edit / Record test only for a caller who may.
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
vi.mock("@/components/test-tag/test-tag-sheet-host", () => ({ TestTagSheetHost: () => null }));
// The Schedule dialog is proven on its own; here it is a marker, so what the record hands it is what is tested.
vi.mock("@/components/test-tag/schedule-test-dialog", () => ({ ScheduleTestDialog: (p: { items: { id: string; assetId: string | null }[] | null }) => (p.items ? <div data-testid="schedule">{`schedule:${p.items[0].id}/${p.items[0].assetId}`}</div> : null) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/test-and-tag/t1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => ({ data: { settings: { testTag: { dueSoonThresholdDays: 14 } } } }) }));
const perms = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (r: string, a: string) => perms.allowed.has(`${r}:${a}`) }));
vi.mock("@/components/activity/activity-timeline", () => ({ ActivityTimeline: () => <div>timeline</div> }));

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const data = vi.hoisted(() => ({ item: null as unknown, records: [] as unknown[] }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "testTagAssets:detail") return data.item;
      if (name === "testTagRecords:recordsPage") return { records: data.records, total: data.records.length };
      return undefined;
    },
  };
});

const writes = vi.hoisted(() => ({
  retire: vi.fn(async (_id: string) => ({ id: "t1" })),
  undoRetire: vi.fn(async (_id: string) => ({ ok: true })),
  reactivate: vi.fn(async (_id: string) => ({ id: "t1" })),
  undoReactivate: vi.fn(async (_id: string) => ({ ok: true })),
  remove: vi.fn(async (_id: string) => ({ id: "t1" })),
}));
vi.mock("@/hooks/use-test-tag-writes", () => ({ useTestTagWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: (t: string) => void toasts.titles.push(t), error: vi.fn() }) }));

import { TestTagRecord } from "../record/test-tag-record";

const item = (over: Record<string, unknown> = {}) => ({
  id: "t1", testTagId: "TT0001", description: "Hammer drill", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", make: "Acme", modelName: "HD-1", serialNumber: "S1",
  testIntervalMonths: 3, testProfileId: "p1", status: "CURRENT", isActive: true, lastTestDate: iso(NOW - 30 * DAY), nextDueDate: iso(NOW + 60 * DAY),
  asset: { id: "a1", assetTag: "DRL-1" }, bulkAsset: null, testProfile: { id: "p1", name: "Class I" },
  testRecords: [{ result: "PASS", testDate: iso(NOW - 30 * DAY), testerName: "Ada" }], _count: { testRecords: 2 }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
  nav.search = "";
  perms.allowed = new Set(["testTag:update", "testTag:delete"]);
  data.item = item();
  data.records = [
    { id: "r1", testDate: NOW - 30 * DAY, result: "PASS", testerName: "Ada", earthContinuityReading: 0.12, insulationReading: 5 },
    { id: "r2", testDate: NOW - 120 * DAY, result: "FAIL", testerName: "Bo", failureNotes: "Frayed cord" },
  ];
});

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /actions|more/i }));

describe("TestTagRecord", () => {
  it("a tested, profiled, in-date item reads Passed and is all clear (3 of 3)", () => {
    render(<TestTagRecord id="t1" orgId="org1" />);
    expect(screen.getAllByText("Passed").length).toBeGreaterThan(0);
    expect(screen.getByText("3 of 3 checks clear")).toBeTruthy();
    expect(screen.getByText("Nothing needs a look.")).toBeTruthy();
  });

  it("an overdue item with no profile names each failing check with its one action", async () => {
    data.item = item({ testProfileId: null, testProfile: null, nextDueDate: iso(NOW - 5 * DAY) });
    const user = userEvent.setup();
    render(<TestTagRecord id="t1" orgId="org1" />);
    expect(screen.getAllByText("5d overdue").length).toBeGreaterThan(0);
    expect(screen.getByText("No test profile")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Record test ›/ }));
    expect(nav.push).toHaveBeenCalledWith("/test-and-tag/quick-test?id=TT0001");
    await user.click(screen.getByRole("button", { name: /Edit ›/ }));
    expect(nav.push).toHaveBeenCalledWith("/test-and-tag/t1?edit=1");
  });

  it("Edit keeps the tab it was opened from", async () => {
    nav.search = "tab=tests";
    const user = userEvent.setup();
    render(<TestTagRecord id="t1" orgId="org1" />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(nav.push).toHaveBeenCalledWith("/test-and-tag/t1?tab=tests&edit=1");
  });

  it("the Tests tab lists each test with its readings, tester and failure note", () => {
    nav.search = "tab=tests";
    render(<TestTagRecord id="t1" orgId="org1" />);
    expect(screen.getByText(/Earth 0.12 Ω/)).toBeTruthy();
    expect(screen.getByText(/Insulation 5 MΩ/)).toBeTruthy();
    expect(screen.getByText(/Frayed cord/)).toBeTruthy();
  });

  it("Retire is announced with an Undo that is the exact server call; Delete is NOT offered on an active item", async () => {
    const user = userEvent.setup();
    render(<TestTagRecord id="t1" orgId="org1" />);
    await openMenu(user);
    expect(screen.queryByText("Delete…")).toBeNull();
    await user.click(await screen.findByText("Retire"));
    await waitFor(() => expect(writes.retire).toHaveBeenCalledWith("t1"));
    expect(toasts.titles).toContain("Retired TT0001");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoRetire).toHaveBeenCalledWith("t1"));
  });

  it("a retired item reads Retired, offers Reactivate (with its Undo) and Delete…, and no Edit or Record test", async () => {
    data.item = item({ status: "RETIRED", isActive: false });
    const user = userEvent.setup();
    render(<TestTagRecord id="t1" orgId="org1" />);
    expect(screen.getAllByText("Retired").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record test" })).toBeNull();
    await openMenu(user);
    expect(await screen.findByText("Delete…")).toBeTruthy();
    await user.click(screen.getByText("Reactivate"));
    await waitFor(() => expect(writes.reactivate).toHaveBeenCalledWith("t1"));
    toasts.undo?.();
    await waitFor(() => expect(writes.undoReactivate).toHaveBeenCalledWith("t1"));
  });

  it("Print label is on the ⋯ and opens the browser print dialog over the one label (the latest test)", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    const { container } = render(<TestTagRecord id="t1" orgId="org1" />);
    const label = container.querySelector(".test-tag-label");
    expect(label?.textContent).toContain("TT0001");
    expect(label?.textContent).toContain("Ada");
    await openMenu(user);
    await user.click(await screen.findByText("Print label"));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("an item that has never been tested has no label to print: no Print label, no hidden label", async () => {
    data.item = item({ testRecords: [], lastTestDate: null, nextDueDate: null, status: "NOT_YET_TESTED" });
    const user = userEvent.setup();
    const { container } = render(<TestTagRecord id="t1" orgId="org1" />);
    expect(container.querySelector(".test-tag-label")).toBeNull();
    await openMenu(user);
    expect(screen.queryByText("Print label")).toBeNull();
  });

  it("a retired item can still print its label", async () => {
    data.item = item({ status: "RETIRED", isActive: false });
    const user = userEvent.setup();
    render(<TestTagRecord id="t1" orgId="org1" />);
    await openMenu(user);
    expect(await screen.findByText("Print label")).toBeTruthy();
  });

  it("without testTag:update there is no Edit, Record test or Retire; without delete, no Delete…", async () => {
    perms.allowed = new Set();
    data.item = item({ status: "RETIRED", isActive: false });
    const user = userEvent.setup();
    render(<TestTagRecord id="t1" orgId="org1" />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await openMenu(user).catch(() => {});
    expect(screen.queryByText("Reactivate")).toBeNull();
    expect(screen.queryByText("Delete…")).toBeNull();
  });

  it("Export report opens that item's history PDF (reports:view) and Schedule… hands the dialog the linked asset (maintenance:create); each is absent without its permission and Schedule… on a retired item", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    perms.allowed = new Set(["testTag:update", "reports:view", "maintenance:create"]);
    const user = userEvent.setup();
    const first = render(<TestTagRecord id="t1" orgId="org1" />);
    await openMenu(user);
    await user.click(await screen.findByText("Export report"));
    expect(open).toHaveBeenCalledWith("/api/test-tag-reports/item-history?format=pdf&testTagAssetId=t1", "_blank");
    await openMenu(user);
    await user.click(await screen.findByText("Schedule…"));
    expect(screen.getByTestId("schedule").textContent).toBe("schedule:t1/a1");
    first.unmount();

    perms.allowed = new Set(["testTag:update"]);
    const second = render(<TestTagRecord id="t1" orgId="org1" />);
    await openMenu(user);
    expect(await screen.findByText("Retire")).toBeTruthy();
    expect(screen.queryByText("Export report")).toBeNull();
    expect(screen.queryByText("Schedule…")).toBeNull();
    second.unmount();

    perms.allowed = new Set(["testTag:update", "maintenance:create"]);
    data.item = item({ status: "RETIRED", isActive: false });
    render(<TestTagRecord id="t1" orgId="org1" />);
    await openMenu(user);
    expect(await screen.findByText("Reactivate")).toBeTruthy();
    expect(screen.queryByText("Schedule…")).toBeNull();
    open.mockRestore();
  });
});
