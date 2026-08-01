// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const mockReadiness = vi.fn();
const mockConflicts = vi.fn<() => { data: ReservationConflict[]; isLoading: boolean }>(() => ({
  data: [],
  isLoading: false,
}));

vi.mock("@/hooks/use-project-readiness", () => ({
  useProjectReadiness: () => mockReadiness(),
}));
vi.mock("@/hooks/use-project-conflicts", () => ({
  useProjectConflicts: () => mockConflicts(),
  refreshProjectConflicts: vi.fn(),
}));
vi.mock("@/hooks/use-billing-summary", () => ({
  useRecalcAutoPricedLines: () => ({ recalc: vi.fn() }),
  useProjectPricingStaleness: () => 0,
}));
// The permission gate is exercised elsewhere; here it must not swallow the
// actions the panel is being asserted on.
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ProjectReadinessPanel } from "@/components/projects/project-readiness-panel";
import { buildReadinessChecks, summariseReadiness } from "@/lib/project-readiness-checks";
import type { ReservationConflict } from "@/lib/reservation-conflicts-types";

function stateFrom(over: Parameters<typeof buildReadinessChecks>[0]) {
  const checks = buildReadinessChecks(over);
  return { checks, summary: summariseReadiness(checks), isLoading: false };
}

const CLEAN: Parameters<typeof buildReadinessChecks>[0] = {
  hasWindow: true,
  windowLabel: "12 – 16 Aug",
  gear: { hard: [], pencilled: [] },
  crew: { unconfirmedCount: 0, activeCount: 0, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 },
  pricing: { unpriced: [], unpricedCount: 0 },
  conflicts: [],
  staleLineCount: 0,
};

function renderPanel(onNavigateTab = vi.fn()) {
  render(<ProjectReadinessPanel projectId="p1" orgId="org1" onNavigateTab={onNavigateTab} />);
  return onNavigateTab;
}

describe("ProjectReadinessPanel smoke", () => {
  beforeEach(() => {
    mockReadiness.mockReset();
    mockConflicts.mockReset();
    mockConflicts.mockReturnValue({ data: [], isLoading: false });
  });

  it("collapses to a single line when every check passes", () => {
    mockReadiness.mockReturnValue(stateFrom(CLEAN));
    renderPanel();
    expect(screen.getByText(/Ready — all 6 checks pass/)).toBeTruthy();
    // The individual rows stay hidden until asked for.
    expect(screen.queryByText("Enough gear for this window")).toBeNull();
  });

  it("expands the full checklist on request, showing passing rows too", () => {
    mockReadiness.mockReturnValue(stateFrom(CLEAN));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Show checks" }));
    expect(screen.getByText("Enough gear for this window")).toBeTruthy();
    expect(screen.getByText("No assets double-booked")).toBeTruthy();
    expect(screen.getByText("Pricing is current for these dates")).toBeTruthy();
  });

  it("shows blocking and warning counts, and renders every row, when things are wrong", () => {
    mockReadiness.mockReturnValue(
      stateFrom({
        ...CLEAN,
        gear: { hard: [{ modelName: "Shure ULXD4Q", qty: 2 }], pencilled: [] },
        crew: { unconfirmedCount: 3, activeCount: 11, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 },
      }),
    );
    renderPanel();
    expect(screen.getByText("1 blocking")).toBeTruthy();
    expect(screen.getByText("1 to check")).toBeTruthy();
    expect(screen.getByText("Gear short for this window")).toBeTruthy();
    expect(screen.getByText("3 of 11 crew unconfirmed")).toBeTruthy();
  });

  it("sends a failing crew check to the tab that fixes it", () => {
    mockReadiness.mockReturnValue(
      stateFrom({
        ...CLEAN,
        crew: { unconfirmedCount: 2, activeCount: 4, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 },
      }),
    );
    const onNavigateTab = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Chase crew" }));
    expect(onNavigateTab).toHaveBeenCalledWith("labour");
  });

  it("expands a conflict row to reveal the swap action inline", () => {
    const conflict = {
      lineItemId: "li1",
      assetId: "a1",
      assetTag: "MIX-004",
      modelId: "m1",
      modelName: "SQ-7",
      conflictingProject: {
        id: "p2",
        projectNumber: "P-2044",
        name: "Other",
        status: "CONFIRMED",
        rentalStartDate: null,
        rentalEndDate: null,
      },
      conflictingLineItemId: "li2",
    };
    mockConflicts.mockReturnValue({ data: [conflict], isLoading: false });
    mockReadiness.mockReturnValue(stateFrom({ ...CLEAN, conflicts: [conflict] }));
    renderPanel();

    expect(screen.getByText("1 asset double-booked")).toBeTruthy();
    // Collapsed: the offending asset isn't listed until the row is opened.
    expect(screen.queryByText("MIX-004")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("MIX-004")).toBeTruthy();
  });

  it("never reports all-clear when a check could not run", () => {
    mockReadiness.mockReturnValue(stateFrom({ ...CLEAN, hasWindow: false, windowLabel: undefined }));
    renderPanel();
    expect(screen.queryByText(/Ready — all/)).toBeNull();
    expect(screen.getByText("1 not checked")).toBeTruthy();
    expect(screen.getByText("Gear availability not checked")).toBeTruthy();
  });
});
