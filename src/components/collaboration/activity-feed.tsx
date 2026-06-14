"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { getForegroundColor, getUserInitials, timeAgo } from "@/lib/collaboration-colors";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  _id: string;
  actorUserId: string;
  actorName: string;
  actorColor: string;
  entityType: string;
  entityId: string;
  targetType?: string;
  targetId?: string;
  action: string;
  summary: string;
  metadata?: unknown;
  createdAt: number;
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const initials = getUserInitials(event.actorName);
  const fg = getForegroundColor(event.actorColor);

  return (
    <div className="flex gap-2.5 py-2">
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold mt-0.5"
        style={{ background: event.actorColor, color: fg }}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-medium">{event.actorName}</span>{" "}
          <span className="text-muted-foreground">{event.summary}</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(event.createdAt)}</p>
      </div>
    </div>
  );
}

interface ProjectActivityFeedProps {
  orgId: string;
  entityType: string;
  entityId: string;
  limit?: number;
  className?: string;
  emptyText?: string;
}

/**
 * Realtime activity feed for a collaborative entity. Subscribes to Convex
 * and updates whenever new activity is logged.
 */
export function ProjectActivityFeed({
  orgId,
  entityType,
  entityId,
  limit = 30,
  className,
  emptyText = "No recent activity.",
}: ProjectActivityFeedProps) {
  const events = useAuthedQuery(
    api.collaboration.listActivityEvents,
    orgId ? { orgId, entityType, entityId, limit } : "skip"
  ) as ActivityEvent[] | undefined;

  if (!events) return null;

  return (
    <div className={cn("divide-y", className)}>
      {events.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
      )}
      {events.map((e) => (
        <ActivityRow key={e._id} event={e} />
      ))}
    </div>
  );
}
