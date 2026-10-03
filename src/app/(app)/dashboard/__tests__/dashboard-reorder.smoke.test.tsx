// @vitest-environment jsdom
//
// Dashboard reorder (#952 / QW-3), updated for the customizable widget board
//: `/dashboard` is now `<DashboardGrid>` over a per-user saved
// layout (`useDashboardLayout`), so this test mocks that hook to a fixed
// DEFAULT_DASHBOARD_LAYOUT arrangement (avoiding a real Convex client) and
// asserts DOM order still follows array order — react-grid-layout renders
// items in `widgets.map()` order regardless of their absolute CSS position.
// The personal "My work" zone (tasks-due block + per-project blocker
// badges, formerly MyWorkSection) stays GONE — its replacement is the
// `todayWorkList` widget, which IS in DEFAULT_DASHBOARD_LAYOUT since follow-up
// automation (design D3) but is filtered out of this test's fixed layout: it
// needs its own session/Convex mocks and has its own smoke tests
// (src/app/(app)/today/__tests__/page.smoke.test.tsx). "On the floor now" (an org-wide live-jobs view, not a personal work
// list) stays and renders ahead of the Org-risk zone. Blockers still surface
// exactly once, via the needs-attention chip.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_DASHBOARD_LAYOUT } from "@/lib/dashboard-widgets";

const ORG_WIDE_LAYOUT = DEFAULT_DASHBOARD_LAYOUT.filter((w) => w.kind !== "todayWorkList");

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));

// Desktop grid path (react-grid-layout) — mobile stacking has its own test
// in dashboard-grid.smoke.test.tsx.
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

// Avoids needing a real ConvexReactClient ancestor — same reasoning as the
// checklist stubs below. A fixed DEFAULT_DASHBOARD_LAYOUT keeps widget order
// deterministic for this test's assertions.
vi.mock("@/hooks/use-dashboard-layout", () => ({
  useDashboardLayout: () => ({
    widgets: ORG_WIDE_LAYOUT,
    isLoading: false,
    setLayout: vi.fn(),
    addWidget: vi.fn(),
    removeWidget: vi.fn(),
    resetToDefault: vi.fn(),
    availableToAdd: [],
  }),
}));

const STATS = {
  totalAssets: 40,
  checkedOutAssets: 10,
  activeProjects: 3,
  activeCrew: 2,
  pendingCrewOffers: 0,
  maintenanceDue: 0,
  overdueReturns: 0,
  countersReady: true,
};

const MY_PROJECT = {
  id: "p1",
  name: "Live Gig",
  projectNumber: "260701",
  status: "CHECKED_OUT",
  rentalStartDate: "2026-07-01T00:00:00.000Z",
  rentalEndDate: "2026-07-30T00:00:00.000Z",
  client: { name: "Acme" },
  _count: { lineItems: 2 },
};

const BLOCKER = {
  threadId: "t1",
  projectId: "p1",
  projectName: "Live Gig",
  projectNumber: "260701",
  snippet: "Need sign-off",
  reason: "pm",
  createdByName: "Jay",
  createdAt: 1,
};

vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeDashboardStats: () => ({ data: STATS, isLoading: false }),
  useNativeSubHireStats: () => ({ activeSubHires: 0, monthlySubHireCost: 0, overdueReturns: 0 }),
  useNativeUpcoming: () => [],
  useNativeHome: () => ({ userName: "Jayden", userId: "user1", myProjects: [MY_PROJECT] }),
  useNativeBlocking: () => [BLOCKER],
  useNativePendingCrewOffers: () => 0,
  useNativeActivity: () => ({ logs: [], testRecords: [], maintenanceRecords: [] }),
  // WS3 #942 — nonzero so the overbooking-chip test below has something to render.
  useNativeOverbookingCounts: () => ({ hardCount: 2, pencilledCount: 1, saleStockCount: 3 }),
  // #992 (Phase F) — zeroed so it doesn't add unexpected chips to this test's assertions.
  useNativeOrgFinanceCounts: () => ({
    quotesOutCount: 0,
    expiringCount: 0,
    neverSentCount: 0,
    confirmedUninvoicedCount: 0,
    depositDueCount: 0,
    outstandingCount: 0,
  }),
}));
// FinishSetupChecklist (C6, #1104) and ActivationChecklist (D1, #1105) both
// pull in their own Convex-auth-gated hooks, which need a
// ConvexProviderWithAuth ancestor this reorder test doesn't set up — out of
// scope here (each has its own smoke test), so both are stubbed to render
// nothing, matching their own real behavior while loading/dismissed/complete.
vi.mock("@/components/dashboard/finish-setup-checklist", () => ({
  FinishSetupChecklist: () => null,
  useFinishSetupChecklistVisible: () => true,
}));
vi.mock("@/components/dashboard/activation-checklist", () => ({
  ActivationChecklist: () => null,
  useActivationChecklistVisible: () => true,
}));

import DashboardPage from "../page";

describe("DashboardPage reorder (smoke)", () => {
  it("renders 'On the floor now' before the org-risk zone before stat tiles", () => {
    const { container } = render(<DashboardPage />);
    const text = container.textContent ?? "";
    const floorIdx = text.indexOf("On the floor now");
    const riskIdx = text.indexOf("Needs attention");
    const statIdx = text.indexOf("Active jobs");

    expect(floorIdx).toBeGreaterThan(-1);
    expect(riskIdx).toBeGreaterThan(-1);
    expect(statIdx).toBeGreaterThan(-1);

    expect(floorIdx).toBeLessThan(riskIdx);
    expect(riskIdx).toBeLessThan(statIdx);
  });

  it("no longer renders a personal 'My work' zone — tasks-due and per-project blocker badges live in the (opt-in) Today widgets now", () => {
    render(<DashboardPage />);
    expect(screen.queryByText("My work")).toBeNull();
    expect(screen.queryByText("Confirm crew call times")).toBeNull();
    expect(screen.queryByText("1 blocker")).toBeNull();
    expect(screen.queryByText("Blockers needing you")).toBeNull();
  });

  it("surfaces the blocker exactly once, via the needs-attention chip", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/blocker.*need you/)).toBeDefined();
  });

  it("renders the org-risk zone with the needs-attention chips", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Needs attention")).toBeDefined();
  });

  // WS3 #942 — the Overbookings & Gaps board's three dashboard chips, backed
  // by the cheap overbookingBoard.counts query (mocked to a nonzero count
  // above so a real chip actually renders).
  it("renders hard/pencilled/sale-stock chips linking to /overbookings", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/2 hard overbookings/)).toBeDefined();
    expect(screen.getByText(/1 pencilled collision/)).toBeDefined();
    expect(screen.getByText(/3 sale stock to procure/)).toBeDefined();
    const link = screen.getByText(/2 hard overbookings/).closest("a");
    expect(link?.getAttribute("href")).toBe("/overbookings");
  });
});

describe("DEFAULT_DASHBOARD_LAYOUT (follow-up automation, design D3)", () => {
  it("pre-places the personal work list, where automated follow-ups land", () => {
    expect(DEFAULT_DASHBOARD_LAYOUT.map((w) => w.kind)).toContain("todayWorkList");
    // the day rail and needs-you rail stay catalog-only
    expect(DEFAULT_DASHBOARD_LAYOUT.map((w) => w.kind)).not.toContain("todayDayRail");
    expect(DEFAULT_DASHBOARD_LAYOUT.map((w) => w.kind)).not.toContain("todayNeedsYouRail");
  });
});
