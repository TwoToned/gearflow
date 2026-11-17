"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface StageFilterOption {
  key: string;
  label: string;
  count: number;
}

/**
 * The row of stage counts as underlined words with mono counts
 * (`To pick 18 · Prepped 24 · Out 0`, spec §5.3). Controlled so a page can
 * keep the value in the URL. Clicking the active word clears the filter
 * (`onChange(null)`) only when `clearable`. Scrolls sideways on phone. Arrow keys / Home / End move
 * focus between words; Enter/Space (native button) selects.
 */
export function StageFilter({
  options,
  value,
  onChange,
  label = "Filter by stage",
  clearable = false,
  className,
}: {
  options: StageFilterOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  label?: string;
  /** Clicking the active word clears it (`onChange(null)`). Off by default: the
   *  warehouse job page always has exactly one stage; the floor has an `All` word. */
  clearable?: boolean;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const target =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (target < 0) return;
    e.preventDefault();
    refs.current[target]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn("flex items-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on && clearable ? null : o.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent text-[13px] font-semibold outline-none",
              "focus-visible:ring-2 focus-visible:ring-red",
              on ? "border-red text-ink" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
            <span className="font-mono text-[12px] tabular-nums text-faint">{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}
