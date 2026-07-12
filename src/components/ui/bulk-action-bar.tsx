"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Shared selection action bar for bulk operations on a list/table surface.
 *
 * Renders "{count} selected", a slot for surface-specific action buttons, and a
 * Clear button. Mirrors the inline bar in `asset-table.tsx` (the original bulk
 * pattern) so every surface reads the same. Render it conditionally on
 * `count > 0`; keep the action `children` as `<Button size="sm" variant="line">`
 * for visual consistency.
 *
 * **Desktop:** inline, in normal flow above the list (unchanged).
 * **Mobile:** the bar is **portaled to `<body>` and pinned above the bottom nav**
 * (`position: fixed`). This is deliberate — an inline bar that only exists while
 * something is selected reflows the whole list every time you select/deselect a
 * row, which reads as the screen "jumping around" on every tap. A fixed overlay
 * never touches the list's layout. We portal to `<body>` (not just `fixed` in
 * place) because the app-shell `<main>` keeps a lingering `transform` from its
 * page-enter animation (`animation-fill-mode: both` → `translateY(0)`), which
 * would otherwise make `fixed` resolve against `<main>` instead of the viewport.
 */
interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  /** Noun for the selected rows, e.g. "item" → "3 items selected". */
  itemLabel?: string;
  /** Surface-specific action buttons. */
  children?: React.ReactNode;
  className?: string;
}

export function BulkActionBar({
  count,
  onClear,
  itemLabel = "item",
  children,
  className,
}: BulkActionBarProps) {
  const isMobile = useIsMobile();
  if (count <= 0) return null;

  const bar = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[var(--r)] border-2 border-line-2 px-4 py-2",
        // Opaque + raised when floating on mobile so scrolling content doesn't
        // bleed through; the translucent inline look stays on desktop.
        isMobile ? "bg-elev shadow-[var(--sh-card)]" : "bg-paper-2/50",
        className,
      )}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-ui-text font-medium text-ink tabular-nums">
        {count} {itemLabel}
        {count === 1 ? "" : "s"} selected
      </span>
      {children}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear
      </Button>
    </div>
  );

  // Mobile: pin above the bottom nav (h-14 + safe area) via a body portal so the
  // list layout never shifts. env() lives in an inline style, not a Tailwind
  // arbitrary value (project convention for safe-area math).
  if (isMobile && typeof document !== "undefined") {
    return createPortal(
      <div
        className="fixed inset-x-2 z-40"
        style={{
          bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem)",
        }}
      >
        {bar}
      </div>,
      document.body,
    );
  }

  return bar;
}
