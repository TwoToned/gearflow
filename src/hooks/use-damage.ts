"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive damage hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes to the
 * dual-written `damageEvents` table over a websocket, so any damage report,
 * status change, or charge-back (via the damage server actions) pushes a live
 * update to every subscriber. Pass `undefined` to skip (before org loads).
 *
 * The list/detail pages keep their server-action composite reads (Prisma owns
 * the asset/project/createdBy joins); these subscriptions are used only as the
 * cross-tab change signal that triggers a re-fetch. See FEATUREDOCS/54.
 */
export type DamageEventDoc = Doc<"damageEvents">;

export function useDamageEvents(orgId: string | undefined): DamageEventDoc[] | undefined {
  return useQuery(api.damageEvents.list, orgId ? { orgId } : "skip");
}

export function useDamageEvent(id: string | undefined): DamageEventDoc | null | undefined {
  return useQuery(api.damageEvents.getById, id ? { id } : "skip");
}

/**
 * Stable fingerprint of the org's damage events — changes whenever any row is
 * created, deleted, or has a list/detail-relevant scalar field mutated. Feed the
 * result into a useEffect that calls the page's server-action refetch on change.
 */
export function fingerprintDamageEvents(
  events: DamageEventDoc[] | undefined,
): string | undefined {
  if (!events) return undefined;
  return events
    .map((e) =>
      `${e.id}:${e.updatedAt ?? 0}:${e.status ?? ""}:${e.severity ?? ""}:${e.chargedBack ?? ""}:${e.actualCost ?? ""}:${e.estimatedCost ?? ""}:${(e.notes ?? "").length}:${(e.photos ?? []).length}`,
    )
    .sort()
    .join("|");
}
