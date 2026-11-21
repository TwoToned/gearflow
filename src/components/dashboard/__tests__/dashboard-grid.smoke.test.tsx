// @vitest-environment jsdom
//
// `<DashboardGrid>` smoke coverage: a drag-and-resize library integrated wrong
// can crash on mount in ways typecheck/lint won't catch (react-grid-layout's
// `GridItem` CLONES `<DashboardCard>` to attach position/drag props onto its
// root). The registry is mocked to trivial fixtures so this exercises the grid
// engine and the card chrome, not any real widget's data hooks.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const state = vi.hoisted(() => ({ isMobile: false, permissions: { project: ["read"] } as Record<string, string[]> | null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.isMobile }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: state.permissions, isLoading: false }) }));
vi.mock("@/components/dashboard/setup-panel", () => ({ useSetupPanelVisible: () => true }));

function FixtureWidgetA() {
  return <p>Fixture A content</p>;
}
function FixtureStat() {
  return <p>42</p>;
}

vi.mock("@/lib/dashboard-widgets", () => {
  const registry = {
    fixtureA: {
      kind: "fixtureA",
      title: "Fixture A",
      description: "A fixture widget.",
      component: FixtureWidgetA,
      defaultSize: { w: 4, h: 2 },
      minSize: { w: 2, h: 2 },
      viewAll: { href: "/projects?seg=booked", tip: "Jobs · Booked", resource: "project" },
    },
    fixtureB: {
      kind: "fixtureB",
      title: "Fixture B",
      description: "A gated View all.",
      component: FixtureWidgetA,
      defaultSize: { w: 4, h: 2 },
      minSize: { w: 2, h: 2 },
      viewAll: { href: "/activity", tip: "Activity", resource: "reports" },
    },
    fixtureStat: {
      kind: "fixtureStat",
      title: "Fixture stat",
      description: "A stat tile.",
      component: FixtureStat,
      defaultSize: { w: 3, h: 4 },
      minSize: { w: 2, h: 4 },
      stat: true,
    },
  };
  type W = { x: number; y: number };
  return {
    GRID_COLS: 12,
    DASHBOARD_WIDGET_REGISTRY: registry,
    readingOrder: <T extends W>(ws: T[]) => [...ws].sort((a, b) => a.y - b.y || a.x - b.x),
    renderedWidgets: <T extends { kind: string }>(ws: T[]) => ws.filter((w) => w.kind in registry),
  };
});

import { DashboardGrid } from "../dashboard-grid";
import type { DashboardLayoutWidget } from "@/lib/dashboard-widgets";

const WIDGETS = [
  { id: "fixtureA", kind: "fixtureA", x: 0, y: 0, w: 4, h: 2 },
  { id: "fixtureB", kind: "fixtureB", x: 4, y: 0, w: 4, h: 2 },
  { id: "fixtureStat", kind: "fixtureStat", x: 8, y: 0, w: 3, h: 4 },
  { id: "gone", kind: "removedKind", x: 0, y: 9, w: 4, h: 2 },
] as unknown as DashboardLayoutWidget[];

const grid = (editMode: boolean, onRemove = vi.fn()) => (
  <DashboardGrid widgets={WIDGETS} editMode={editMode} orgId="org1" onLayoutChange={vi.fn()} onRemove={onRemove} />
);

beforeEach(() => {
  state.isMobile = false;
  state.permissions = { project: ["read"] };
});

describe("DashboardGrid (smoke)", () => {
  it("renders every known widget's title and content; an unknown saved kind is dropped", () => {
    render(grid(false));
    expect(screen.getByText("Fixture A")).toBeDefined();
    expect(screen.getAllByText("Fixture A content")).toHaveLength(2);
    expect(screen.queryByText("removedKind")).toBeNull();
  });

  it("a stat tile has no header outside Customise, and one inside it", () => {
    const { rerender } = render(grid(false));
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.queryByText("Fixture stat")).toBeNull();
    rerender(grid(true));
    expect(screen.getByText("Fixture stat")).toBeDefined();
  });

  it("View all › is a link to the widget's list, absent when the role can't open it", () => {
    render(grid(false));
    const links = screen.getAllByRole("link", { name: "View all ›" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/projects?seg=booked");
    expect(links[0].getAttribute("title")).toBe("Jobs · Booked");
  });

  it("hides the Hide button in view mode and shows it in Customise mode", () => {
    const { rerender } = render(grid(false));
    expect(screen.queryByLabelText("Hide Fixture A")).toBeNull();
    rerender(grid(true));
    expect(screen.getByLabelText("Hide Fixture A")).toBeDefined();
  });

  it("clicking Hide in Customise mode calls onRemove with the widget id", () => {
    const onRemove = vi.fn();
    render(grid(true, onRemove));
    fireEvent.click(screen.getByLabelText("Hide Fixture A"));
    expect(onRemove).toHaveBeenCalledWith("fixtureA");
  });

  it("phone: a read-only column even if Customise was on (D89), stat tiles two to a row", () => {
    state.isMobile = true;
    const { container } = render(grid(true));
    expect(screen.getByText("Fixture B")).toBeDefined();
    expect(screen.queryByLabelText("Hide Fixture A")).toBeNull();
    expect(container.querySelector(".react-grid-layout")).toBeNull();
    const stat = screen.getByText("42").closest(".dashboard-widget-card");
    expect(stat?.className).toContain("col-span-1");
  });
});
