"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { createId } from "@paralleldrive/cuid2";
import type { SavedViewConfig } from "@/lib/saved-views";
import { mapSavedView } from "@/lib/saved-views-read";
import { logActivity } from "@/lib/activity-log";

/**
 * Saved table views are personal: each is owned by the user who created it and
 * scoped to their org. There's no cross-user sharing and no resource-level
 * permission — any authenticated org member manages their own views — so these
 * use `getOrgContext()` (auth + org scope) rather than `requirePermission()`.
 * Every query is scoped to BOTH `organizationId` and `userId`.
 */

// getSavedViews (the read) went browser-direct: src/components/ui/saved-views-menu.tsx
// derives the list from the reactive `useSavedTableViews` subscription via
// src/lib/saved-views-filter.ts. These writes stay here.

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

  const id = createId();
  const now = Date.now();
  const convex = await getConvexClient();

  await convex.mutation(api.savedTableViews.createForUser, {
    id,
    organizationId,
    userId,
    tableId: data.tableId,
    name,
    config: data.config,
    isDefault: data.isDefault ?? false,
    now,
  });

  const raw = await convex.query(api.savedTableViews.getById, { id });
  const view = raw ? mapSavedView(raw) : null;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "savedView",
    entityId: id,
    entityName: name,
    summary: `Created saved view "${name}"`,
    details: { tableId: data.tableId },
  });

  return serialize(view);
}

export async function updateSavedView(
  id: string,
  data: { name?: string; config?: SavedViewConfig },
) {
  const { organizationId, userId, userName } = await getOrgContext();
  const convex = await getConvexClient();

  const existing = await convex.query(api.savedTableViews.getById, { id });
  if (!existing || existing.organizationId !== organizationId || existing.userId !== userId) {
    throw new Error("View not found");
  }

  const name = data.name?.trim();
  if (data.name !== undefined && !name) throw new Error("View name is required");
  if (name && name.length > 60) throw new Error("View name must be 60 characters or fewer");

  const now = Date.now();
  await convex.mutation(api.savedTableViews.update, {
    id,
    patch: {
      ...(name !== undefined ? { name } : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
      updatedAt: now,
    },
  });

  const raw = await convex.query(api.savedTableViews.getById, { id });
  const view = raw ? mapSavedView(raw) : null;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "savedView",
    entityId: id,
    entityName: existing.name,
    summary: `Updated saved view "${existing.name}"`,
    details: data,
  });

  return serialize(view);
}

export async function deleteSavedView(id: string) {
  const { organizationId, userId, userName } = await getOrgContext();
  const convex = await getConvexClient();

  const existing = await convex.query(api.savedTableViews.getById, { id });
  if (!existing || existing.organizationId !== organizationId || existing.userId !== userId) {
    throw new Error("View not found");
  }

  await convex.mutation(api.savedTableViews.remove, { id });

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
  const convex = await getConvexClient();
  const now = Date.now();

  await convex.mutation(api.savedTableViews.setDefault, {
    organizationId,
    userId,
    tableId,
    targetId: id,
    now,
  });

  const viewName = id
    ? (await convex.query(api.savedTableViews.getById, { id }))?.name ?? null
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
