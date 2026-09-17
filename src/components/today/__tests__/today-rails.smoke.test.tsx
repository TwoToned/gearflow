// @vitest-environment jsdom
//
// Today's day rail / needs-you rail (work-layer phase 0.5, #1242) — the
// state table in work-layer.md §8.1: skeleton while loading, a plain empty
// caption, a left-bar retry notice on a first-load failure, and "keeps last
// good data" (a muted footnote, not a blank list) when a REFRESH fails after
// data already loaded.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TodayDayRail } from "../today-day-rail";
import { TodayNeedsYouRail } from "../today-needs-you-rail";

describe("TodayDayRail", () => {
  it("shows a retry notice on a first-load failure (no data yet)", () => {
    const refresh = vi.fn();
    render(<TodayDayRail entries={undefined} asOf={undefined} error={new Error("boom")} onRefresh={refresh} />);
    expect(screen.getByText(/Couldn't load/)).toBeDefined();
    fireEvent.click(screen.getByText("Retry"));
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps showing the last loaded entries when a later refresh fails, with a muted footnote", () => {
    render(
      <TodayDayRail
        entries={[{ key: "a", hue: "purple", time: "09:00", title: "Load-in", subtitle: "", href: "/crew/planner", sortKey: 0 }]}
        asOf={Date.now()}
        error={new Error("boom")}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("Load-in")).toBeDefined();
    expect(screen.getByText(/Couldn't refresh/)).toBeDefined();
  });

  it("shows a plain empty caption when there's nothing scheduled and no error", () => {
    render(<TodayDayRail entries={[]} asOf={Date.now()} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText("Nothing scheduled.")).toBeDefined();
  });
});

describe("TodayNeedsYouRail", () => {
  const EMPTY = { declinedCrew: [], staleOffers: [], expiringQuotes: [] };

  it("shows a retry notice on a first-load failure", () => {
    const refresh = vi.fn();
    render(<TodayNeedsYouRail data={undefined} asOf={undefined} error={new Error("boom")} onRefresh={refresh} />);
    expect(screen.getByText(/Couldn't load/)).toBeDefined();
    fireEvent.click(screen.getByText("Retry"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a plain empty caption when nothing needs the caller", () => {
    render(<TodayNeedsYouRail data={EMPTY} asOf={Date.now()} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText("Nothing needs you.")).toBeDefined();
  });
});
