"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { kitAllocationSchema } from "@/lib/validations/kit-allocation";

/**
 * Browser-direct KIT-REVENUE-ALLOCATION writes (Phase 3 — replaces the saveKitAllocation/
 * clearKitAllocation server actions). Runs kitAllocationSchema before the guarded
 * `api.kitAllocationsWrites.*` mutation (the mutation independently re-enforces the money
 * invariants). The panel keeps its `useServerMutation` UX wrappers; only the mutationFn
 * changes. Returns the mutation result ({ ok, count }) so the panel's onSaved refetch runs.
 */
export function useKitAllocationWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const replaceM = useMutation(api.kitAllocationsWrites.replaceNative);
  const clearM = useMutation(api.kitAllocationsWrites.clearNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    save: async (
      kitId: string,
      rows: { modelId: string; allocationPercent: number }[],
    ): Promise<{ ok: boolean; count: number }> => {
      const org = requireOrg();
      const parsed = kitAllocationSchema.parse({ kitId, rows });
      return await replaceM({
        kitId: parsed.kitId,
        orgId: org,
        rows: parsed.rows.map((r) => ({
          id: createId(),
          modelId: r.modelId,
          allocationPercent: r.allocationPercent,
        })),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    clear: async (kitId: string): Promise<{ ok: boolean; count: number }> => {
      const org = requireOrg();
      return await clearM({
        kitId,
        orgId: org,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
