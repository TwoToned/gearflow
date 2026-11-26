// @vitest-environment jsdom
//
// The Test and tag list on ListPage: `/test-and-tag` renders off testTagList.listPage (derived state), the strip
// and filters come from the URL, the org's due-soon horizon is passed through, the page menu OPENS (Sync from
// assets runs the backfill), and Reactivate appears only on a retired item with the exact Undo.
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/test-and-tag",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
const perms = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (r: string, a: string) => !perms.denied.has(`${r}:${a}`) }));
// The three dialogs are proven on their own; here they are markers, so the list's wiring (what opens what) is what is tested.
vi.mock("@/components/test-tag/reports-dialog", () => ({ ReportsDialog: (p: { open: boolean }) => (p.open ? <div data-testid="reports">reports</div> : null) }));
vi.mock("@/components/test-tag/print-tags-dialog", () => ({ PrintTagsDialog: (p: { ids: string[] | null }) => (p.ids ? <div data-testid="print">{`print:${p.ids.join(",")}`}</div> : null) }));
vi.mock("@/components/test-tag/schedule-test-dialog", () => ({ ScheduleTestDialog: (p: { items: { id: string; assetId: string | null }[] | null }) => (p.items ? <div data-testid="schedule">{`schedule:${p.items.map((i) => `${i.id}/${i.assetId}${(i as { retired?: boolean }).retired ? "/retired" : ""}`).join(",")}`}</div> : null) }));
vi.mock("@/hooks/use-keyboard-shortcut", () => ({ useKeyboardShortcut: () => undefined }));
vi.mock("@/hooks/use-test-profiles", () => ({ useTestProfiles: () => [{ id: "p1", name: "Leads" }] }));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => ({ data: { settings: { testTag: { dueSoonThresholdDays: 30 } } } }) }));
vi.mock("@/components/ui/url-saved-views", () => ({ UrlSavedViewsMenu: () => <button type="button">Views</button> }));
const writes = vi.hoisted(() => ({
  backfill: vi.fn(async () => ({ created: 3, retired: 1 })),
  reactivate: vi.fn(async () => ({ id: "t3" })),
  undoReactivate: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/hooks/use-test-tag-writes", () => ({ useTestTagWrites: () => writes }));
const toasts = vi.hoisted(() => ({ plain: [] as string[], undo: undefined as undefined | (() => void), title: "" }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.title = o.title;
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.plain.push(t), { success: vi.fn(), error: vi.fn() }) }));

const DAY = 86_400_000;
const NOW = Date.now();
const item = (over: Record<string, unknown>) => ({
  id: "t1",
  testTagId: "TT-0001",
  description: "Extension lead 10m",
  equipmentClass: "CLASS_I",
  applianceType: "EXTENSION_LEAD",
  profile: "Leads",
  state: "OVERDUE",
  lastTestDate: NOW - 400 * DAY,
  nextDueDate: NOW - DAY,
  tester: "Sam",
  linkedAsset: null,
  ...over,
});
const PAGE = {
  items: [
    item({ linkedAsset: { id: "a1", assetTag: "A-1" } }),
    item({ id: "t2", testTagId: "TT-0002", description: "Power board", state: "FAILED", nextDueDate: null }),
    item({ id: "t3", testTagId: "TT-0003", description: "Old kettle", state: "RETIRED" }),
  ],
  total: 3,
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
      if (name === "testTagList:listPage") {
        lastArgs = args as Record<string, unknown>;
        return PAGE;
      }
      if (name === "testTagList:segmentCounts") return { due: 4, overdue: 1, passed: 9, failed: 1, all: 15, retired: 1, truncated: false };
      return undefined;
    },
  };
});

import { TestTagList } from "../test-tag-list";

beforeEach(() => {
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  perms.denied.clear();
  Object.values(writes).forEach((f) => f.mockClear());
  toasts.plain = [];
  toasts.undo = undefined;
  lastArgs = undefined;
});

