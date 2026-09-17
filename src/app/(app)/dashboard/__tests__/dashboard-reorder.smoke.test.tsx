// @vitest-environment jsdom
//
// Dashboard reorder (#952 / QW-3), updated for work-layer phase 0.5 (#1242,
// D10A): the personal "My work" zone (tasks-due block + per-project blocker
// badges, formerly MyWorkSection) is GONE — Today (/today) now owns that
// surface, and the dashboard would otherwise render the same rows twice.
// "On the floor now" (an org-wide live-jobs view, not a personal work list)
// stays and now renders directly ahead of the Org risk zone. Blockers still
// surface exactly once, via the needs-attention chip.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
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
}));
vi.mock("@/components/dashboard/activation-checklist", () => ({
  ActivationChecklist: () => null,
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

  it("no longer renders a personal 'My work' zone — Today owns tasks-due and per-project blocker badges now", () => {
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
