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
import { rolePermissions } from "@/lib/permissions";

const state = vi.hoisted(() => ({ isMobile: false, permissions: { project: ["read"] } as Record<string, string[]> | null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.isMobile }));
vi.mock("@/lib/use-permissions", () => ({ useCurrentRole: () => ({ permissions: state.permissions, isLoading: false }) }));
const setupCalls = vi.hoisted(() => ({ panel: [] as (string | undefined)[], analytics: [] as (string | undefined)[] }));
vi.mock("@/components/dashboard/setup-panel", () => ({
  useSetupPanelState: (orgId?: string) => {
    setupCalls.panel.push(orgId);
    return { visible: true, loading: false, title: "Get started" };
  },
}));
vi.mock("@/hooks/use-activation-milestones", () => ({
  useActivationMilestoneAnalytics: (orgId?: string) => void setupCalls.analytics.push(orgId),
}));

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
    fixtureSetup: {
      kind: "fixtureSetup",
      title: "Finish setup",
      description: "A setup slot.",
      component: FixtureWidgetA,
      defaultSize: { w: 12, h: 5 },
      minSize: { w: 3, h: 4 },
      setupSlot: true,
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
    boardHasSetup: (ws: { kind: string }[]) => ws.some((w) => (registry as Record<string, { setupSlot?: boolean }>)[w.kind]?.setupSlot),
  };
});

import { DashboardGrid } from "../dashboard-grid";
import type { DashboardLayoutWidget } from "@/lib/dashboard-widgets";

const WIDGETS = [
  { id: "fixtureA", kind: "fixtureA", x: 0, y: 0, w: 4, h: 2 },
  { id: "fixtureB", kind: "fixtureB", x: 4, y: 0, w: 4, h: 2 },
  { id: "fixtureStat", kind: "fixtureStat", x: 8, y: 0, w: 3, h: 4 },
  { id: "fixtureSetup", kind: "fixtureSetup", x: 0, y: 4, w: 12, h: 5 },
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
    expect(screen.getAllByText("Fixture A content")).toHaveLength(3);
    expect(screen.queryByText("removedKind")).toBeNull();
  });

  it("with no setup kind on the board the panel's reads are skipped; milestone analytics still run", () => {
    setupCalls.panel = [];
    setupCalls.analytics = [];
    render(<DashboardGrid widgets={WIDGETS.filter((w) => (w.kind as string) !== "fixtureSetup")} editMode={false} orgId="org1" onLayoutChange={vi.fn()} onRemove={vi.fn()} />);
    expect(setupCalls.panel.every((o) => o === undefined)).toBe(true);
    expect(setupCalls.analytics).toContain("org1");
    setupCalls.panel = [];
    render(grid(false));
    expect(setupCalls.panel).toContain("org1");
  });

  it("the setup slot is titled by what the panel shows, not by the kind hosting it", () => {
    render(grid(false));
    expect(screen.getByRole("heading", { name: "Get started" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Finish setup" })).toBeNull();
  });

  it("a stat tile has no header outside Customise, and one inside it", () => {
    const { rerender } = render(grid(false));
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.queryByText("Fixture stat")).toBeNull();
    rerender(grid(true));
    expect(screen.getByText("Fixture stat")).toBeDefined();
  });

  it("View all › is a link to the widget's list, absent when the role can't open it", () => {
    // A real role table: `member` holds `reports: ["view"]` (not "read"), so Activity opens.
    state.permissions = rolePermissions.member as Record<string, string[]>;
    const { unmount } = render(grid(false));
    const links = screen.getAllByRole("link", { name: "View all ›" });
    expect(links.map((l) => l.getAttribute("href"))).toContain("/activity");
    expect(links).toHaveLength(2);
    unmount();

    state.permissions = { ...(rolePermissions.member as Record<string, string[]>), reports: [] };
    render(grid(false));
    expect(screen.getAllByRole("link", { name: "View all ›" }).map((l) => l.getAttribute("href"))).not.toContain("/activity");
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
