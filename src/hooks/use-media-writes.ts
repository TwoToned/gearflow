"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct MEDIA writes (Phase 3 — replaces the 6 *-media.ts server actions:
 * client/location/project/kit/asset/model). Files live in Convex storage, so the whole
 * add/remove/setPrimary/reorder path is one guarded `api.mediaWrites.*` mutation
 * (dispatched by `kind`). Fire-and-forget — every consumer reads media reactively from
 * its parent detail query. subHire media stays on the server (sub-hires.ts).
 */
export type MediaKind = "client" | "location" | "project" | "kit" | "asset" | "model";

export function useMediaWrites(kind: MediaKind) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addM = useMutation(api.mediaWrites.addNative);
  const removeM = useMutation(api.mediaWrites.removeNative);
  const setPrimaryM = useMutation(api.mediaWrites.setPrimaryNative);
  const reorderM = useMutation(api.mediaWrites.reorderNative);

  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    add: async (input: { parentId: string; fileId: string; type: string; displayName?: string }): Promise<{ id: string }> =>
      addM({ kind, id: createId(), orgId: requireOrg(), parentId: input.parentId, fileId: input.fileId, type: input.type, displayName: input.displayName, now: Date.now() }),
    remove: async (mediaId: string): Promise<{ id: string }> =>
      removeM({ kind, orgId: requireOrg(), mediaId }),
    setPrimary: async (parentId: string, mediaId: string): Promise<{ id: string }> =>
      setPrimaryM({ kind, orgId: requireOrg(), parentId, mediaId }),
    reorder: async (orderedIds: string[]): Promise<{ ok: boolean }> =>
      reorderM({ kind, orgId: requireOrg(), orderedIds }),
  };
}
