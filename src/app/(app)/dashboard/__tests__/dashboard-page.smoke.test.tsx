// @vitest-environment jsdom
//
// Home v2 (UX Phase 11, §6c) page smoke. Overlays are OPENED, not just mounted:
// the page ⋯ (Warehouse, Add gear, Customise…), Customise mode (Done, Add
// widget, Reset layout + Undo), the phone ⋯ sheet (no Customise, D89), the
// My tasks tick + Undo, and the role gating of Needs attention reads.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_DASHBOARD_LAYOUT } from "@/lib/dashboard-widgets";
import { rolePermissions } from "@/lib/permissions";

const m = vi.hoisted(() => ({
  isMobile: false,
  permissions: null as Record<string, string[]> | null,
  push: vi.fn(),
  toast: vi.fn(),
  save: vi.fn(async () => undefined),
  updateTask: vi.fn(async () => undefined),
  financeArg: [] as (string | undefined)[],
  upcoming: [] as unknown[],
}));

const ALL = ["read", "create", "update"];
const FULL = { project: ALL, asset: ALL, warehouse: ALL, invoice: ALL, crew: ALL, subHire: ALL, maintenance: ALL, reports: ALL };

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1", name: "Two Toned" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Jayden Cole" } } }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => m.isMobile }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: m.permissions, isLoading: false }),
  useCanDo: (r: string, a: string) => m.permissions?.[r]?.includes(a) ?? false,
}));
// The real layout hook, over a stubbed Convex: no saved row ⇒ the D87 default.
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => null }));
vi.mock("convex/react", () => ({ useMutation: () => m.save }));
vi.mock("@/hooks/use-project-tasks-writes", () => ({ useProjectTaskWrites: () => ({ update: m.updateTask }) }));
vi.mock("@/components/dashboard/setup-panel", () => ({ SetupPanel: () => null, useSetupPanelState: () => ({ visible: false, title: "Finish setup" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(m.toast, { success: m.toast, error: vi.fn() }) }));

const STATS = {
  totalAssets: 40,
  checkedOutAssets: 10,
  activeProjects: 18,
  activeCrew: 2,
  pendingCrewOffers: 0,
  maintenanceDue: 2,
  modelsDueForService: 0,
  overdueReturns: 67,
  overdueReturnJobs: 2,
  overdueTruncated: false,
  countersReady: true,
};
const TASK = {
  id: "k1", title: "Send revised quote", status: "IN_PROGRESS", priority: "HIGH", dueDate: Date.now() - 3 * 86_400_000,
  overdue: true, projectId: "p1", projectName: "Qantas awards", projectNumber: "2350", assigneeUserId: "u1", assigneeCrewId: null,
};

vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeDashboardStats: (orgId?: string) => ({ data: orgId ? STATS : undefined, isLoading: false }),
  useNativeSubHireStats: (orgId?: string) => (orgId ? { activeSubHires: 0, monthlySubHireCost: 0, overdueReturns: 1 } : undefined),
  useNativeUpcoming: () => m.upcoming,
  // Org-wide: 6 live jobs, the first page of 4 (the header counts all 6, never the slice).
  useNativeFloorJobs: (orgId?: string) =>
    orgId
      ? { items: [{ id: "p9", name: "Canva kickoff", projectNumber: "2336", status: "CHECKED_OUT", rentalEndDate: Date.now() + 86_400_000 * 3, client: null }], total: 6, page: 1, pageSize: 4, totalPages: 2 }
      : undefined,
  useNativeHome: () => ({
    userName: "Jayden Cole",
    myProjects: [{ id: "p9", name: "Canva kickoff", projectNumber: "2336", status: "CHECKED_OUT", rentalEndDate: Date.now() + 86_400_000 * 3 }],
  }),
  useNativeBlocking: () => [{ projectId: "p1" }],
  useNativePendingCrewOffers: () => 0,
  useNativeActivity: () => ({ logs: [], testRecords: [], maintenanceRecords: [] }),
  useNativeOverbookingCounts: () => ({ hardCount: 2, pencilledCount: 0, saleStockCount: 0 }),
  useNativeOrgFinanceCounts: (orgId?: string) => {
    m.financeArg.push(orgId);
    return orgId
      ? { quotesOutCount: 0, expiringCount: 0, neverSentCount: 0, depositDueCount: 0, outstandingCount: 2, overdueCount: 2, overdueOutstanding: 16975, overdueTruncated: false }
      : undefined;
  },
  useNativeMyOpenTasks: () => [TASK],
}));

