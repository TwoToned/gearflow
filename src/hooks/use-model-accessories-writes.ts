"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  modelBulkAccessorySchema,
  type ModelBulkAccessoryFormValues,
} from "@/lib/validations/asset";

/**
 * Browser-direct MODEL-BULK-ACCESSORY writes (Phase 3 — replaces the
 * addModelBulkAccessory/removeModelBulkAccessory server actions). Runs
 * modelBulkAccessorySchema before the guarded `api.modelBulkAccessoriesWrites.*`
 * mutation (which independently re-checks org/dup/quantity). The manager keeps its
 * `useServerMutation` UX wrappers and refetches the list via onChanged (the write
 * return values are unused).
 */
export function useModelAccessoryWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addM = useMutation(api.modelBulkAccessoriesWrites.addNative);
  const removeM = useMutation(api.modelBulkAccessoriesWrites.removeNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    add: async (modelId: string, data: ModelBulkAccessoryFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = modelBulkAccessorySchema.parse(data);
      return await addM({
        id: createId(),
        modelId,
        orgId: org,
        bulkAssetId: parsed.bulkAssetId,
        quantity: parsed.quantity,
        notes: parsed.notes,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (modelId: string, accessoryId: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await removeM({
        modelId,
        orgId: org,
        accessoryId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
