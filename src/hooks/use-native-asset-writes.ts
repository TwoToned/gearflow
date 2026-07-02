"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Phase 5d — native OPTIMISTIC client write (representative: asset notes).
 *
 * Swaps the `updateAssetNotes` server-action call for a direct
 * `useMutation(api.assetWrites.updateNotesNative).withOptimisticUpdate(...)`: the edit
 * lands in the UI instantly (the assetDetail.bundle subscription is patched locally),
 * then reconciles to the server result and rolls back automatically on failure. The
 * mutation is called with the USER token, so `requireOrgPermission` enforces RBAC at
 * the Convex boundary (5a) — this is exactly what 5a–5c made safe to call directly.
 *
 * Flag-gated + default OFF (NEXT_PUBLIC, build-inlined). When off, the page keeps the
 * server-action path. `actor` is the current session user; `auditId`/`now` are
 * client-generated (throwaway — the mutation records them, the server is authoritative).
 *
 * Rolling this pattern to the other writes is mechanical (same three ingredients).
 */
export const NATIVE_ASSET_NOTES_OPTIMISTIC =
  process.env.NEXT_PUBLIC_NATIVE_ASSET_NOTES_OPTIMISTIC === "true";

export function useOptimisticAssetNotes(assetId: string, orgId: string | undefined) {
  const { data: session } = useSession();

  const mutate = useMutation(api.assetWrites.updateNotesNative).withOptimisticUpdate(
    (localStore, args) => {
      if (!orgId) return;
      const current = localStore.getQuery(api.assetDetail.bundle, { assetId, orgId });
      // `undefined` = still loading; `null` = not found/permitted — nothing to patch.
      if (!current) return;
      localStore.setQuery(
        api.assetDetail.bundle,
        { assetId, orgId },
        { ...current, asset: { ...current.asset, notes: args.notes ?? undefined } },
      );
    },
  );

  const enabled = NATIVE_ASSET_NOTES_OPTIMISTIC && !!orgId && !!session?.user;

  /** Optimistic notes save. Returns a promise that resolves once the server confirms. */
  const save = async (notes: string): Promise<void> => {
    if (!orgId || !session?.user) return;
    await mutate({
      id: assetId,
      orgId,
      notes: notes || null,
      actor: { userId: session.user.id, userName: session.user.name ?? "" },
      auditId: createId(),
      now: Date.now(),
    });
  };

  return { enabled, save };
}
