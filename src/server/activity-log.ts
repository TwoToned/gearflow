"use server";

import { getOrgContext } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { type ActivityLogFilters, startMs, endMs } from "@/lib/activity-log-filters";

/**
 * Activity-log CSV export (KEEP-SERVER-ONLY — Node string generation). The
 * getActivityLogs / getEntityActivityLog READS moved browser-direct
 * (`src/hooks/use-activity-log.ts` → `api.activityLog.list` / `listByEntity`); only
 * the CSV serialization stays server-side per the DoD's Node-bound exclusion.
 */
export async function exportActivityLogCSV(filters: ActivityLogFilters = {}) {
  const { organizationId } = await getOrgContext();
  const { entityType, entityId, action, userId, search, startDate, endDate, agentAuthored } = filters;

  const convex = await getConvexClient();
  const items: Array<{
    createdAt: string | Date;
    userName: string;
    action: string;
    entityType: string;
    entityName: string;
    summary: string;
    details?: unknown;
  }> = await convex.query(api.activityLog.exportRows, {
    orgId: organizationId,
    entityType,
    entityId,
    action,
    userId,
    search,
    startDateMs: startMs(startDate),
    endDateMs: endMs(endDate),
    agentAuthored,
  });

  const escape = (s: string) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity Name", "Summary", "Details"];
  const rows = items.map((item) => [
    new Date(item.createdAt).toISOString(),
    escape(item.userName),
    item.action,
    item.entityType,
    escape(item.entityName),
    escape(item.summary),
    item.details ? escape(JSON.stringify(item.details)) : "",
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
