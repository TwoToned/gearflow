"use client";

import * as React from "react";
import { FileText, MessageSquare, Package, X } from "lucide-react";

import { TASK_LINK_KIND_LABEL, linkChipText, type TaskLink, type TaskLinkKind } from "@/lib/task-links";
import { cn, focusRing } from "@/lib/utils";

const ICONS: Record<TaskLinkKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  lineItem: Package,
  file: FileText,
  discussion: MessageSquare,
};

const MAX_SHOWN = 3;

/**
 * A task's links as small chips (UX Phase 10 Slice E): the target's label, a kind
 * icon, a click that opens it (the tab / section that owns it). `onRemove` adds an ✕
 * (the task sheet); a row shows up to three and a `+n` count. Absent when none.
 */
export function TaskLinkChips({
  links,
  onOpen,
  onRemove,
  showAll = false,
}: {
  links: readonly TaskLink[] | undefined;
  onOpen?: (link: TaskLink) => void;
  onRemove?: (link: TaskLink) => void;
  showAll?: boolean;
}) {
  if (!links || links.length === 0) return null;
  const shown = showAll ? links : links.slice(0, MAX_SHOWN);
  const more = links.length - shown.length;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Linked items">
      {shown.map((l) => {
        const Icon = ICONS[l.kind];
        return (
          <li key={l.id} className="flex items-center rounded-full border border-line bg-paper-2 text-caption text-ink-2">
            <button
              type="button"
              onClick={() => onOpen?.(l)}
              aria-label={`${TASK_LINK_KIND_LABEL[l.kind]}: ${l.label}`}
              className={cn("flex items-center gap-1 rounded-full py-0.5 pl-2 hover:text-ink", onRemove ? "pr-1" : "pr-2", focusRing)}
            >
              <Icon className="size-3" aria-hidden />
              {linkChipText(l)}
            </button>
            {onRemove && (
              <button type="button" onClick={() => onRemove(l)} aria-label={`Unlink ${l.label}`} className={cn("rounded-full p-1 text-muted hover:text-ink", focusRing)}>
                <X className="size-3" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
      {more > 0 && <li className="text-caption text-muted">+{more}</li>}
    </ul>
  );
}
