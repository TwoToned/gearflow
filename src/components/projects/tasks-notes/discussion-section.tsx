"use client";

import { CommentThreadBody } from "@/components/collaboration/comment-thread-panel";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../../convex/_generated/api";
import { focusRing, cn } from "@/lib/utils";

/**
 * The job-level discussion, on the Tasks & notes tab (UX Phase 10, spec §8c): the
 * SAME thread list and composer the Sheet uses (`CommentThreadBody`), with the
 * `@ Mention ▾` picker and the `Blocking` switch, replies, `Resolve` and `Block
 * prep`. Line-item threads stay on their rows on Equipment and are only COUNTED
 * here (`On line items · 2 open ↗`). Nothing about who may block or resolve changes.
 */
export function DiscussionSection({
  projectId,
  orgId,
  onOpenEquipment,
}: {
  projectId: string;
  orgId: string | undefined;
  onOpenEquipment: () => void;
}) {
  const counts = useAuthedQuery(api.collaboration.listThreadCommentCounts, orgId ? { orgId, entityType: "project", entityId: projectId } : "skip");
  const onLineItems = Object.entries(counts ?? {})
    .filter(([key]) => key !== "__entity__")
    .reduce((n, [, c]) => n + c.open, 0);
  if (!orgId) return null;
  return (
    <div className="flex flex-col">
      {onLineItems > 0 && (
        <button type="button" onClick={onOpenEquipment} className={cn("mb-1 self-start rounded-sm text-caption text-muted hover:text-ink hover:underline", focusRing)}>
          On line items · {onLineItems} open ↗
        </button>
      )}
      <CommentThreadBody orgId={orgId} entityType="project" entityId={projectId} projectId={projectId} enabled />
    </div>
  );
}
