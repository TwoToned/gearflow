"use client";

import { useCallback, useMemo } from "react";
import { Responsive, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { useActivationChecklistVisible } from "@/components/dashboard/activation-checklist";
import { useFinishSetupChecklistVisible } from "@/components/dashboard/finish-setup-checklist";
import {
  DASHBOARD_WIDGET_REGISTRY,
  GRID_COLS,
  type DashboardLayoutWidget,
} from "@/lib/dashboard-widgets";
import "./dashboard-grid.module.css";

const ROW_HEIGHT = 32;
const MARGIN: readonly [number, number] = [16, 16];

/**
 * The customizable dashboard's grid engine — `react-grid-layout` v2's
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

  // The setup/activation checklists disappear once dismissed or complete —
  // their `bare` render already returns null for that, but `<DashboardCard>`
  // doesn't know a null `widget` means "skip my own title bar too" (it can't:
  // React gives a parent no signal that a child rendered nothing). Compute
  // the two conditionally-empty widgets' visibility HERE, once, and filter
  // them out of what actually renders — never their own generic content
  // check, since every other widget kind always has something to show.
  const activationVisible = useActivationChecklistVisible(orgId);
  const finishSetupVisible = useFinishSetupChecklistVisible(orgId);
  const visibleWidgets = useMemo(
    () =>
      widgets.filter((w) => {
        if (w.kind === "activationChecklist") return activationVisible;
        if (w.kind === "finishSetupChecklist") return finishSetupVisible;
        return true;
      }),
    [widgets, activationVisible, finishSetupVisible],
  );

  const rglLayout: Layout = useMemo(
    () =>
      visibleWidgets.map((w) => {
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
    [visibleWidgets],
  );

  const commitFromRglLayout = useCallback(
    (layout: Layout) => {
      // Start from the FULL (unfiltered) widget list so a hidden checklist's
      // saved position/size survives an unrelated drag/resize untouched —
      // `layout` here only ever contains the currently-visible widgets RGL
      // knows about, never the ones this component chose not to render.
      const moved = new Map(layout.map((item) => [item.i, item]));
      const next = widgets.map((w) => {
        const item = moved.get(w.id);
        return item ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h } : w;
      });
      onLayoutChange(next);
    },
    [widgets, onLayoutChange],
  );

  if (isMobile) {
    const stacked = [...visibleWidgets].sort((a, b) => a.y - b.y || a.x - b.x);
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
          {visibleWidgets.map((w) => {
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
