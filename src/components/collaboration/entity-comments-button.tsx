"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommentThreadPanel } from "./comment-thread-panel";

/**
 * Generic entity-level comments button with a live open-thread count badge.
 * Reusable on any collaborative record (asset, client, supplier, …).
 *
 * For projects use ProjectCommentsButton instead — it also surfaces the
 * blocking-comment count that gates prep / send-out.
 */
export function EntityCommentsButton({
  orgId,
  entityType,
  entityId,
}: {
  orgId: string;
  entityType: string;
  entityId: string;
}) {
  const counts = useAuthedQuery(api.collaboration.listThreadCommentCounts, {
    orgId,
    entityType,
    entityId,
  }) as Record<string, { open: number; total: number; blockingOpen: number }> | undefined;
  // Entity-level threads (no sub-target) bucket under "__entity__".
  const open = counts?.["__entity__"]?.open ?? 0;

  return (
    <CommentThreadPanel orgId={orgId} entityType={entityType} entityId={entityId}>
      <Button variant="outline" size="sm" className="relative">
        <MessageCircle className="mr-2 h-4 w-4" />
        <span className="hidden sm:inline">Comments</span>
        {open > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bg-inset px-1 text-[9px] font-medium text-fg-2 ring-1 ring-border">
            {open}
          </span>
        )}
      </Button>
    </CommentThreadPanel>
  );
}
