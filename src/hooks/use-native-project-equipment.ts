"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import {
  reconstructProjectEquipmentTree,
  type ProjectEquipmentTree,
} from "@/lib/project-equipment-reconstruct";
import {
  reconstructProjectDetail,
  enrichProjectDetailOverbooked,
  type NativeProjectDetail,
} from "@/lib/project-detail-reconstruct";
import { relevantOverbookModelIds } from "@/lib/overbooking-core";

/**
 * Feature flag (default OFF) for the native read-layer project-detail cutover
 * (Phase 1d). Until this is "true" in the environment, every consumer keeps the
 * existing server-action path — so merging the cutover changes nothing for users.
 * Flip it (after `pnpm convex:backfill:members`) to verify the native path live.
 */
export const NATIVE_PROJECT_DETAIL_ENABLED =
  process.env.NEXT_PUBLIC_NATIVE_PROJECT_DETAIL === "true";

/**
 * Native equipment tree for the project detail page: subscribes to
 * `projectEquipment.browserBundle` (RBAC-gated `requireOrgPermission(project,
 * read)`) over the Convex WebSocket and reconstructs the
 * `categories → groups → lineItems` tree client-side via the PURE
 * `reconstructProjectEquipmentTree` — the same reconstruction the server
 * `buildProjectEquipmentTree` runs (parity-by-construction). Returns `undefined`
 * while the subscription loads.
 *
 * Stage B building block: the full native `useProjectDetail` will combine this
 * with `projectDetail.bundle` + `overbooking.bundle` (managers/media/location/
 * client/overbooking) behind {@link NATIVE_PROJECT_DETAIL_ENABLED}. Importing the
 * pure reconstruction into this CLIENT module is also what makes CI's `next build`
 * verify the reconstruction is genuinely client-safe (no server import leaks).
 */
export function useNativeProjectEquipmentTree(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectEquipmentTree | undefined {
  const data = useAuthedQuery(
    api.projectEquipment.browserBundle,
    NATIVE_PROJECT_DETAIL_ENABLED && projectId && orgId
      ? { projectId, orgId }
      : "skip",
  );
  return useMemo(
    () => (data ? reconstructProjectEquipmentTree(data) : undefined),
    [data],
  );
}

/**
 * The FULL native project-detail composite — the getProject-shaped object built
 * from `projectDetail.bundle` + `projectEquipment.browserBundle` +
 * `overbooking.bundle`, reconstructed client-side. Returns `{ data, isLoading }`
 * matching the useProjectDetail interface so `use-project-detail.ts` can swap to it
 * behind the flag. All subscriptions skip entirely unless the flag is on and ids
 * are present.
 *
 * `notFound` distinguishes "project doesn't exist / not permitted" (detail === null)
 * from "still loading" so the page shows its not-found state only when definitive —
 * never during auth/orgId resolution.
 *
 * Overbooked enrichment is reactive: the base detail renders as soon as
 * detail+equipment land (line items default to not-overbooked); the
 * `overbooking.bundle` subscription (keyed on the referenced model ids) then fills
 * in `isOverbooked` / `overbookedInfo` when it arrives. Parity with `getProject`.
 */
export function useNativeProjectDetail(
  projectId: string | undefined,
  orgId: string | undefined,
): { data: NativeProjectDetail | undefined; isLoading: boolean; notFound: boolean } {
  const enabled = NATIVE_PROJECT_DETAIL_ENABLED && !!projectId && !!orgId;
  const args = enabled ? { projectId: projectId!, orgId: orgId! } : "skip";
  const detail = useAuthedQuery(api.projectDetail.bundle, args);
  const equipment = useAuthedQuery(api.projectEquipment.browserBundle, args);

  const base = useMemo(() => {
    if (!enabled || detail === undefined || equipment === undefined) return undefined;
    if (detail === null) return null; // project not found / not permitted
    return reconstructProjectDetail(detail, equipment);
  }, [enabled, detail, equipment]);

  // Referenced overbookable models → the overbooking.bundle arg. Skip when there
  // are none (no subscription, no enrichment needed — nothing is overbookable).
  const modelIds = useMemo(
    () => (base ? relevantOverbookModelIds(base.lineItems) : undefined),
    [base],
  );
  const overbooking = useAuthedQuery(
    api.overbooking.bundle,
    enabled && orgId && modelIds && modelIds.length > 0
      ? { orgId: orgId!, modelIds }
      : "skip",
  );

  const data = useMemo(() => {
    if (!base) return undefined; // null (not found) or undefined (loading)
    return enrichProjectDetailOverbooked(base, overbooking ?? undefined);
  }, [base, overbooking]);

  return {
    data,
    // Loading until the base composite resolves to a definitive value.
    isLoading: enabled && base === undefined,
    notFound: base === null,
  };
}
