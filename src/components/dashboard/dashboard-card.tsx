"use client";

import { forwardRef } from "react";
import { GripVertical, X } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";

// Same hard-offset-shadow tile language as `dashboard/page.tsx`'s `TILE`
// (DESIGN.md "Dashboard Layout") — the widget board reuses it rather than
// inventing a second card look.
const CARD_BASE = "rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]";

export interface DashboardCardProps {
  /** Title shown in the header bar — also the accessible name for the
   *  remove button. */
  title: string;
  /** Edit ("Customize") mode — the drag handle and remove button only exist
   *  in this mode (conditionally rendered below), so a normal view has
   *  nothing that could swallow a click meant for the widget's own
   *  content/links. The resize handle is different: react-grid-layout always
   *  mounts that DOM node regardless of `resizeConfig.enabled`, so hiding it
   *  outside edit mode is done in CSS via the `data-edit-mode` attribute on
   *  the root below, not by conditional rendering here. */
  editMode: boolean;
  onRemove?: () => void;
  /** The widget's own rendered content. Deliberately NOT passed as JSX
   *  `children` at the call site — react-grid-layout's `Resizable` clones
   *  this component and MERGES its own resize-handle element(s) into
   *  `props.children` (see the dependency-justification note in the PR body
   *  / dashboard-grid.tsx), so `children` here is reserved for whatever RGL
   *  injects, rendered as a plain sibling of the header/body rather than
   *  nested inside the scrollable body (which could clip an absolutely
   *  positioned handle). */
  widget: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * The one shared shell every dashboard/Today widget renders inside
 * (CLAUDE.md: "Each widget renders inside one shared `<DashboardCard>`
 * shell"). `forwardRef` + spreading `...rest` is required, not decorative:
 * `<DashboardGrid>` wraps each widget in react-grid-layout's `GridItem`,
 * which clones THIS element to attach its position `ref`/`style`/
 * `className` and (when draggable) its mouse/touch handlers directly onto
 * the card's own root node — a plain non-forwarding component would make
 * the whole grid silently non-interactive.
 */
export const DashboardCard = forwardRef<HTMLDivElement, DashboardCardProps>(function DashboardCard(
  { title, editMode, onRemove, widget, className, style, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-edit-mode={editMode || undefined}
      className={cn(CARD_BASE, "dashboard-widget-card relative flex h-full flex-col overflow-hidden", className)}
      style={style}
      {...rest}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-3.5 py-2.5">
        {editMode && (
          <span
            className="dashboard-drag-handle -ml-1 flex cursor-grab touch-none items-center rounded p-1 text-faint hover:text-muted active:cursor-grabbing"
            aria-hidden
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        <h2 className="t-overline flex-1 truncate text-muted">{title}</h2>
        {editMode && onRemove && (
          <button
            type="button"
            aria-label={`Remove ${title}`}
            onClick={onRemove}
            className={cn(
              "touch-target -m-1.5 flex items-center justify-center rounded-full p-1 text-faint hover:text-t-out",
              focusRing,
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Scroll stays functional for a widget whose content genuinely
          overflows its card (an open-ended feed, a long work list) — only
          the native scrollbar CHROME is hidden, matching the app's existing
          hide-the-bar-keep-the-scroll convention (see e.g. tabs.tsx,
          project-lifecycle.tsx). A visible track/thumb inside every card,
          even ones that barely overflow by a pixel, reads as broken chrome
          rather than an intentional list. */}
      <div className="min-h-0 flex-1 overflow-auto p-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {widget}
      </div>
      {children}
    </div>
  );
});
