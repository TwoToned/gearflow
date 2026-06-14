"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive custom-field-definition hooks (Phase 4 of the Convex migration).
 *
 * Thin wrapper over Convex's useQuery — the browser subscribes directly to the
 * `customFieldDefinitions` table over a WebSocket, so any definition
 * create/update/delete/reorder (via the dual-write server actions) pushes a live
 * update to every subscriber. The Convex `list` returns ALL entity types for the
 * org; filter by `entityType` client-side. Pass `undefined` to skip.
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type CustomFieldDefinitionDoc = Doc<"customFieldDefinitions">;

export function useCustomFieldDefinitions(
  orgId: string | undefined,
): CustomFieldDefinitionDoc[] | undefined {
  return useQuery(api.customFieldDefinitions.list, orgId ? { orgId } : "skip");
}

/**
 * Reactive replacement for `getActiveCustomFields(entityType)` — the active
 * definitions for one entity type, in display order. Filters the reactive list
 * client-side (the Convex `list` returns all entity types + archived rows),
 * matching the server action's `where: { entityType, isActive }` +
 * `orderBy: [{ sortOrder }, { createdAt }]`. Returns `undefined` while loading.
 */
export function useActiveCustomFields(
  orgId: string | undefined,
  entityType: CustomFieldDefinitionDoc["entityType"] = "ASSET",
): CustomFieldDefinitionDoc[] | undefined {
  const all = useCustomFieldDefinitions(orgId);
  if (all === undefined) return undefined;
  return all
    .filter((d) => d.entityType === entityType && d.isActive)
    .sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );
}
