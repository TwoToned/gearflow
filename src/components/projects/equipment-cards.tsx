"use client";

import * as React from "react";
import { Container } from "lucide-react";
import { cn } from "@/lib/utils";
import { type DropHighlight, dropHighlightClass } from "./equipment-row-types";

/**
 * Section heading for a category (folder glyph + label + optional action),
 * still used by the crew panel. The Equipment tab's own rows and heads render
 * through `LineRowList` sections (equipment-sections.tsx).
 */
export function CategoryCardHeading({
  name,
  badge,
  action,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
  dropHighlight,
}: {
  name: string;
  /** Optional status pill rendered beside the name. */
  badge?: React.ReactNode;
  action?: React.ReactNode;
  /** Whole-surface drag entry point (hold anywhere). */
  dragHandleRef?: (el: HTMLElement | null) => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
  dragStyle?: React.CSSProperties;
  isDragging?: boolean;
  dropHighlight?: DropHighlight;
}) {
  return (
    <div
      ref={dragHandleRef}
      data-drag-row="true"
      {...(dragAttributes as React.HTMLAttributes<HTMLDivElement> | undefined)}
      {...(dragListeners as React.HTMLAttributes<HTMLDivElement> | undefined)}
      style={dragStyle}
      className={cn(
        "flex touch-manipulation items-center justify-between gap-2 rounded-[var(--r)] px-1 pb-0.5 pt-3 active:cursor-grabbing md:cursor-grab",
        isDragging && "opacity-40",
        dropHighlightClass(dropHighlight),
      )}
    >
      <div className="flex items-center gap-1.5 text-caption font-semibold text-ink-2">
        <Container className="h-3.5 w-3.5" />
        {name}
        {badge}
      </div>
      {action}
    </div>
  );
}
