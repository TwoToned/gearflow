"use client";

import Link from "next/link";
import { useEntityActivityLog } from "@/hooks/use-activity-log";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { EmptyState } from "@/components/ui/empty-state";

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
  /** Number of events to render. Defaults to 5; the "View all" link routes to /activity for the full history. */
  limit?: number;
}

export function ActivityTimeline({ entityType, entityId, limit = 5 }: ActivityTimelineProps) {
  const { data, isLoading } = useEntityActivityLog(entityType, entityId, limit);

  const items = (data?.items ?? []) as Record<string, unknown>[];
  const total = data?.total ?? 0;

  if (isLoading) {
    return <p className="text-sm text-fg-3">Loading activity...</p>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Nothing has moved. Suspiciously peaceful."
      />
    );
  }

  const viewAllHref = `/activity?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;

  return (
    <div className="space-y-3">
      {items.map((log: Record<string, unknown>) => {
        const action = log.action as string;
        const details = log.details as Record<string, unknown> | null;
        const changes = details?.changes as Array<{ field: string; from: unknown; to: unknown; fromLabel?: string; toLabel?: string }> | undefined;

        return (
          <div key={log.id as string} className="flex gap-3 text-sm">
            <div className="flex flex-col items-center">
              <div className="mt-1 size-2 rounded-full bg-fg-3/40" />
              <div className="flex-1 w-px bg-border" />
            </div>
            <div className="flex-1 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusIndicator category="activity" value={action} label={action.replace(/_/g, " ")} variant="pill" />
                <span className="text-fg-3 text-xs">
                  {formatDate(log.createdAt as string)}
                </span>
              </div>
              <p className="mt-0.5">{String(log.summary)}</p>
              {typeof log.userName === "string" && log.userName && (
                <p className="text-xs text-fg-3">by {log.userName}</p>
              )}
              {changes && changes.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {changes.map((c, i) => (
                    <p key={i} className="text-xs text-fg-3">
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
      {total > items.length && (
        <Link
          href={viewAllHref}
          className="block text-xs text-fg-3 underline-offset-2 hover:underline"
        >
          View all {total} events →
        </Link>
      )}
    </div>
  );
}
