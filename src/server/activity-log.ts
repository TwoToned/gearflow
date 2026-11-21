"use server";

import { getOrgContext } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { toCsv } from "@/lib/csv";
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

  const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity Name", "Summary", "Details"];
  const rows = items.map((item) => [
    new Date(item.createdAt).toISOString(),
    item.userName,
    item.action,
    item.entityType,
    item.entityName,
    item.summary,
    item.details ? JSON.stringify(item.details) : "",
  ]);

  return toCsv(headers, rows);
}
