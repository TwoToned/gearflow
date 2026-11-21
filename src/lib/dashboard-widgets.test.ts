// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGET_ORDER,
  DASHBOARD_WIDGET_REGISTRY,
  DEFAULT_DASHBOARD_LAYOUT,
  GRID_COLS,
  readingOrder,
  renderedWidgets,
  type DashboardLayoutWidget,
} from "@/lib/dashboard-widgets";

const kinds = (ws: DashboardLayoutWidget[]) => readingOrder(ws).map((w) => w.kind);

function overlaps(a: DashboardLayoutWidget, b: DashboardLayoutWidget): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The pre-Phase-11 default board, as saved rows still hold it. */
const PRE_D87: DashboardLayoutWidget[] = [
  { id: "finishSetupChecklist", kind: "finishSetupChecklist", x: 0, y: 0, w: 6, h: 6 },
  { id: "activationChecklist", kind: "activationChecklist", x: 6, y: 0, w: 6, h: 6 },
  { id: "myTasks", kind: "myTasks", x: 0, y: 6, w: 6, h: 6 },
  { id: "onTheFloorNow", kind: "onTheFloorNow", x: 0, y: 14, w: 12, h: 5 },
  { id: "needsAttention", kind: "needsAttention", x: 0, y: 19, w: 12, h: 3 },
  { id: "statActiveJobs", kind: "statActiveJobs", x: 0, y: 22, w: 3, h: 4 },
  { id: "todayWorkList", kind: "todayWorkList" as never, x: 3, y: 22, w: 3, h: 4 },
];

describe("DEFAULT_DASHBOARD_LAYOUT (D87)", () => {
  it("reads setup → four stats → My tasks + Needs attention → floor → upcoming → activity", () => {
    expect(kinds(renderedWidgets(DEFAULT_DASHBOARD_LAYOUT, true))).toEqual([
      "finishSetupChecklist",
      "statActiveJobs",
      "statOverdueReturns",
      "statGearDeployed",
      "statCrewBooked",
      "myTasks",
      "needsAttention",
      "onTheFloorNow",
      "upcomingProjects",
      "recentActivity",
    ]);
  });

  it("My tasks and Needs attention sit side by side, 6 + 6", () => {
    const by = (k: string) => DEFAULT_DASHBOARD_LAYOUT.find((w) => w.kind === k)!;
    expect([by("myTasks").x, by("myTasks").w, by("needsAttention").x, by("needsAttention").w]).toEqual([0, 6, 6, 6]);
    expect(by("myTasks").y).toBe(by("needsAttention").y);
  });

  it("every kind is registered, fits the grid, respects its bounds and overlaps nothing", () => {
    expect(new Set(DEFAULT_DASHBOARD_LAYOUT.map((w) => w.kind))).toEqual(new Set(DASHBOARD_WIDGET_ORDER));
    for (const w of DEFAULT_DASHBOARD_LAYOUT) {
      const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
      expect(w.x + w.w).toBeLessThanOrEqual(GRID_COLS);
      expect(w.w).toBeGreaterThanOrEqual(def.minSize.w);
      expect(w.h).toBeGreaterThanOrEqual(def.minSize.h);
      for (const o of DEFAULT_DASHBOARD_LAYOUT) if (o !== w) expect(overlaps(w, o), `${w.kind} × ${o.kind}`).toBe(false);
    }
  });
});

describe("renderedWidgets", () => {
  it("a pre-D87 saved board still loads: unknown kinds dropped, the order it was saved in kept", () => {
    expect(kinds(renderedWidgets(PRE_D87, true))).toEqual(["finishSetupChecklist", "myTasks", "onTheFloorNow", "needsAttention", "statActiveJobs"]);
  });

  it("the two setup kinds are ONE panel, in the first slot present; none while it has nothing to show", () => {
    const actFirst = PRE_D87.map((w) => (w.kind === "activationChecklist" ? { ...w, x: 0, y: -1 } : w));
    expect(kinds(renderedWidgets(actFirst, true))[0]).toBe("activationChecklist");
    expect(kinds(renderedWidgets(actFirst, true))).not.toContain("finishSetupChecklist");
    expect(kinds(renderedWidgets(PRE_D87, false))).not.toContain("finishSetupChecklist");
  });
});
