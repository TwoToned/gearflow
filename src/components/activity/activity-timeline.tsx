"use client";

import { useQuery } from "@tanstack/react-query";
import { getEntityActivityLog } from "@/server/activity-log";
import { useActiveOrganization } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const actionColors: Record<string, string> = {
  CREATE: "bg-emerald-500/15 text-emerald-500",
  UPDATE: "bg-blue-500/15 text-blue-500",
  DELETE: "bg-red-500/15 text-red-500",
  STATUS_CHANGE: "bg-purple-500/15 text-purple-500",
  CHECK_OUT: "bg-amber-500/15 text-amber-500",
  CHECK_IN: "bg-amber-500/15 text-amber-500",
  ASSIGN: "bg-teal-500/15 text-teal-500",
  UNASSIGN: "bg-teal-500/15 text-teal-500",
  INVITE: "bg-indigo-500/15 text-indigo-500",
};

function formatDate(date: string | Date) {
  return new Date(date).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ActivityTimelineProps {
  entityType: string;
  entityId: string;
}

export function ActivityTimeline({ entityType, entityId }: ActivityTimelineProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: logs, isLoading } = useQuery({
    queryKey: ["entity-activity", orgId, entityType, entityId],
    queryFn: () => getEntityActivityLog(entityType, entityId),
    enabled: !!entityId,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading activity...</p>;
  }

  if (!logs || logs.length === 0) {
    return <EmptyState preset="activity" />;
  }

  return (
    <div className="space-y-3">
      {logs.map((log: Record<string, unknown>) => {
        const action = log.action as string;
        const details = log.details as Record<string, unknown> | null;
        const changes = details?.changes as Array<{ field: string; from: unknown; to: unknown; fromLabel?: string; toLabel?: string }> | undefined;

        return (
          <div key={log.id as string} className="flex gap-3 text-sm">
            <div className="flex flex-col items-center">
              <div className="mt-1 size-2 rounded-full bg-muted-foreground/40" />
              <div className="flex-1 w-px bg-border" />
            </div>
            <div className="flex-1 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className={cn("text-xs", actionColors[action])}>
                  {action.replace(/_/g, " ")}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {formatDate(log.createdAt as string)}
                </span>
              </div>
              <p className="mt-0.5">{String(log.summary)}</p>
              {typeof log.userName === "string" && log.userName && (
                <p className="text-xs text-muted-foreground">by {log.userName}</p>
              )}
              {changes && changes.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {changes.map((c, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      <span className="font-medium">{c.field}</span>:{" "}
                      <span className="line-through">{c.fromLabel || String(c.from ?? "—")}</span>
                      {" → "}
                      <span>{c.toLabel || String(c.to ?? "—")}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