describe("TestTagList (smoke)", () => {
  it("the strip, the derived state words and the org's due-soon horizon reach the query", () => {
    nav.search = "seg=overdue&class=CLASS_I";
    render(<TestTagList />);
    for (const label of ["Due", "Overdue", "Passed", "Failed", "All", "Retired"]) expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    expect(lastArgs).toMatchObject({ orgId: "org1", segment: "overdue", classIn: ["CLASS_I"], dueSoonDays: 30, sortBy: "nextDue" });
    expect(typeof lastArgs?.now).toBe("number");
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getByText("After repair")).toBeTruthy(); // a failed item has no next due date until it is retested
  });

  it("the page menu opens and Sync from assets runs the backfill and says what it did", async () => {
    const user = userEvent.setup();
    render(<TestTagList />);
    await user.click(screen.getByRole("button", { name: "Test & tag options" }));
    expect(await screen.findByText("Reports…")).toBeTruthy();
    expect(screen.getByText("Quick test")).toBeTruthy();
    await user.click(screen.getByText("Sync from assets"));
    expect(writes.backfill).toHaveBeenCalled();
    expect(toasts.plain).toContain("Sync complete: registered 3, retired 1");
  });

  it("Reactivate is offered only on the retired item, and its toast Undo is the exact server call", async () => {
    const user = userEvent.setup();
    render(<TestTagList />);
    await user.click(screen.getByRole("button", { name: "Extension lead 10m actions" }));
    expect(await screen.findByText("Quick test")).toBeTruthy();
    expect(screen.queryByText("Reactivate")).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Old kettle actions" }));
    await user.click(await screen.findByText("Reactivate"));
    expect(writes.reactivate).toHaveBeenCalledWith("t3");
    expect(toasts.title).toBe("Reactivated TT-0003");
    toasts.undo?.();
    expect(writes.undoReactivate).toHaveBeenCalledWith("t3");
  });

  it("Reports… opens the dialog from the URL, and is absent without reports:view", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TestTagList />);
    await user.click(screen.getByRole("button", { name: "Test & tag options" }));
    await user.click(await screen.findByText("Reports…"));
    expect(nav.push).toHaveBeenCalledWith("/test-and-tag?dialog=reports");
    unmount();
    nav.search = "dialog=reports";
    const second = render(<TestTagList />);
    expect(screen.getByTestId("reports")).toBeTruthy();
    second.unmount();
    perms.denied.add("reports:view");
    render(<TestTagList />);
    expect(screen.queryByTestId("reports")).toBeNull(); // the URL alone cannot open it for a caller without the permission
    await user.click(screen.getByRole("button", { name: "Test & tag options" }));
    expect(await screen.findByText("Quick test")).toBeTruthy();
    expect(screen.queryByText("Reports…")).toBeNull();
  });

  it("a row's Schedule… and Export report are offered, but Schedule… not on a retired item", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<TestTagList />);
    await user.click(screen.getByRole("button", { name: "Extension lead 10m actions" }));
    await user.click(await screen.findByText("Export report"));
    expect(open).toHaveBeenCalledWith("/api/test-tag-reports/item-history?format=pdf&testTagAssetId=t1", "_blank");
    await user.click(screen.getByRole("button", { name: "Extension lead 10m actions" }));
    await user.click(await screen.findByText("Schedule…"));
    expect(screen.getByTestId("schedule").textContent).toBe("schedule:t1/a1");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Old kettle actions" }));
    expect(await screen.findByText("Reactivate")).toBeTruthy();
    expect(screen.queryByText("Schedule…")).toBeNull();
    open.mockRestore();
  });

  it("the bulk bar's Print tags passes the selected ids and Schedule skips a retired item; without maintenance:create there is no Schedule", async () => {
    const user = userEvent.setup();
    render(<TestTagList />);
    await user.click(screen.getByRole("checkbox", { name: "Select Extension lead 10m" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Old kettle" }));
    await user.click(await screen.findByRole("button", { name: /Print tags \(2\)/ }));
    expect(screen.getByTestId("print").textContent).toBe("print:t1,t3");
    await user.click(await screen.findByRole("button", { name: /Schedule 2/ }));
    expect(screen.getByTestId("schedule").textContent).toBe("schedule:t1/a1,t3/null/retired");
  });

  it("without maintenance:create and reports:view neither verb is on a row", async () => {
    perms.denied.add("maintenance:create");
    perms.denied.add("reports:view");
    const user = userEvent.setup();
    render(<TestTagList />);
    await user.click(screen.getByRole("button", { name: "Extension lead 10m actions" }));
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByText("Schedule…")).toBeNull();
    expect(screen.queryByText("Export report")).toBeNull();
  });
});
