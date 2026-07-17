"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Native OPTIMISTIC client write for kit notes (Phase 3 browser-direct) — the
 * mechanical mirror of use-native-asset-writes.ts (asset notes). Swaps the
 * `updateKitNotes` server-action call for a direct
 * `useMutation(api.kitWrites.updateNotesNative).withOptimisticUpdate(...)`: the edit
 * patches the `kitDetail.bundle` subscription locally (instant), then reconciles to
 * the server result and rolls back on failure.
 *
 * Security at the Convex boundary (the mutation is called with the USER token):
 * `assertWritesEnabled` (kill-switch) + `enforceBrowserWriteLimit` (per-user budget) +
 * `requireOrgPermission(kit, update)` + `resolveActor` (audit identity pinned to the
 * verified token).
 */
export function useOptimisticKitNotes(kitId: string, orgId: string | undefined) {
  const { data: session } = useSession();

  const mutate = useMutation(api.kitWrites.updateNotesNative).withOptimisticUpdate(
    (localStore, args) => {
      if (!orgId) return;
      const current = localStore.getQuery(api.kitDetail.bundle, { kitId, orgId });
      // `undefined` = still loading; `null` = not found/permitted — nothing to patch.
      if (!current) return;
      localStore.setQuery(
        api.kitDetail.bundle,
        { kitId, orgId },
        { ...current, kit: { ...current.kit, notes: args.notes ?? undefined } },
      );
    },
  );

  const enabled = !!orgId && !!session?.user;

  /** Optimistic notes save. Resolves once the server confirms; rolls back on failure. */
  const save = async (notes: string): Promise<void> => {
    if (!orgId || !session?.user) return;
    await mutate({
      id: kitId,
      orgId,
      notes: notes || null,
      actor: { userId: session.user.id, userName: session.user.name ?? "" },
      auditId: createId(),
      now: Date.now(),
    });
  };

  return { enabled, save };
}
