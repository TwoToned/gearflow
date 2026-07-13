"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

interface ActivityLogFilters {
  page?: number;
  pageSize?: number;
  entityType?: string;
  action?: string;
  userId?: string;
  entityId?: string;
  projectId?: string;
  assetId?: string;
  search?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  sort?: string;
  order?: "asc" | "desc";
}

/** Convert a filter date to epoch ms; endDate is pushed to end-of-day (Prisma parity). */
function startMs(d?: string | Date): number | undefined {
  return d != null ? new Date(d).getTime() : undefined;
}
function endMs(d?: string | Date): number | undefined {
  if (d == null) return undefined;
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

export async function getActivityLogs(filters: ActivityLogFilters = {}) {
  const { organizationId } = await getOrgContext();
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
  } = filters;

  // Convex-only (complete cross-domain history; the Postgres activity_log is frozen).
  const convex = await getConvexClient();
  const result = await convex.query(api.activityLog.list, {
    orgId: organizationId,
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
  });
  return serialize(result);
}

export async function getEntityActivityLog(
  entityType: string,
  entityId: string,
  limit = 5,
) {
  const { organizationId } = await getOrgContext();

  const convex = await getConvexClient();
  const result = await convex.query(api.activityLog.listByEntity, {
    orgId: organizationId,
    entityType,
    entityId,
    limit,
  });
  return serialize(result);
}

export async function exportActivityLogCSV(filters: ActivityLogFilters = {}) {
  const { organizationId } = await getOrgContext();
  const {
    entityType,
    entityId,
    action,
    userId,
    search,
    startDate,
    endDate,
  } = filters;

  let items: Array<{
    createdAt: string | Date;
    userName: string;
    action: string;
    entityType: string;
    entityName: string;
    summary: string;
    details?: unknown;
  }>;

  const convex = await getConvexClient();
  items = await convex.query(api.activityLog.exportRows, {
    orgId: organizationId,
    entityType,
    entityId,
    action,
    userId,
    search,
    startDateMs: startMs(startDate),
    endDateMs: endMs(endDate),
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
