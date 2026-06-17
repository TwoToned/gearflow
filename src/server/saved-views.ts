"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import type { Prisma } from "@/generated/prisma/client";
import type { SavedViewConfig } from "@/lib/saved-views";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorSavedViewUpsert,
  removeSavedViewFromConvex,
  syncUserTableViewsToConvex,
} from "@/lib/saved-views-mirror";
import { getSavedViewsForUser } from "@/lib/saved-views-read";

/**
 * Saved table views are personal: each is owned by the user who created it and
 * scoped to their org. There's no cross-user sharing and no resource-level
 * permission — any authenticated org member manages their own views — so these
 * use `getOrgContext()` (auth + org scope) rather than `requirePermission()`.
 * Every query is scoped to BOTH `organizationId` and `userId`.
 */

export async function getSavedViews(tableId: string) {
  const { organizationId, userId } = await getOrgContext();

  // Convex-only read (Phase A): savedTableView is dual-written + backfilled, so we
  // read the Convex copy and apply the user + table scope and ordering in JS.
  const views = await getSavedViewsForUser(organizationId, userId, tableId);

  return serialize(views);
}

export async function createSavedView(data: {
  tableId: string;
  name: string;
  config: SavedViewConfig;
  isDefault?: boolean;
}) {
  const { organizationId, userId, userName } = await getOrgContext();

  const name = data.name.trim();
  if (!name) throw new Error("View name is required");
  if (name.length > 60) throw new Error("View name must be 60 characters or fewer");

  const view = await prisma.$transaction(async (tx) => {
    // A new default unsets any existing default for this user+table.
    if (data.isDefault) {
      await tx.savedTableView.updateMany({
        where: { organizationId, userId, tableId: data.tableId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.savedTableView.create({
      data: {
        organizationId,
        userId,
        tableId: data.tableId,
        name,
        config: data.config as unknown as Prisma.InputJsonValue,
        isDefault: data.isDefault ?? false,
      },
    });
  });

  // Re-sync all of the user's views for this table (the txn may have unset a
  // previous default) so Convex keeps the single-default invariant.
  await syncUserTableViewsToConvex(organizationId, userId, data.tableId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "savedView",
    entityId: view.id,
    entityName: view.name,
    summary: `Created saved view "${view.name}"`,
    details: { tableId: data.tableId },
  });

  return serialize(view);
}

export async function updateSavedView(
  id: string,
  data: { name?: string; config?: SavedViewConfig },
) {
  const { organizationId, userId, userName } = await getOrgContext();

  // Scope the existence check to org + user so one user can't edit another's view.
  const existing = await prisma.savedTableView.findFirst({
    where: { id, organizationId, userId },
  });
  if (!existing) throw new Error("View not found");

  const name = data.name?.trim();
  if (data.name !== undefined && !name) throw new Error("View name is required");
  if (name && name.length > 60) throw new Error("View name must be 60 characters or fewer");

  const view = await prisma.savedTableView.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(data.config !== undefined
        ? { config: data.config as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });

  await mirrorSavedViewUpsert(view as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "savedView",
    entityId: id,
    entityName: view.name,
    summary: `Updated saved view "${view.name}"`,
    details: data,
  });

  return serialize(view);
}

export async function deleteSavedView(id: string) {
  const { organizationId, userId, userName } = await getOrgContext();

  const existing = await prisma.savedTableView.findFirst({
    where: { id, organizationId, userId },
  });
  if (!existing) throw new Error("View not found");

  await prisma.savedTableView.delete({ where: { id } });

  await removeSavedViewFromConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "savedView",
    entityId: id,
    entityName: existing.name,
    summary: `Deleted saved view "${existing.name}"`,
  });
}

/**
 * Set (or clear) the default view for a table. Passing `id` makes that view the
 * sole default; passing `null` clears the default for the table entirely.
 */
export async function setDefaultSavedView(tableId: string, id: string | null) {
  const { organizationId, userId, userName } = await getOrgContext();

  await prisma.$transaction(async (tx) => {
    await tx.savedTableView.updateMany({
      where: { organizationId, userId, tableId, isDefault: true },
      data: { isDefault: false },
    });
    if (id) {
      // Scope to org+user+table so a foreign id can't flip another tenant's row.
      const updated = await tx.savedTableView.updateMany({
        where: { id, organizationId, userId, tableId },
        data: { isDefault: true },
      });
      if (updated.count === 0) throw new Error("View not found");
    }
  });

  // The txn flipped default flags across the user's views — re-sync them all.
  await syncUserTableViewsToConvex(organizationId, userId, tableId);

  const viewName = id
    ? (await prisma.savedTableView.findUnique({ where: { id }, select: { name: true } }))?.name
    : null;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "savedView",
    entityId: id || tableId,
    entityName: viewName || tableId,
    summary: id
      ? `Set "${viewName}" as default view for table ${tableId}`
      : `Cleared default view for table ${tableId}`,
    details: { tableId, viewId: id },
  });
}
