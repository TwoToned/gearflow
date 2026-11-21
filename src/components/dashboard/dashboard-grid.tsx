"use client";

import { useCallback, useMemo } from "react";
import { Responsive, useContainerWidth } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCurrentRole } from "@/lib/use-permissions";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { DashboardBoardContext } from "@/components/dashboard/widget-chrome";
import { useSetupPanelVisible } from "@/components/dashboard/setup-panel";
import { canOpenLink } from "@/lib/dashboard-links";
import {
  DASHBOARD_WIDGET_REGISTRY,
  GRID_COLS,
  readingOrder,
  renderedWidgets,
  type DashboardLayoutWidget,
  type DashboardWidgetKind,
} from "@/lib/dashboard-widgets";
import { cn } from "@/lib/utils";
import "./dashboard-grid.module.css";

const ROW_HEIGHT = 32;
const MARGIN: readonly [number, number] = [32, 16];

/** What a drag or resize did, so the page can name it in the Undo toast. */
export interface LayoutChange {
  verb: "Moved" | "Resized";
  kind: DashboardWidgetKind;
}

/**
 * What actually renders, and RGL's view of it. The setup panel renders nothing
 * once dismissed or complete, but a card can't know its child rendered nothing,
 * so the slot is dropped here, before RGL.
 */
function useBoardModel(widgets: DashboardLayoutWidget[], orgId: string | undefined) {
  const setupVisible = useSetupPanelVisible(orgId);
  const visibleWidgets = useMemo(() => renderedWidgets(widgets, setupVisible), [widgets, setupVisible]);
  const kinds = useMemo(() => new Set(visibleWidgets.map((w) => w.kind)), [visibleWidgets]);
  const rglLayout: Layout = useMemo(
    () =>
      visibleWidgets.map((w) => {
        const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
        return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: def.minSize.w, minH: def.minSize.h, maxW: def.maxSize?.w, maxH: def.maxSize?.h };
      }),
    [visibleWidgets],
  );
  return { visibleWidgets, kinds, rglLayout };
}

/**
 * Home's grid engine: `react-grid-layout` v2 (`Responsive` + `useContainerWidth`).
 * Customise (drag, resize, hide) is DESKTOP ONLY (D89): on a phone the board is a
 * read-only column in the saved (y, x) order, with the stat tiles two to a row.
 * Touch reordering was already judged unreliable, so the phone shows the
 * arrangement made on a desktop rather than offering a weaker editor.
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
  onLayoutChange: (next: DashboardLayoutWidget[], change: LayoutChange) => void;
  onRemove: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const { width, containerRef, mounted } = useContainerWidth();
  const { permissions } = useCurrentRole();
  const editing = editMode && !isMobile;
  const { visibleWidgets, kinds, rglLayout } = useBoardModel(widgets, orgId);

  const commitFromRglLayout = useCallback(
    (layout: Layout, item: LayoutItem | null, verb: LayoutChange["verb"]) => {
      // Start from the FULL widget list so a hidden slot's saved position survives
      // an unrelated drag untouched (`layout` only holds what RGL rendered).
      const moved = new Map(layout.map((it) => [it.i, it]));
      const next = widgets.map((w) => {
        const it = moved.get(w.id);
        return it ? { ...w, x: it.x, y: it.y, w: it.w, h: it.h } : w;
      });
      const kind = widgets.find((w) => w.id === item?.i)?.kind;
      if (kind) onLayoutChange(next, { verb, kind });
    },
    [widgets, onLayoutChange],
  );

  const card = (w: DashboardLayoutWidget) => {
    const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
    const Component = def.component;
    const viewAll = def.viewAll && canOpenLink(def.viewAll, permissions) ? def.viewAll : undefined;
    return (
      <DashboardCard
        key={w.id}
        title={def.title}
        bare={def.stat}
        viewAll={viewAll}
        editMode={editing}
        onRemove={editing ? () => onRemove(w.id) : undefined}
        widget={<Component orgId={orgId} />}
        className={isMobile ? cn(def.stat ? "col-span-1" : "col-span-2") : undefined}
      />
    );
  };

  if (isMobile) {
    return (
      <DashboardBoardContext.Provider value={kinds}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6">{readingOrder(visibleWidgets).map(card)}</div>
      </DashboardBoardContext.Provider>
    );
  }

  return (
    <DashboardBoardContext.Provider value={kinds}>
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
            dragConfig={{ enabled: editing, handle: ".dashboard-drag-handle", threshold: 3 }}
            resizeConfig={{ enabled: editing, handles: ["se"] }}
            onDragStop={(layout, _old, item) => commitFromRglLayout(layout, item, "Moved")}
            onResizeStop={(layout, _old, item) => commitFromRglLayout(layout, item, "Resized")}
          >
            {visibleWidgets.map(card)}
          </Responsive>
        )}
      </div>
    </DashboardBoardContext.Provider>
  );
}
