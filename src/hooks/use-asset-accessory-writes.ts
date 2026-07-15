"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  assetSerializedChildSchema,
  assetBulkChildSchema,
  type AssetSerializedChildFormValues,
  type AssetBulkChildFormValues,
} from "@/lib/validations/asset";

/**
 * Browser-direct ASSET-ACCESSORY writes (Phase 3 — replaces the add/remove serialized/
 * bulk child server actions). Each op is ONE atomic guarded mutation (the pre-checks +
 * pool adjustment + write share a transaction — closes the old non-atomic TOCTOU). Runs
 * the zod schema before the guarded `api.assetAccessoriesWrites.*` call.
 */
export function useAssetAccessoryWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addSerialM = useMutation(api.assetAccessoriesWrites.addSerializedNative);
  const addBulkM = useMutation(api.assetAccessoriesWrites.addBulkNative);
  const removeSerialM = useMutation(api.assetAccessoriesWrites.removeSerializedNative);
  const removeBulkM = useMutation(api.assetAccessoriesWrites.removeBulkNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    addSerialized: async (parentAssetId: string, data: AssetSerializedChildFormValues): Promise<void> => {
      const p = assetSerializedChildSchema.parse(data);
      await addSerialM({ parentAssetId, orgId: requireOrg(), childAssetId: p.childAssetId, notes: p.notes || undefined, now: Date.now(), actor: actor(), auditId: createId() });
    },
    addBulk: async (parentAssetId: string, data: AssetBulkChildFormValues): Promise<void> => {
      const p = assetBulkChildSchema.parse(data);
      await addBulkM({ id: createId(), parentAssetId, orgId: requireOrg(), bulkAssetId: p.bulkAssetId, quantity: p.quantity, allocationMode: p.allocationMode, notes: p.notes || undefined, now: Date.now(), actor: actor(), auditId: createId() });
    },
    removeSerialized: async (parentAssetId: string, childAssetId: string): Promise<void> => {
      await removeSerialM({ parentAssetId, orgId: requireOrg(), childAssetId, now: Date.now(), actor: actor(), auditId: createId() });
    },
    removeBulk: async (parentAssetId: string, bulkChildId: string): Promise<void> => {
      await removeBulkM({ parentAssetId, orgId: requireOrg(), bulkChildId, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
