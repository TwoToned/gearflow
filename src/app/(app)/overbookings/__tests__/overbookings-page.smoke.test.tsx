// @vitest-environment jsdom
//
// Overbookings & Gaps board (WS3 #942) — smoke test that actually renders the
// page, per CLAUDE.md's overlay-UI convention (typecheck/lint/build all pass
// on a broken form; only rendering catches runtime-only crashes like a
// missing TooltipProvider or a Base-UI-in-Radix-modal nesting bug).
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));

const BOARD_DATA = {
  range: { start: 0, end: 30 * 86_400_000 },
  gearHard: [
    {
      modelId: "m1",
      modelName: "SM58",
      qty: 2,
      spanStart: 0,
      spanEnd: 86_400_000,
      projects: [{ id: "p1", name: "Big Show", projectNumber: "PRJ-1" }],
    },
  ],
  gearPencilled: [],
  saleStockToProcure: [{ modelId: "m2", modelName: "Gaffer Tape", shortfallQty: 3, contributingSaleLines: [] }],
  // B1: a Mon–Wed run whose only call is Monday's is short Tue and Wed.
  servicesMissingCrew: [
    {
      serviceId: "s1", projectId: "p1", projectName: "Big Show", projectNumber: "PRJ-1", title: "Show run",
      date: Date.UTC(2026, 10, 16), endDate: Date.UTC(2026, 10, 18), crewCountRequired: 1, assignedCount: 0, shortfall: 1,
      shortDays: [{ day: Date.UTC(2026, 10, 17), shortfall: 1 }, { day: Date.UTC(2026, 10, 18), shortfall: 1 }],
    },
  ],
  unconfirmedCrew: [],
  crewDoubleBookings: [],
};

vi.mock("@/hooks/use-native-overbooking-board", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-native-overbooking-board")>(
    "@/hooks/use-native-overbooking-board",
  );
  return {
    ...actual,
    useNativeOverbookingBoard: () => ({ data: BOARD_DATA, isLoading: false }),
  };
});

vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: { project: ["read"] }, isLoading: false }),
}));

import OverbookingsPage from "../page";

describe("OverbookingsPage smoke", () => {
  it("renders without throwing, showing the hard-overbooking and sale-stock sections", () => {
    render(<OverbookingsPage />);
    expect(screen.getByText("Overbookings & Gaps")).toBeTruthy();
    expect(screen.getByText(/SM58/)).toBeTruthy();
    expect(screen.getByText(/Gaffer Tape/)).toBeTruthy();
  });

  it("a missing-crew run names its short days (B1: the shortfall is per day)", () => {
    render(<OverbookingsPage />);
    expect(screen.getByText(/Show run — PRJ-1 Big Show/)).toBeTruthy();
    expect(screen.getByText(/Tue, Wed short/)).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
  });

  it("opens the sub-hire shortfall dialog without crashing and lists the contributing project", () => {
    render(<OverbookingsPage />);
    fireEvent.click(screen.getByText("Sub-hire this"));
    expect(screen.getByText(/Sub-hire SM58/)).toBeTruthy();
    expect(screen.getByText(/PRJ-1 — Big Show/)).toBeTruthy();
  });
});
