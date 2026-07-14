"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { SavedViewConfig } from "@/lib/saved-views";

/**
 * Browser-direct SAVED-TABLE-VIEW writes (Phase 3 — replaces the createSavedView/
 * updateSavedView/deleteSavedView/setDefaultSavedView server actions). Each calls the
 * guarded `api.savedTableViewsWrites.*` mutation directly with the caller-minted
 * id/auditId/now + the verified actor; userId/orgId are derived from the token INSIDE
 * the mutation (personal ownership). The menu keeps its `useServerMutation` UX wrappers;
 * only the `mutationFn` changes. The list (useSavedTableViews) subscribes to Convex, so
 * each write re-derives the menu live.
 */
export function useSavedViewWrites() {
  const { data: session } = useSession();

  const createM = useMutation(api.savedTableViewsWrites.createNative);
  const updateM = useMutation(api.savedTableViewsWrites.updateNative);
  const removeM = useMutation(api.savedTableViewsWrites.removeNative);
  const setDefaultM = useMutation(api.savedTableViewsWrites.setDefaultNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });

  return {
    create: async (vars: {
      tableId: string;
      name: string;
      config: SavedViewConfig;
      isDefault: boolean;
    }): Promise<{ id: string; name: string }> => {
      return await createM({
        id: createId(),
        tableId: vars.tableId,
        name: vars.name,
        config: vars.config,
        isDefault: vars.isDefault,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    update: async (id: string, config: SavedViewConfig): Promise<void> => {
      await updateM({ id, config, now: Date.now(), actor: actor(), auditId: createId() });
    },
    remove: async (id: string): Promise<void> => {
      await removeM({ id, now: Date.now(), actor: actor(), auditId: createId() });
    },
    setDefault: async (tableId: string, targetId: string | null): Promise<void> => {
      await setDefaultM({
        tableId,
        targetId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
