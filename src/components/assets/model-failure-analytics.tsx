"use client";

import { useServerQuery } from "@/hooks/use-server-query";
import { BarChart3, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { getModelFailureAnalytics } from "@/server/check-records";
import { useActiveOrganization } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";

type AnalyticsItem = {
  checkItemId: string;
  label: string;
  type: string;
  totalChecks: number;
  failCount: number;
  failRate: number;
};

export function ModelFailureAnalytics({ modelId }: { modelId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: analytics = [], isLoading } = useServerQuery({
    queryKey: ["model-failure-analytics", orgId, modelId],
    queryFn: () => getModelFailureAnalytics(modelId),
  });

  const items = analytics as AnalyticsItem[];
  const withData = items.filter((i) => i.totalChecks > 0);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-32 rounded-[var(--r)]" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3.5 w-full rounded-[var(--r)]" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (withData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--r)] border-2 border-dashed border-line-2 py-8 text-center text-muted">
        <BarChart3 className="mb-2 h-6 w-6 opacity-50" />
        <p className="text-ui-text text-ink">No check data yet</p>
        <p className="mt-1 text-caption">
          Failure rates will appear after checks are performed on assets of this model.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="t-heading text-ink flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted" />
        Failure rates
      </h3>
      <div className="space-y-2">
        {withData.map((item) => {
          const pct = Math.round(item.failRate * 100);
          const isHigh = pct >= 25;
          return (
            <div key={item.checkItemId} className="space-y-1">
              <div className="flex items-center justify-between text-caption">
                <span className="font-medium text-ink truncate mr-2">{item.label}</span>
                <span className={cn("shrink-0 tabular-nums", isHigh ? "text-red font-semibold" : "text-muted")}>
                  {isHigh && <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />}
                  {pct}% ({item.failCount}/{item.totalChecks})
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-line-2 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full motion-safe:transition-all",
                    isHigh ? "bg-red" : pct >= 10 ? "bg-warn" : "bg-ok",
                  )}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
