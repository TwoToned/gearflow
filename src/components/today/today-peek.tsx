"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X, Check, ExternalLink, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import { TodaySubtasks } from "./today-subtasks";
import type { TodayItem } from "./today-types";

interface TodayPeekProps {
  item: TodayItem | null;
  canEdit: boolean;
  orgId: string | undefined;
  onClose: () => void;
  onToggleDone: (item: TodayItem) => void;
  /** Mentions only — "make a task" (design doc §9's Triage table). */
  onMakeTask: (item: TodayItem) => void;
}

/** Split out of TodayPeek (R-3.6) — the footer's per-kind action buttons. */
function PeekActions({
  item,
  canEdit,
  onToggleDone,
  onMakeTask,
}: Pick<TodayPeekProps, "item" | "canEdit" | "onToggleDone" | "onMakeTask">) {
  if (!item) return null;
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-3">
      {item.kind === "task" && canEdit && (
        <Button variant="line" size="sm" onClick={() => onToggleDone(item)}>
          <Check className="h-4 w-4" /> {item.done ? "Mark not done" : "Mark done"}
        </Button>
      )}
      {item.kind === "mention" && canEdit && (
        <Button variant="line" size="sm" onClick={() => onMakeTask(item)}>
          <ListPlus className="h-4 w-4" /> Make a task
        </Button>
      )}
      {item.href && (
        <Button asChild variant="line" size="sm">
          <Link href={item.href}>
            <ExternalLink className="h-4 w-4" /> Open
          </Link>
        </Button>
      )}
    </div>
  );
}

/**
 * Today's peek (work-layer.md §8.1, decision D8A) — a NON-MODAL, page-level
 * side panel. Deliberately not `Dialog`/`Sheet`: a Radix modal Dialog sets
 * `pointer-events: none` on `document.body`, and this panel's own controls
 * (soon: mention typeahead, snooze menu) would be swallowed by that lock —
 * the exact footgun documented in CLAUDE.md's composition note. Plain
 * positioned markup, manual focus management: focus moves to the heading on
 * open, returns to the triggering row on Esc, and the row list stays
 * arrow-navigable while this is open (it isn't a focus trap).
 */
export function TodayPeek({ item, canEdit, orgId, onClose, onToggleDone, onMakeTask }: TodayPeekProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (item) headingRef.current?.focus();
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      role="complementary"
      aria-labelledby="today-peek-heading"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-line bg-card shadow-[var(--sh-hover)] sm:relative sm:inset-auto sm:z-auto sm:max-w-none sm:rounded-[var(--r-lg)] sm:border sm:shadow-[var(--sh-card)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2
          ref={headingRef}
          id="today-peek-heading"
          tabIndex={-1}
          className="text-[14px] font-medium text-ink outline-none"
        >
          {item.kind === "task" ? "Task" : "Mention"}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn("touch-target -m-2.5 flex items-center justify-center rounded-full text-muted hover:text-ink", focusRing)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          <p className={cn("text-[15px] font-medium", item.done ? "text-muted line-through" : "text-ink")}>{item.title}</p>
          <p className="text-caption text-muted">{item.contextLine}</p>
        </div>
        {item.kind === "task" && (
          <TodaySubtasks parentId={(item.raw as { id: string }).id} orgId={orgId} canEdit={canEdit} />
        )}
      </div>

      <PeekActions item={item} canEdit={canEdit} onToggleDone={onToggleDone} onMakeTask={onMakeTask} />
    </div>
  );
}
