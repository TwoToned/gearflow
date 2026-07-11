"use client";

import * as React from "react";
import { Rows3, Rows2, LayoutGrid, Table as TableIcon } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { usePersistentPref } from "@/hooks/use-persistent-pref";

// ── View mode (presentation) and density (row height) are TWO separate axes ──
// (eng review): `Cards | Table` is *what* the data looks like; `Compact |
// Comfortable | Relaxed` is *how tall* each row is. They persist independently.

export type ViewMode = "cards" | "table";
export type Density = "compact" | "comfortable" | "relaxed";

/** Minimum row height in px per density. Comfortable is the default (§15, 44px floor). */
export const DENSITY_ROW_PX: Record<Density, number> = {
  compact: 44,
  comfortable: 52,
  relaxed: 60,
};

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<
    readonly [value: T, Icon: React.ComponentType<{ className?: string }>, label: string]
  >;
  /** Accessible group label, e.g. "Row density". */
  label: string;
  className?: string;
}

/**
 * House segmented control (matches the assets Grid/Table toggle). Each segment is a
 * 44px touch target on coarse pointers, shrinking on fine pointers.
 */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex rounded-[var(--r)] border border-line bg-card p-0.5 shadow-[var(--sh-card)]",
        className,
      )}
    >
      {options.map(([v, Icon, optLabel]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[calc(var(--r)-3px)] px-3 text-table-cell font-medium transition-colors",
            "min-h-11 pointer-coarse:min-h-11 sm:min-h-0 sm:py-1.5",
            focusRing,
            value === v
              ? "bg-elev text-ink shadow-[var(--sh-stk)]"
              : "text-muted hover:text-ink",
          )}
        >
          <Icon className="h-4 w-4" />
          <span>{optLabel}</span>
        </button>
      ))}
    </div>
  );
}

export function ViewModeToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}) {
  return (
    <Segmented
      label="View mode"
      value={value}
      onChange={onChange}
      className={className}
      options={[
        ["cards", LayoutGrid, "Cards"],
        ["table", TableIcon, "Table"],
      ]}
    />
  );
}

export function DensityToggle({
  value,
  onChange,
  className,
}: {
  value: Density;
  onChange: (value: Density) => void;
  className?: string;
}) {
  return (
    <Segmented
      label="Row density"
      value={value}
      onChange={onChange}
      className={className}
      options={[
        ["compact", Rows3, "Compact"],
        ["comfortable", Rows2, "Comfortable"],
        ["relaxed", LayoutGrid, "Relaxed"],
      ]}
    />
  );
}

/**
 * Per-user, per-table view-mode preference. Comparison/matrix surfaces should NOT
 * offer `cards`; pass `defaultValue: "table"` and simply don't render `ViewModeToggle`.
 */
export function useViewModePreference(tableId: string, defaultValue: ViewMode = "cards") {
  return usePersistentPref<ViewMode>(`${tableId}-viewmode`, defaultValue);
}

/** Per-user, per-table density preference (defaults to Comfortable / 52px). */
export function useDensityPreference(tableId: string, defaultValue: Density = "comfortable") {
  return usePersistentPref<Density>(`${tableId}-density`, defaultValue);
}
