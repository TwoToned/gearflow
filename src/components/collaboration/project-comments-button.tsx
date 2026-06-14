"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MessageCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommentThreadPanel } from "./comment-thread-panel";

/**
 * Project-level comments button with an always-on blocking indicator. Unlike the
 * generic panel trigger (which only counts threads once the sheet is open), this
 * subscribes to the project's blocking summary so the badge is live on the page.
 */
export function ProjectCommentsButton({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const summary = useQuery(api.collaboration.getProjectBlockingSummary, {
    orgId,
    projectId,
  }) as { count: number } | undefined;
  const blockingCount = summary?.count ?? 0;

  return (
    <CommentThreadPanel orgId={orgId} entityType="project" entityId={projectId}>
      <Button variant="outline" size="sm" className="relative">
        {blockingCount > 0 ? (
          <ShieldAlert className="mr-2 h-4 w-4 text-red-600" />
        ) : (
          <MessageCircle className="mr-2 h-4 w-4" />
        )}
        <span className="hidden sm:inline">Comments</span>
        {blockingCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] text-white">
            {blockingCount}
          </span>
        )}
      </Button>
    </CommentThreadPanel>
  );
}
