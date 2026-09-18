// @vitest-environment jsdom
//
// `<DashboardGrid>` smoke coverage (#1267) — per CLAUDE.md's Tooltip-crash
// precedent, a drag-and-resize library integrated wrong can crash on mount
// in ways typecheck/lint won't catch (react-grid-layout's `GridItem` CLONES
// `<DashboardCard>` to attach position/drag/resize props directly onto its
// root node — a non-forwarding shell would silently break the whole grid).
// This mocks `@/lib/dashboard-widgets`' registry to trivial fixtures so it
// exercises the grid engine itself, not any real widget's data hooks.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// jsdom has no `window.matchMedia` — mock the mobile hook directly (same
// convention as e.g. equipment-mobile-cards.smoke.test.tsx) rather than
// polyfilling it. `mobileState` is mutated per-test to cover both render
// paths without needing a second test file.
const mobileState = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileState.isMobile }));

function FixtureWidgetA() {
  return <p>Fixture A content</p>;
}
function FixtureWidgetB() {
  return <p>Fixture B content</p>;
}

vi.mock("@/lib/dashboard-widgets", () => ({
  GRID_COLS: 12,
  DASHBOARD_WIDGET_REGISTRY: {
    fixtureA: {
      kind: "fixtureA",
      title: "Fixture A",
      description: "A fixture widget.",
      component: FixtureWidgetA,
      defaultSize: { w: 4, h: 2 },
      minSize: { w: 2, h: 2 },
    },
    fixtureB: {
      kind: "fixtureB",
      title: "Fixture B",
      description: "Another fixture widget.",
      component: FixtureWidgetB,
      defaultSize: { w: 4, h: 2 },
      minSize: { w: 2, h: 2 },
    },
  },
}));

import { DashboardGrid } from "../dashboard-grid";
import type { DashboardLayoutWidget } from "@/lib/dashboard-widgets";

// Cast through the real `DashboardLayoutWidget` type: the fixture kinds
// above aren't part of the real `DashboardWidgetKind` union (the registry
// itself is mocked, so the runtime lookup is fine) — this test exercises the
// grid engine, not the real widget catalog.
const WIDGETS = [
  { id: "fixtureA", kind: "fixtureA", x: 0, y: 0, w: 4, h: 2 },
  { id: "fixtureB", kind: "fixtureB", x: 4, y: 0, w: 4, h: 2 },
] as unknown as DashboardLayoutWidget[];

describe("DashboardGrid (smoke)", () => {
  it("renders every widget's title and content without crashing (desktop, view mode)", () => {
    render(<DashboardGrid widgets={WIDGETS} editMode={false} orgId="org1" onLayoutChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Fixture A")).toBeDefined();
    expect(screen.getByText("Fixture A content")).toBeDefined();
    expect(screen.getByText("Fixture B")).toBeDefined();
    expect(screen.getByText("Fixture B content")).toBeDefined();
  });

  it("hides the remove button in view mode and shows it in Customize (edit) mode", () => {
    const { rerender } = render(
      <DashboardGrid widgets={WIDGETS} editMode={false} orgId="org1" onLayoutChange={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Remove Fixture A")).toBeNull();

    rerender(<DashboardGrid widgets={WIDGETS} editMode onRemove={vi.fn()} orgId="org1" onLayoutChange={vi.fn()} />);
    expect(screen.getByLabelText("Remove Fixture A")).toBeDefined();
  });

  it("clicking a widget's remove button in edit mode calls onRemove with its id", () => {
    const onRemove = vi.fn();
    render(<DashboardGrid widgets={WIDGETS} editMode orgId="org1" onLayoutChange={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Fixture A"));
    expect(onRemove).toHaveBeenCalledWith("fixtureA");
  });

  it("renders a plain stacked column on mobile — no react-grid-layout mount", () => {
    mobileState.isMobile = true;
    try {
      render(<DashboardGrid widgets={WIDGETS} editMode={false} orgId="org1" onLayoutChange={vi.fn()} onRemove={vi.fn()} />);
      expect(screen.getByText("Fixture A")).toBeDefined();
      expect(screen.getByText("Fixture B")).toBeDefined();
    } finally {
      mobileState.isMobile = false;
    }
  });
});
