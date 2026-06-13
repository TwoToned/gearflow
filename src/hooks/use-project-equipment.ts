"use client";

import { useEffect, useRef } from "react";
import { createSharedResource } from "./use-shared-resource";
import {
  useProjectLineItems,
  useProjectGroups,
  useProjectCategories as useConvexProjectCategories,
} from "./use-projects";
import {
  getProjectCategories,
  getUncategorizedLineItems,
  getProjectOverbookedStatus,
} from "@/server/project-categories";
import {
  getUncategorizedSubHireGroups,
  getUncategorizedProjectGroups,
} from "@/server/category-slots";
import { getSubHires, getSubHire } from "@/server/sub-hires";

/**
 * Shared stores for the project equipment-tab composition (Phase 6 — React Query
 * removal). The equipment editor reads these as one interlocked composition and
 * refreshes them together through a single `invalidate()` chokepoint (passed to
 * child dialogs via `onInvalidate`). Several are ALSO read by the equipment add
 * form / sub-hire order dialog (category dropdowns), so a shared store keyed by
 * **projectId** keeps every reader in sync when any writer mutates — reproducing
 * React Query's shared `["project-categories", projectId]` (etc.) cache refresh
 * without prop-drilling. All are dual-written infra; the reads stay server actions
 * (cross-domain composition). SSE is dead so no cross-user liveness is lost.
 */

const categories = createSharedResource((projectId: string) => getProjectCategories(projectId));
/** Subscribe to the project's category/group composition. Key = projectId. */
export const useProjectCategories = categories.use;
export const refreshProjectCategories = categories.refresh;

const uncatItems = createSharedResource((projectId: string) => getUncategorizedLineItems(projectId));
export const useUncategorizedItems = uncatItems.use;
export const refreshUncategorizedItems = uncatItems.refresh;

const uncatSubHireGroups = createSharedResource((projectId: string) => getUncategorizedSubHireGroups(projectId));
export const useUncategorizedSubHireGroups = uncatSubHireGroups.use;
export const refreshUncategorizedSubHireGroups = uncatSubHireGroups.refresh;

const uncatProjectGroups = createSharedResource((projectId: string) => getUncategorizedProjectGroups(projectId));
export const useUncategorizedProjectGroups = uncatProjectGroups.use;
export const refreshUncategorizedProjectGroups = uncatProjectGroups.refresh;

const overbooked = createSharedResource((projectId: string) => getProjectOverbookedStatus(projectId));
export const useProjectOverbooked = overbooked.use;
export const refreshProjectOverbooked = overbooked.refresh;

const subHires = createSharedResource((projectId: string) => getSubHires({ projectId }));
/** Subscribe to the project's sub-hires. Key = projectId. */
export const useProjectSubHires = subHires.use;
export const refreshProjectSubHires = subHires.refresh;

const subHire = createSharedResource((subHireId: string) => getSubHire(subHireId));
/** Subscribe to a single sub-hire's detail. Key = subHireId. */
export const useSubHire = subHire.use;
export const refreshSubHire = subHire.refresh;

/**
 * Cross-tab live sync for the equipment-tab composition.
 *
 * The equipment composites (categories, uncategorized items, overbooked status)
 * are deep cross-domain server-action reads — they stay server actions because
 * Prisma still owns the asset/unit/kit physical joins. But line items, groups,
 * and categories are all dual-written to Convex, so we subscribe to those tables
 * directly. When ANOTHER tab (or collaborator) edits a price, moves an item, adds
 * a group, etc., the Convex mirror pushes the change over the websocket; the
 * fingerprint below changes and we re-fetch the composites so this tab updates
 * live — no manual refresh.
 *
 * Mount once in the equipment tab. The local writer still calls invalidate()
 * synchronously; this only fires the redundant-but-harmless refresh once the
 * Convex push lands (and is the ONLY refresh other tabs get).
 */
function fingerprintLineItems(
  items: { id: string; updatedAt?: number; unitPrice?: number; lineTotal?: number; quantity?: number; discount?: number; categoryId?: string; groupId?: string; status?: string; sortOrder?: number }[] | undefined,
): string | undefined {
  if (!items) return undefined;
  return items
    .map((i) => `${i.id}:${i.updatedAt ?? 0}:${i.unitPrice ?? ""}:${i.lineTotal ?? ""}:${i.quantity ?? ""}:${i.discount ?? ""}:${i.categoryId ?? ""}:${i.groupId ?? ""}:${i.status ?? ""}:${i.sortOrder ?? ""}`)
    .sort()
    .join("|");
}

function fingerprintGrouping(
  rows: { id: string; updatedAt?: number; sortOrder?: number }[] | undefined,
  extra?: (r: { id: string }) => string,
): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((r) => `${r.id}:${r.updatedAt ?? 0}:${r.sortOrder ?? ""}:${extra?.(r) ?? ""}`)
    .sort()
    .join("|");
}

/** Subscribe to Convex line-item/group/category tables and refresh the equipment composites on any cross-tab change. */
export function useProjectEquipmentLiveSync(
  projectId: string | undefined,
  orgId: string | undefined,
) {
  const lineItems = useProjectLineItems(projectId, orgId);
  const groups = useProjectGroups(projectId, orgId);
  const cats = useConvexProjectCategories(projectId, orgId);

  const liFp = fingerprintLineItems(lineItems);
  const grpFp = fingerprintGrouping(
    groups,
    (r) => `${(r as { title?: string; price?: number; quantity?: number; categoryId?: string }).title ?? ""}:${(r as { price?: number }).price ?? ""}:${(r as { quantity?: number }).quantity ?? ""}:${(r as { categoryId?: string }).categoryId ?? ""}`,
  );
  const catFp = fingerprintGrouping(cats, (r) => (r as { name?: string }).name ?? "");

  const prev = useRef<{ li?: string; grp?: string; cat?: string }>({});

  useEffect(() => {
    if (!projectId) return;
    const p = prev.current;
    const changed =
      (liFp !== undefined && p.li !== undefined && liFp !== p.li) ||
      (grpFp !== undefined && p.grp !== undefined && grpFp !== p.grp) ||
      (catFp !== undefined && p.cat !== undefined && catFp !== p.cat);
    if (changed) {
      refreshProjectCategories(projectId);
      refreshUncategorizedItems(projectId);
      refreshUncategorizedProjectGroups(projectId);
      refreshProjectOverbooked(projectId);
    }
    if (liFp !== undefined) p.li = liFp;
    if (grpFp !== undefined) p.grp = grpFp;
    if (catFp !== undefined) p.cat = catFp;
  }, [projectId, liFp, grpFp, catFp]);
}
