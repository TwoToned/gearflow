"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared selection action bar for bulk operations on a list/table surface.
 *
 * Renders "{count} selected", a slot for surface-specific action buttons, and a
 * Clear button. Mirrors the inline bar in `asset-table.tsx` (the original bulk
 * pattern) so every surface reads the same. Render it conditionally on
 * `count > 0`; keep the action `children` as `<Button size="sm" variant="line">`
 * for visual consistency.
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
  if (count <= 0) return null;
  return (
    <div
      className={
        "flex flex-wrap items-center gap-3 rounded-[var(--r)] border-2 border-line-2 bg-paper-2/50 px-4 py-2 " +
        (className ?? "")
      }
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
}
