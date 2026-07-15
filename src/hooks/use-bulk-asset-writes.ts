"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";

/**
 * Browser-direct BULK-ASSET writes (Phase 3 — replaces createBulkAsset/
 * updateBulkAsset/deleteBulkAsset/archiveBulkAsset). Each calls the guarded
 * `api.bulkAssetsWrites.*` mutation with the caller-minted id/auditId/now + the
 * verified actor. Create/update run bulkAssetSchema.parse (the form's zodResolver
 * validates the main flow; this guards other callers + strips unknown keys). The
 * bulk-asset list/detail read reactively/one-shot, so writes refresh via their
 * own paths.
 */
export function useBulkAssetWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.bulkAssetsWrites.createNative);
  const updateM = useMutation(api.bulkAssetsWrites.updateNative);
  const deleteM = useMutation(api.bulkAssetsWrites.deleteNative);
  const archiveM = useMutation(api.bulkAssetsWrites.archiveNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: BulkAssetFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = bulkAssetSchema.parse(data);
      const id = createId();
      const now = Date.now();
      await createM({
        id, orgId: org, modelId: p.modelId, assetTag: p.assetTag, totalQuantity: p.totalQuantity,
        purchasePricePerUnit: p.purchasePricePerUnit, locationId: p.locationId || undefined,
        status: p.status, notes: p.notes || undefined, isActive: p.isActive, tags: p.tags,
        now, actor: actor(), auditId: createId(),
      });
      return { id };
    },
    update: async (id: string, data: BulkAssetFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = bulkAssetSchema.parse(data);
      await updateM({
        id, orgId: org, modelId: p.modelId, assetTag: p.assetTag, totalQuantity: p.totalQuantity,
        purchasePricePerUnit: p.purchasePricePerUnit, locationId: p.locationId || undefined,
        status: p.status, notes: p.notes || undefined, isActive: p.isActive, tags: p.tags,
        now: Date.now(), actor: actor(), auditId: createId(),
      });
      return { id };
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org, now: Date.now(), actor: actor(), auditId: createId() });
    },
    archive: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await archiveM({ id, orgId: org, now: Date.now() });
    },
  };
}
