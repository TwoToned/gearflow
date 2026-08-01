"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

export interface PromoteRevisionResult {
  conflicts: string[];
  autoSavedRevision?: number;
  liveRevision: number;
}

/**
 * Browser-direct PROJECT VERSION writes (#1080/#1085 `saveVersionNative`,
 * #1080/#1089 `promoteRevisionNative`). A separate hook from
 * `use-quote-writes.ts` because both mutations act on the PROJECT as a whole
 * (not a single quote row) — `saveVersionNative` can fire with no quote row
 * existing yet, and `promoteRevisionNative` rewrites project-wide state.
 */
export function useProjectVersionWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const saveVersionM = useMutation(api.projectVersionsWrites.saveVersionNative);
  const promoteRevisionM = useMutation(api.projectVersionsWrites.promoteRevisionNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /** Freeze a copy of the current live revision and carry on editing at a
     *  fresh number — the live tables are never touched. */
    saveVersion: async (
      projectId: string,
      label?: string,
    ): Promise<{ id: string; version: number; savedRevision: number }> => {
      const org = requireOrg();
      return await saveVersionM({
        id: createId(),
        organizationId: org,
        projectId,
        label: label || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },

    /** Make `targetRevision` live (#1089/#1097). The outgoing live state is
     *  auto-captured server-side before it's overwritten — never lost. */
    promoteRevision: async (projectId: string, targetRevision: number): Promise<PromoteRevisionResult> => {
      const org = requireOrg();
      return await promoteRevisionM({
        organizationId: org,
        projectId,
        targetRevision,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
  };
}
