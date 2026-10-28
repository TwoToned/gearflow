"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { modelCustomAccessorySchema, type ModelCustomAccessoryFormValues } from "@/lib/validations/asset";

/**
 * Browser-direct MODEL-CUSTOM-ACCESSORY writes — the free-text twin of
 * `useModelAccessoryWrites`. Runs `modelCustomAccessorySchema` before the
 * guarded `api.modelCustomAccessoriesWrites.*` mutation (which re-checks
 * org/dup/bounds itself).
 */
export function useModelCustomAccessoryWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addM = useMutation(api.modelCustomAccessoriesWrites.addNative);
  const removeM = useMutation(api.modelCustomAccessoriesWrites.removeNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    add: async (modelId: string, data: ModelCustomAccessoryFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = modelCustomAccessorySchema.parse(data);
      return await addM({
        id: createId(), modelId, orgId: org, name: parsed.name, quantity: parsed.quantity,
        inclusion: parsed.inclusion, notes: parsed.notes, now: Date.now(), actor: actor(), auditId: createId(),
      });
    },
    remove: async (modelId: string, accessoryId: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await removeM({ modelId, orgId: org, accessoryId, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
