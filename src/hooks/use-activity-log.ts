"use client";

import { useActiveOrganization } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { type ActivityLogFilters, startMs, endMs } from "@/lib/activity-log-filters";

/**
 * Browser-direct activity-log reads (Phase 3 — replaces the getActivityLogs /
 * getEntityActivityLog server actions). `api.activityLog.list` / `listByEntity` are
 * browser-callable (`requireOrgRead`). The date→ms coercion the server action did
 * moves here. (CSV export stays server-only.)
 */

export function useActivityLogs(filters: ActivityLogFilters = {}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const {
    page = 1,
    pageSize = 50,
    entityType,
    action,
    userId,
    entityId,
    projectId,
    assetId,
    search,
    startDate,
    endDate,
    sort = "createdAt",
    order = "desc",
    agentAuthored,
  } = filters;

  const data = useAuthedQuery(
    api.activityLog.list,
    orgId
      ? {
          orgId,
          page,
          pageSize,
          sort,
          order,
          entityType,
          action,
          userId,
          entityId,
          projectId,
          assetId,
          search,
          startDateMs: startMs(startDate),
          endDateMs: endMs(endDate),
          agentAuthored,
        }
      : "skip",
  );
  return { data, isLoading: data === undefined };
}

export function useEntityActivityLog(entityType: string, entityId: string, limit = 5) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const data = useAuthedQuery(
    api.activityLog.listByEntity,
    orgId && entityId ? { orgId, entityType, entityId, limit } : "skip",
  );
  return { data, isLoading: data === undefined };
}
