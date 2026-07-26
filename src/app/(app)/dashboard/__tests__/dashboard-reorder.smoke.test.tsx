// @vitest-environment jsdom
//
// Dashboard reorder (#952 / QW-3): the page now renders three fixed zones in
// order — My work (On the floor now + MyWorkSection, which owns the tasks-due
// block and per-project blocker badges), Org risk (needs-attention chips),
// Demoted (stat tiles / upcoming / activity). The standalone "Blockers needing
// you" panel that used to sit between the bento board and MyWorkSection is
// gone — blockers now render in exactly two places (MyWorkSection + the
// needs-attention chip), not three.
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

const TASK = {
  id: "task1",
  title: "Confirm crew call times",
  status: "TODO",
  priority: "NORMAL",
  dueDate: null,
  overdue: false,
  projectId: "p1",
  projectName: "Live Gig",
  projectNumber: "260701",
};

vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeDashboardStats: () => ({ data: STATS, isLoading: false }),
  useNativeSubHireStats: () => ({ activeSubHires: 0, monthlySubHireCost: 0, overdueReturns: 0 }),
  useNativeUpcoming: () => [],
  useNativeHome: () => ({ userName: "Jayden", userId: "user1", myProjects: [MY_PROJECT] }),
  useNativeBlocking: () => [BLOCKER],
  useNativeActivity: () => ({ logs: [], testRecords: [], maintenanceRecords: [] }),
  useNativeMyOpenTasks: () => [TASK],
}));

import DashboardPage from "../page";

describe("DashboardPage reorder (smoke)", () => {
  it("renders zone 1 (My work) before zone 2 (Org risk) before zone 3 (stat tiles)", () => {
    const { container } = render(<DashboardPage />);
    const text = container.textContent ?? "";
    const floorIdx = text.indexOf("On the floor now");
    const myWorkIdx = text.indexOf("My work");
    const riskIdx = text.indexOf("Needs attention");
    const statIdx = text.indexOf("Active jobs");

    expect(floorIdx).toBeGreaterThan(-1);
    expect(myWorkIdx).toBeGreaterThan(-1);
    expect(riskIdx).toBeGreaterThan(-1);
    expect(statIdx).toBeGreaterThan(-1);

    expect(floorIdx).toBeLessThan(myWorkIdx);
    expect(myWorkIdx).toBeLessThan(riskIdx);
    expect(riskIdx).toBeLessThan(statIdx);
  });

  it("does not render a standalone 'Blockers needing you' panel — MyWorkSection owns it now", () => {
    render(<DashboardPage />);
    expect(screen.queryByText("Blockers needing you")).toBeNull();
  });

  it("surfaces the blocker exactly once via MyWorkSection's per-project badge, plus the needs-attention chip", () => {
    render(<DashboardPage />);
    // The needs-attention chip.
    expect(screen.getByText(/blocker.*need you/)).toBeDefined();
    // MyWorkSection's per-project blocker count badge.
    expect(screen.getByText("1 blocker")).toBeDefined();
  });

  it("passes myOpenTasks through to MyWorkSection's tasks-due block", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Confirm crew call times")).toBeDefined();
  });

  it("renders the org-risk zone with the needs-attention chips", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Needs attention")).toBeDefined();
  });
});
