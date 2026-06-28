"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import {
  reconstructProjectEquipmentTree,
  type ProjectEquipmentTree,
} from "@/lib/project-equipment-reconstruct";

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
