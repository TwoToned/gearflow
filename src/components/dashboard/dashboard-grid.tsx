"use client";

import { useCallback, useMemo } from "react";
import { Responsive, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import {
  DASHBOARD_WIDGET_REGISTRY,
  GRID_COLS,
  type DashboardLayoutWidget,
} from "@/lib/dashboard-widgets";
import "./dashboard-grid.module.css";

const ROW_HEIGHT = 32;
const MARGIN: readonly [number, number] = [16, 16];

/**
 * The customizable dashboard's grid engine (#1267) — `react-grid-layout` v2's
 * hooks-based API (`Responsive` + `useContainerWidth`, replacing v1's
 * `WidthProvider(Responsive)` HOC; see the PR's dependency-justification
 * note). Below the mobile breakpoint, drag/resize are unreliable on touch —
 * matching the "sidebar stacks on mobile" convention, `<DashboardGrid>`
 * doesn't even mount react-grid-layout there; `useIsMobile()` (already used
 * for the sidebar) switches to a plain stacked column in the saved
 * (y, then x) order instead, so mobile Customize can still add/remove
 * widgets without needing touch drag-and-drop to work at all.
 */
export function DashboardGrid({
  widgets,
  editMode,
  orgId,
  onLayoutChange,
  onRemove,
}: {
  widgets: DashboardLayoutWidget[];
  editMode: boolean;
  orgId: string | undefined;
  onLayoutChange: (next: DashboardLayoutWidget[]) => void;
  onRemove: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const { width, containerRef, mounted } = useContainerWidth();

  const rglLayout: Layout = useMemo(
    () =>
      widgets.map((w) => {
        const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
        return {
          i: w.id,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          minW: def.minSize.w,
          minH: def.minSize.h,
          maxW: def.maxSize?.w,
          maxH: def.maxSize?.h,
        };
      }),
    [widgets],
  );

  const commitFromRglLayout = useCallback(
    (layout: Layout) => {
      const byId = new Map(widgets.map((w) => [w.id, w]));
      const next = layout
        .map((item) => {
          const existing = byId.get(item.i);
          if (!existing) return null;
          return { ...existing, x: item.x, y: item.y, w: item.w, h: item.h };
        })
        .filter((w): w is DashboardLayoutWidget => w !== null);
      onLayoutChange(next);
    },
    [widgets, onLayoutChange],
  );

  if (isMobile) {
    const stacked = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    return (
      <div className="flex flex-col gap-4">
        {stacked.map((w) => {
          const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
          const Component = def.component;
          return (
            <DashboardCard
              key={w.id}
              title={def.title}
              editMode={editMode}
              onRemove={editMode ? () => onRemove(w.id) : undefined}
              widget={<Component orgId={orgId} />}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      {mounted && (
        <Responsive
          className="dashboard-grid"
          width={width}
          layouts={{ lg: rglLayout }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: GRID_COLS }}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: editMode, handle: ".dashboard-drag-handle", threshold: 3 }}
          resizeConfig={{ enabled: editMode, handles: ["se"] }}
          onDragStop={(layout) => commitFromRglLayout(layout)}
          onResizeStop={(layout) => commitFromRglLayout(layout)}
        >
          {widgets.map((w) => {
            const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
            const Component = def.component;
            return (
              <DashboardCard
                key={w.id}
                title={def.title}
                editMode={editMode}
                onRemove={editMode ? () => onRemove(w.id) : undefined}
                widget={<Component orgId={orgId} />}
              />
            );
          })}
        </Responsive>
      )}
    </div>
  );
}
