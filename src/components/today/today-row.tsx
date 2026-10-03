"use client";

import { AtSign, Check, Circle } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { intentStyles } from "@/lib/status-colors";
import type { TodayItem } from "./today-types";
import { FollowUpBadges } from "@/components/work/follow-up-badges";

interface TodayRowProps {
  item: TodayItem;
  active: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}

/**
 * Today's row anatomy (work-layer.md §8.1): status circle with a 44px
 * invisible hit area, title, context line, source badge, all wrapped so the
 * whole row opens the peek (D9A — tapping anywhere but the circle opens the
 * item). Overdue uses the error intent, never brand red (§1) — colours come
 * from `status-colors.ts` only, never a hand-rolled class.
 */
export function TodayRow({ item, active, canEdit, onOpen, onToggleDone }: TodayRowProps) {
  const overdueStyle = item.overdue ? intentStyles.error : null;

  return (
    <div
      role="button"
      tabIndex={0}
      data-today-row={item.key}
      aria-current={active ? "true" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-start gap-3 rounded-[var(--r)] border-l-2 border-transparent px-2 py-2.5 transition-colors hover:border-l-red hover:bg-elev",
        focusRing,
        active && "bg-elev border-l-red",
      )}
    >
      {item.kind === "task" ? (
        <button
          type="button"
          title={item.done ? "Mark not done" : "Mark done"}
          disabled={!canEdit}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone();
          }}
          className={cn(
            "touch-target -m-2.5 flex shrink-0 items-center justify-center rounded-full",
            canEdit ? "text-muted hover:text-primary" : "text-muted",
            focusRing,
          )}
        >
          {item.done ? (
            <Check className="h-[18px] w-[18px] text-primary" />
          ) : (
            <Circle className={cn("h-[18px] w-[18px]", overdueStyle?.text)} />
          )}
        </button>
      ) : (
        <span className={cn("touch-target -m-2.5 flex shrink-0 items-center justify-center rounded-full", intentStyles.info.text)} aria-hidden>
          <AtSign className="h-[18px] w-[18px]" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[14px]", item.done ? "text-muted line-through" : "text-ink-2")}>
          {item.title}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="truncate text-caption text-muted">{item.contextLine}</p>
          {item.kind === "mention" && (
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", intentStyles.info.pill)}>
              mention
            </span>
          )}
          {item.followUp && <FollowUpBadges urgent={item.followUp.urgent} />}
        </div>
      </div>
    </div>
  );
}
