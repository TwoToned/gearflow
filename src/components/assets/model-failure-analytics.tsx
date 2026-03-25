"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, BarChart3, AlertTriangle } from "lucide-react";

import { getModelFailureAnalytics } from "@/server/check-records";
import { useActiveOrganization } from "@/lib/auth-client";

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

  const { data: analytics = [], isLoading } = useQuery({
    queryKey: ["model-failure-analytics", orgId, modelId],
    queryFn: () => getModelFailureAnalytics(modelId),
  });

  const items = analytics as AnalyticsItem[];
  const withData = items.filter((i) => i.totalChecks > 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-fg-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading analytics...
      </div>
    );
  }

  if (withData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-fg-3">
        <BarChart3 className="mb-2 h-6 w-6 opacity-50" />
        <p className="text-sm">No check data yet</p>
        <p className="mt-1 text-xs">
          Failure rates will appear after checks are performed on assets of this model.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-fg-3" />
        Failure Rates
      </h3>
      <div className="space-y-2">
        {withData.map((item) => {
          const pct = Math.round(item.failRate * 100);
          const isHigh = pct >= 25;
          return (
            <div key={item.checkItemId} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium truncate mr-2">{item.label}</span>
                <span className={`shrink-0 ${isHigh ? "text-destructive font-semibold" : "text-fg-3"}`}>
                  {isHigh && <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />}
                  {pct}% ({item.failCount}/{item.totalChecks})
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isHigh ? "bg-destructive" : pct >= 10 ? "bg-amber-500" : "bg-green-500"
                  }`}
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
