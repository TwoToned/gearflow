"use client";

import { forwardRef, useState } from "react";
import Link from "next/link";
import { GripVertical, X } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import type { DashboardLink } from "@/lib/dashboard-links";
import { HEADER_ACTION_TAP, WidgetEditModeContext, WidgetHeaderContext } from "@/components/dashboard/widget-chrome";

export interface DashboardCardProps {
  /** Title in the header. In Customise mode the header is also the drag handle. */
  title: string;
  /** Customise mode: the drag handle and the Hide button only exist in it (the
   *  resize corner is hidden in CSS outside it, via `data-edit-mode`, because
   *  react-grid-layout always mounts that node). */
  editMode: boolean;
  onRemove?: () => void;
  /** A stat tile is a number, not a list: no header outside Customise mode. */
  bare?: boolean;
  /** `View all ›` target, already gated by the caller (absent when the role can't open it). */
  viewAll?: DashboardLink;
  /** The widget's own content. NOT passed as `children`: react-grid-layout's
   *  `Resizable` clones this element and MERGES its resize handle into
   *  `props.children`, so `children` is reserved for what RGL injects. */
  widget: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * The one shell every Home widget renders in (UX Phase 11, §6c.2): a hairline
 * top rule, a 13 px/600 title, a muted mono count and a quiet `View all ›`. No
 * card, no border box, no shadow. `forwardRef` + spreading `...rest` is
 * required, not decorative: react-grid-layout's `GridItem` clones this element
 * to attach its position `ref`/`style`/`className` and drag handlers to the
 * root node.
 */
function CardHeader({
  title,
  editMode,
  onRemove,
  viewAll,
  countRef,
  actionRef,
}: Pick<DashboardCardProps, "title" | "editMode" | "onRemove" | "viewAll"> & {
  countRef: (el: HTMLElement | null) => void;
  actionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[26px] items-center gap-2",
        editMode && "dashboard-drag-handle -mx-1.5 cursor-grab rounded-md px-1.5 hover:bg-paper-2 active:cursor-grabbing",
      )}
    >
      {editMode && <GripVertical className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />}
      <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
      {/* Muted, not faint: the count is real text and must pass WCAG AA contrast (harness-a11y). */}
      <span ref={countRef} className="font-mono text-[11.5px] font-medium text-muted tabular-nums" />
      <span className="ml-auto flex items-center gap-3">
        <span ref={actionRef} className="flex items-center" />
        {viewAll && !editMode && (
          <Link
            href={viewAll.href}
            title={viewAll.tip}
            className={cn(HEADER_ACTION_TAP, "whitespace-nowrap rounded-sm text-[12.5px] font-semibold text-muted hover:text-ink", focusRing)}
          >
            View all ›
          </Link>
        )}
        {editMode && onRemove && (
          <button
            type="button"
            aria-label={`Hide ${title}`}
            onClick={onRemove}
            className={cn("touch-target flex items-center justify-center rounded-full p-1 text-muted hover:text-t-out", focusRing)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

export const DashboardCard = forwardRef<HTMLDivElement, DashboardCardProps>(function DashboardCard(
  { title, editMode, onRemove, bare = false, viewAll, widget, className, style, children, ...rest },
  ref,
) {
  const [countEl, setCountEl] = useState<HTMLElement | null>(null);
  const [actionEl, setActionEl] = useState<HTMLElement | null>(null);
  return (
    <div
      ref={ref}
      data-edit-mode={editMode || undefined}
      className={cn("dashboard-widget-card relative flex h-full flex-col border-t border-line pt-2.5", className)}
      style={style}
      {...rest}
    >
      {(editMode || !bare) && (
        <CardHeader title={title} editMode={editMode} onRemove={onRemove} viewAll={viewAll} countRef={setCountEl} actionRef={setActionEl} />
      )}
      {/* Scroll stays for a widget whose content genuinely overflows (an open-ended feed);
          only the native scrollbar chrome is hidden, the app's existing convention. */}
      <div className="min-h-0 flex-1 overflow-auto pt-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <WidgetEditModeContext.Provider value={editMode}>
          <WidgetHeaderContext.Provider value={{ count: countEl, action: actionEl }}>{widget}</WidgetHeaderContext.Provider>
        </WidgetEditModeContext.Provider>
      </div>
      {children}
    </div>
  );
});
