"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export interface TabStripItem {
  value: string;
  label: string;
  /** `44` or `9/14` — shown muted after the word. */
  count?: string | number;
}

/**
 * The ONE underlined-word tab strip with counts (spec §10 as amended by D92):
 * `Equipment 44 · Tasks & notes 9/14`. Used by job and record pages. Controlled
 * (`value`/`onValueChange`), because tabs deep-link via `?tab=` and the
 * readiness list navigates between them. Radix supplies roles and the
 * arrow / Home / End keys. Scrolls sideways on a phone (no clipping), and
 * brings the active tab into view on mount.
 *
 * It renders the strip only; the page renders its own panels. (Give each
 * panel `role="tabpanel"` + `aria-labelledby={`${idPrefix}-${value}`}` if the
 * surface wants the full pattern.)
 */
export function TabStrip({
  items,
  value,
  onValueChange,
  idPrefix = "tab",
  className,
  "aria-label": ariaLabel = "Sections",
}: {
  items: TabStripItem[];
  value: string;
  onValueChange: (value: string) => void;
  idPrefix?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const active = list.querySelector<HTMLElement>('[data-state="active"]');
    if (!active) return;
    const lr = list.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    list.scrollBy({ left: ar.left - lr.left - list.clientWidth / 2 + ar.width / 2 });
  }, []);

  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List
        ref={listRef}
        aria-label={ariaLabel}
        className={cn(
          "flex min-w-0 max-w-full items-end gap-6 overflow-x-auto border-b border-line",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {items.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            id={`${idPrefix}-${t.value}`}
            value={t.value}
            className={cn(
              "relative -mb-px shrink-0 whitespace-nowrap border-b-2 border-transparent py-3 text-[14px] font-medium text-muted",
              "[@media(pointer:coarse)]:min-h-11",
              "data-[state=active]:border-ink data-[state=active]:text-ink",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="text-muted tabular-nums">{" "}{t.count}</span>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
