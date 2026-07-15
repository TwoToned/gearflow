"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct TEST-TAG-ASSET writes (Phase 3 — replaces createTestTagAsset/
 * createTestTagAssetsFromBulk/updateTestTagAsset/retireTestTagAsset/deleteTestTagAsset/
 * reactivateTestTagAsset/backfillTestTagAssets). Each calls the guarded
 * `api.testTagAssetsWrites.*` mutation with the caller-minted id/auditId/now + the
 * verified actor. The test-tag list/detail read one-shot; writes refetch on success.
 */
type CreateInput = {
  testTagId?: string; description: string; equipmentClass?: string; applianceType?: string;
  make?: string; modelName?: string; serialNumber?: string; location?: string;
  testIntervalMonths?: number; testProfileId?: string; outletCount?: number; notes?: string;
  assetId?: string; bulkAssetId?: string;
};
type BulkInput = {
  bulkAssetId: string; count: number; equipmentClass?: string; applianceType?: string;
  testIntervalMonths?: number; description: string; make?: string; modelName?: string; location?: string;
};
type UpdateInput = {
  description?: string; equipmentClass?: string; applianceType?: string; make?: string;
  modelName?: string; serialNumber?: string; location?: string; testIntervalMonths?: number;
  testProfileId?: string | null; outletCount?: number | null; notes?: string;
  assetId?: string | null; bulkAssetId?: string | null;
};

export function useTestTagWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.testTagAssetsWrites.createNative);
  const createBulkM = useMutation(api.testTagAssetsWrites.createFromBulkNative);
  const updateM = useMutation(api.testTagAssetsWrites.updateNative);
  const retireM = useMutation(api.testTagAssetsWrites.retireNative);
  const deleteM = useMutation(api.testTagAssetsWrites.deleteNative);
  const reactivateM = useMutation(api.testTagAssetsWrites.reactivateNative);
  const backfillM = useMutation(api.testTagAssetsWrites.backfillNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };

  return {
    create: async (data: CreateInput): Promise<{ id: string; testTagId: string }> => {
      const org = requireOrg();
      // enum fields (equipmentClass/applianceType) are validated at the Convex boundary.
      return await createM({ id: createId(), orgId: org, ...data, now: Date.now(), actor: actor(), auditId: createId() } as Parameters<typeof createM>[0]);
    },
    createFromBulk: async (data: BulkInput): Promise<{ count: number; items: { id: string; testTagId: string }[] }> => {
      const org = requireOrg();
      const { count, ...rest } = data;
      const ids = Array.from({ length: count }, () => createId());
      return await createBulkM({ orgId: org, ids, ...rest, now: Date.now(), actor: actor(), auditId: createId() } as Parameters<typeof createBulkM>[0]);
    },
    update: async (id: string, patch: UpdateInput): Promise<{ id: string }> => {
      const org = requireOrg();
      return await updateM({ id, orgId: org, patch: patch as Parameters<typeof updateM>[0]["patch"], now: Date.now() });
    },
    retire: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await retireM({ id, orgId: org, now: Date.now() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org });
    },
    reactivate: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await reactivateM({ id, orgId: org, now: Date.now(), actor: actor(), auditId: createId() });
    },
    backfill: async (): Promise<{ created: number; retired: number }> => {
      const org = requireOrg();
      return await backfillM({ orgId: org, now: Date.now() });
    },
  };
}
