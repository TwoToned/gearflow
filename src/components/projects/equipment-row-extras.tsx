"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";

import { CommentThreadPanel } from "@/components/collaboration/comment-thread-panel";
import { StatusWord } from "@/components/ui/status-word";
import type { StatusValue } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";
import { LineAssetsIndicator } from "./line-assets-indicator";
import type { LineItemData } from "./equipment-row-types";

/**
 * The row furniture the live Equipment page carried that the `LineRow` facts
 * do not model: the per-line discussion badge and the per-unit serial
 * indicator. Both render in the Stage cell (desktop `cells.status`), after the
 * stage word, so the row keeps one calm line. Phone ignores `cells`; the
 * RowEditorSheet slice carries both there.
 */

export interface CommentCount {
  open: number;
  total: number;
  blockingOpen: number;
}

/** Everything the comment badge needs; absent = the tab has no org/project yet. */
export interface CommentTarget {
  orgId: string;
  projectId: string;
  counts?: Record<string, CommentCount>;
}

function commentTitle(blocking: number, open: number): string {
  if (blocking > 0) return `${blocking} blocking comment${blocking === 1 ? "" : "s"}`;
  if (open > 0) return `${open} open comment${open === 1 ? "" : "s"}`;
  return "Comments";
}

/** Count + opens the discussion, as live. Quiet until the row is hovered unless it has open comments. */
export function CommentButton({
  target,
  lineId,
  targetType = "lineItem",
}: {
  target: CommentTarget;
  lineId: string;
  /** `group` for a Project Group head (its thread is keyed by the group id). */
  targetType?: "lineItem" | "group";
}) {
  const c = target.counts?.[lineId];
  const open = c?.open ?? 0;
  const blocking = c?.blockingOpen ?? 0;
  const count = blocking > 0 ? blocking : open;
  return (
    <CommentThreadPanel
      orgId={target.orgId}
      entityType="project"
      entityId={target.projectId}
      targetType={targetType}
      targetId={lineId}
      triggerLabel=""
    >
      <button
        type="button"
        aria-label={commentTitle(blocking, open)}
        title={commentTitle(blocking, open)}
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 rounded-sm text-caption transition-opacity hover:text-ink focus-visible:opacity-100",
          count > 0 ? (blocking > 0 ? "text-red-text" : "text-ink-2") : "text-muted",
          count === 0 && targetType === "lineItem" && "opacity-0 group-hover/row:opacity-100",
        )}
      >
        <MessageCircle className="size-3.5" aria-hidden="true" />
        {count > 0 && <span className="font-mono tabular-nums">{count}</span>}
      </button>
    </CommentThreadPanel>
  );
}

/** Stage word + discussion badge + serial indicator. */
export function StageCell({
  status,
  item,
  comments,
  kitMember,
  disableReassign,
}: {
  status?: StatusValue;
  item: LineItemData;
  comments?: CommentTarget;
  kitMember?: boolean;
  disableReassign?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {status && <StatusWord status={status} />}
      <LineAssetsIndicator
        units={item.units}
        lineAssetTag={item.asset?.assetTag}
        lineItemId={item.id}
        modelId={item.modelId}
        kitMember={kitMember}
        disableReassign={disableReassign}
      />
      {comments && <CommentButton target={comments} lineId={item.id} />}
    </span>
  );
}
