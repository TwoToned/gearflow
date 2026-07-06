"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { nativeActivityReads } from "@/lib/native-writes";
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

  // Phase 5c: native Convex read (complete cross-domain history via the logActivity
  // mirror). Same shape as the Prisma path so the screen is agnostic.
  if (nativeActivityReads()) {
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

  const where: Record<string, unknown> = { organizationId };

  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (entityId) where.entityId = entityId;
  if (projectId) where.projectId = projectId;
  if (assetId) where.assetId = assetId;
  if (search) where.summary = { contains: search, mode: "insensitive" };

  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    where.createdAt = dateFilter;
  }

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sort]: order },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return serialize({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getEntityActivityLog(
  entityType: string,
  entityId: string,
  limit = 5,
) {
  const { organizationId } = await getOrgContext();

  if (nativeActivityReads()) {
    const convex = await getConvexClient();
    const result = await convex.query(api.activityLog.listByEntity, {
      orgId: organizationId,
      entityType,
      entityId,
      limit,
    });
    return serialize(result);
  }

  const where = { organizationId, entityType, entityId };

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return serialize({ items, total });
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

  if (nativeActivityReads()) {
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
  } else {
    const where: Record<string, unknown> = { organizationId };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (search) where.summary = { contains: search, mode: "insensitive" };
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    items = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
  }

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