import DashboardPage from "../page";

const lastToast = () => m.toast.mock.calls.at(-1) as [string, { action?: { onClick: () => Promise<void> } }?] | undefined;

beforeEach(() => {
  m.isMobile = false;
  m.permissions = FULL;
  m.push.mockClear();
  m.toast.mockClear();
  m.updateTask.mockClear();
  m.financeArg = [];
});

describe("Home (smoke)", () => {
  it("D87: stats first, then My tasks and Needs attention, then On the floor now", () => {
    const text = render(<DashboardPage />).container.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at("Active jobs")).toBeGreaterThan(-1);
    expect(at("Active jobs")).toBeLessThan(at("My tasks"));
    expect(at("My tasks")).toBeLessThan(at("Needs attention"));
    expect(at("Needs attention")).toBeLessThan(at("On the floor now"));
    expect(DEFAULT_DASHBOARD_LAYOUT[0].kind).toBe("finishSetupChecklist");
  });

  it("the header greets by first name with the date and org; the aside line is gone", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /, Jayden$/ })).toBeDefined();
    expect(screen.getByText(/· Two Toned$/)).toBeDefined();
    expect(screen.queryByText(/overdue returns? need review/)).toBeNull();
  });

  it("D85: the Overdue returns tile counts jobs, lines as its sub-line, and opens ?overdue=1", () => {
    render(<DashboardPage />);
    const tile = screen.getByRole("link", { name: /^Overdue returns: 2, 67 items to chase/ });
    expect(tile.getAttribute("href")).toBe("/projects?overdue=1");
    expect(screen.getByRole("link", { name: /^Active jobs:/ }).getAttribute("href")).toBe("/projects?seg=active");
  });

  it("Needs attention: deep-linked lines, the overdue line suppressed while its tile is on the board, D88 invoices", () => {
    render(<DashboardPage />);
    expect(screen.getByText("blocker needs you").closest("a")?.getAttribute("href")).toBe("/projects/p1");
    expect(screen.getByText("hard overbookings").closest("a")?.getAttribute("href")).toBe("/overbookings");
    expect(screen.getByText("invoices overdue").closest("a")?.textContent).toContain("$16,975 outstanding");
    expect(screen.queryByText("overdue returns")).toBeNull();
  });

  it("a role without invoice read never runs the finance read, and has no invoices line", () => {
    m.permissions = { ...FULL, invoice: [] };
    render(<DashboardPage />);
    expect(m.financeArg.length).toBeGreaterThan(0);
    expect(m.financeArg.every((a) => a === undefined)).toBe(true);
    expect(screen.queryByText("invoices overdue")).toBeNull();
    expect(screen.getByText("blocker needs you")).toBeDefined();
  });

  it("On the floor now shows the real status word (Out for CHECKED_OUT)", () => {
    render(<DashboardPage />);
    const row = screen.getByText("Canva kickoff").closest("a")!;
    expect(within(row).getByText("Out")).toBeDefined();
    expect(within(row).getByText("back in 3d")).toBeDefined();
  });

  it("On the floor now counts the ORG's live jobs (the total, not the page it shows)", () => {
    render(<DashboardPage />);
    const card = screen.getByRole("heading", { name: "On the floor now" }).parentElement!;
    expect(card.textContent).toContain("6 live");
  });

  it("Upcoming: View all opens a list holding quoted AND booked jobs; `8+` only when there are more than 8", () => {
    const job = (i: number) => ({ id: `u${i}`, name: `Job ${i}`, projectNumber: `${2400 + i}`, status: i === 0 ? "QUOTED" : "CONFIRMED", rentalStartDate: Date.now() + 86_400_000 });
    const header = () => screen.getByRole("heading", { name: "Upcoming" }).parentElement!;
    // Exactly 8: the read (limit + 1) came back with 8, so there is no 9th.
    m.upcoming = Array.from({ length: 8 }, (_, i) => job(i));
    const { unmount } = render(<DashboardPage />);
    expect(header().textContent).toMatch(/Upcoming\s*8(?!\+)/);
    unmount();
    // 9 back from the read: more than 8.
    m.upcoming = Array.from({ length: 9 }, (_, i) => job(i));
    render(<DashboardPage />);
    expect(header().textContent).toContain("8+");
    const viewAll = within(header()).getByRole("link", { name: "View all ›" });
    expect(viewAll.getAttribute("href")).toBe("/projects?status=QUOTED,AWAITING_PAYMENT,CONFIRMED,PREPPING");
    m.upcoming = [];
  });

  it("opens the page ⋯: Warehouse, Add gear and Customise… (desktop)", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Home actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Warehouse" })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: "Add gear" })).toBeDefined();
    await user.click(within(menu).getByRole("menuitem", { name: "Warehouse" }));
    expect(m.push).toHaveBeenCalledWith("/warehouse");
  });

  it("Customise… swaps + New job for Done, Add widget and Reset layout; Reset toasts an Undo", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Home actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Customise…" }));

    expect(await screen.findByRole("button", { name: /Done/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /New job/ })).toBeNull();
    expect(screen.getByLabelText("Hide My tasks")).toBeDefined();

    // Hide a widget → toast with Undo → Undo brings it back.
    await user.click(screen.getByLabelText("Hide My tasks"));
    expect(lastToast()?.[0]).toBe("My tasks hidden · Add widget brings it back");
    expect(screen.queryByLabelText("Hide My tasks")).toBeNull();
    await lastToast()?.[1]?.action?.onClick();
    await waitFor(() => expect(screen.getByLabelText("Hide My tasks")).toBeDefined());

    // A stat tile is being arranged, not opened: no link while customising.
    expect(screen.queryByRole("link", { name: /^Active jobs:/ })).toBeNull();
    expect(screen.getAllByText("Active jobs").length).toBeGreaterThan(0);

    // Add widget lists only what is off the board.
    await user.click(screen.getByRole("button", { name: /Add widget/ }));
    expect(await screen.findByText("Every widget is already on your board.")).toBeDefined();

    // Reset on an unchanged board is a no-op: no toast.
    m.toast.mockClear();
    await user.click(screen.getByRole("button", { name: /Reset layout/ }));
    expect(m.toast).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Done/ }));
    expect(screen.getByRole("link", { name: /New job/ })).toBeDefined();
  });

  it("phone: the ⋯ sheet has no Customise and says so; + New job is a sticky bar", async () => {
    m.isMobile = true;
    const user = userEvent.setup();
    render(<DashboardPage />);
    // One + New job: the sticky bar (portaled above the bottom nav), not the header button.
    const sticky = screen.getAllByRole("link", { name: /New job/ });
    expect(sticky).toHaveLength(1);
    expect(sticky[0].closest(".fixed")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Home actions" }));
    expect(await screen.findByText(/Customise Home on a desktop/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Warehouse" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Customise…" })).toBeNull();
  });

  it("My tasks: the row ⋯ opens with Open and Mark done; Mark done is the same write as the tick", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Send revised quote actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Open on the job" })).toBeDefined();
    await user.click(within(menu).getByRole("menuitem", { name: "Mark done" }));
    expect(m.updateTask).toHaveBeenCalledWith("k1", { status: "DONE" });
  });

  it("My tasks: a role without work/project update has NO tick and NO Mark done (absent, not disabled)", async () => {
    m.permissions = rolePermissions.viewer as Record<string, string[]>;
    const user = userEvent.setup();
    render(<DashboardPage />);
    expect(screen.getByText("Send revised quote")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Complete Send revised quote" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Send revised quote actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Open on the job"]);
  });

  it("My tasks: the tick completes with the /my-tasks write and Undo restores the prior status", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    expect(screen.getByText("3d overdue")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Complete Send revised quote" }));
    expect(m.updateTask).toHaveBeenCalledWith("k1", { status: "DONE" });
    await waitFor(() => expect(lastToast()?.[0]).toBe("Done · “Send revised quote”"));
    await lastToast()?.[1]?.action?.onClick();
    expect(m.updateTask).toHaveBeenLastCalledWith("k1", { status: "IN_PROGRESS" });
  });
});
