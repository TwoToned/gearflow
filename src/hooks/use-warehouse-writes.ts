"use client";

import { useMutation, useConvex } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

/**
 * Browser-direct WAREHOUSE writes (Phase 3 PR-A — the return/undeploy/container write
 * family). Each guarded `api.warehouseWrites.*` mutation folds kill-switch + rate limit
 * + RBAC (warehouse:check_in|check_out) + FK/org validation + the SAME warehouseOps
 * core + in-mutation audit into ONE transaction. The state machine already lives in
 * Convex, so these are drop-in replacements for the thin `src/server/warehouse.ts`
 * wrappers — the client just mints the audit cuids and supplies actor/orgId/now.
 *
 * The signatures mirror the old server actions so the warehouse page rewire is minimal.
 * Return shape is ids only — the page reads a live warehouseDetail subscription, so the
 * server's model-attach re-read is dropped.
 */
export function useWarehouseWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();

  const checkOutItemsM = useMutation(api.warehouseWrites.checkOutItems);
  const checkOutKitM = useMutation(api.warehouseWrites.checkOutKit);
  const checkOutKitsBatchM = useMutation(api.warehouseWrites.checkOutKitsBatch);
  const quickAddAndCheckOutM = useMutation(api.warehouseWrites.quickAddAndCheckOut);
  const checkInItemsM = useMutation(api.warehouseWrites.checkInItems);
  const undeployItemsM = useMutation(api.warehouseWrites.undeployItems);
  const unreturnItemsM = useMutation(api.warehouseWrites.unreturnItems);
  const undeprepLineM = useMutation(api.warehouseWrites.undeprepLine);
  const undeployKitsBatchM = useMutation(api.warehouseWrites.undeployKitsBatch);
  const unreturnKitsBatchM = useMutation(api.warehouseWrites.unreturnKitsBatch);
  const checkInKitM = useMutation(api.warehouseWrites.checkInKit);
  const checkInKitsBatchM = useMutation(api.warehouseWrites.checkInKitsBatch);
  const clearPrepContainerM = useMutation(api.warehouseWrites.clearPrepContainer);
  const ensureContainerOnProjectM = useMutation(api.warehouseWrites.ensureContainerOnProject);
  const syncContainersBatchM = useMutation(api.warehouseWrites.syncContainersBatch);
  const reassignLineItemUnitM = useMutation(api.warehouseWrites.reassignLineItemUnit);
  const reassignKitMemberSerialM = useMutation(api.warehouseWrites.reassignKitMemberSerial);
  const forceReturnAssetM = useMutation(api.warehouseWrites.forceReturnAsset);
  const forceReturnKitM = useMutation(api.warehouseWrites.forceReturnKit);
  const forceReturnKitsM = useMutation(api.warehouseWrites.forceReturnKits);
  const bulkForceReturnAssetsM = useMutation(api.warehouseWrites.bulkForceReturnAssets);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    // ── PR-C: checkout keystone ──────────────────────────────────────────────────
    checkOutItems: async (
      projectId: string,
      items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }>,
      includeAccessories = true,
    ): Promise<{ updatedLineIds: string[] }> => {
      return checkOutItemsM({
        orgId: requireOrg(),
        projectId,
        items,
        includeAccessories,
        auditIds: items.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
    },

    checkOutKit: async (
      projectId: string,
      kitId: string,
    ): Promise<{ kitId: string; affectedKitIds: string[] }> => {
      return checkOutKitM({ orgId: requireOrg(), projectId, kitId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    checkOutKitsBatch: async (
      projectId: string,
      kitIds: string[],
    ): Promise<{ succeeded: string[]; errors: { kitId: string; message: string }[] }> => {
      return checkOutKitsBatchM({
        orgId: requireOrg(),
        projectId,
        kitIds,
        // One audit id per input kit — the mutation dedupes and only consumes as many
        // as succeed (succeeded ⊆ deduped ⊆ input), so this always covers them.
        auditIds: kitIds.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
    },

    quickAddAndCheckOut: async (
      projectId: string,
      data: { modelId: string; assetId?: string; bulkAssetId?: string; quantity?: number; prepContainer?: string | null },
    ): Promise<{
      id: string;
      modelId: string;
      assetId?: string;
      bulkAssetId?: string;
      model: { _count: { modelCheckItems: number } };
    }> => {
      const org = requireOrg();
      const { id } = await quickAddAndCheckOutM({
        orgId: org,
        projectId,
        modelId: data.modelId,
        assetId: data.assetId ?? undefined,
        bulkAssetId: data.bulkAssetId ?? undefined,
        quantity: data.quantity ?? undefined,
        prepContainer: data.prepContainer ?? undefined,
        now: Date.now(),
        actor: actor(),
      });
      // The mutation returns { id } only (the page reads a live subscription). The
      // page's onSuccess still needs the model's check-item count to decide check-queue
      // routing (the server action grafted `model._count.modelCheckItems`) — re-derive
      // it here with one org-scoped query. Everything else the caller already knows.
      const checkItems = await convex.query(api.modelCheckItems.listByModel, { orgId: org, modelId: data.modelId });
      return {
        id,
        modelId: data.modelId,
        assetId: data.assetId,
        bulkAssetId: data.bulkAssetId,
        model: { _count: { modelCheckItems: checkItems.length } },
      };
    },

    checkInItems: async (
      projectId: string,
      items: Array<{ lineItemId: string; assetId?: string; returnCondition: ReturnCondition; quantity?: number; notes?: string }>,
    ): Promise<{ updatedLineIds: string[] }> => {
      return checkInItemsM({
        orgId: requireOrg(),
        projectId,
        items,
        auditIds: items.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
    },

    undeployItems: async (
      projectId: string,
      items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>,
    ): Promise<{ updatedLineIds: string[] }> => {
      return undeployItemsM({
        orgId: requireOrg(),
        projectId,
        items,
        auditIds: items.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
    },

    unreturnItems: async (
      projectId: string,
      items: Array<{ lineItemId: string; assetId?: string; quantity?: number }>,
    ): Promise<{ updatedLineIds: string[] }> => {
      return unreturnItemsM({
        orgId: requireOrg(),
        projectId,
        items,
        auditIds: items.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
    },

    undeprepLine: async (projectId: string, lineItemId: string): Promise<{ id: string }> => {
      return undeprepLineM({ orgId: requireOrg(), projectId, lineItemId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    undeployKitsBatch: async (
      projectId: string,
      kitIds: string[],
    ): Promise<{ succeeded: string[]; errors: { kitId: string; message: string }[] }> => {
      if (kitIds.length === 0) throw new Error("No kits selected");
      return undeployKitsBatchM({ orgId: requireOrg(), projectId, kitIds, auditId: createId(), now: Date.now(), actor: actor() });
    },

    unreturnKitsBatch: async (
      projectId: string,
      kitIds: string[],
    ): Promise<{ succeeded: string[]; errors: { kitId: string; message: string }[] }> => {
      if (kitIds.length === 0) throw new Error("No kits selected");
      return unreturnKitsBatchM({ orgId: requireOrg(), projectId, kitIds, auditId: createId(), now: Date.now(), actor: actor() });
    },

    checkInKit: async (
      projectId: string,
      kitId: string,
      returnCondition: ReturnCondition = "GOOD",
    ): Promise<{ kitId: string; affectedKitIds: string[] }> => {
      return checkInKitM({ orgId: requireOrg(), projectId, kitId, returnCondition, auditId: createId(), now: Date.now(), actor: actor() });
    },

    checkInKitsBatch: async (
      projectId: string,
      kits: Array<{ kitId: string; returnCondition: ReturnCondition }>,
    ): Promise<{ succeeded: string[]; errors: { kitId: string; message: string }[] }> => {
      return checkInKitsBatchM({
        orgId: requireOrg(),
        projectId,
        items: kits.map((k) => ({ ...k, auditId: createId() })),
        now: Date.now(),
        actor: actor(),
      });
    },

    clearPrepContainer: async (projectId: string, containerName: string): Promise<{ success: true }> => {
      return clearPrepContainerM({ orgId: requireOrg(), projectId, containerName, now: Date.now(), actor: actor() });
    },

    ensureContainerOnProject: async (
      projectId: string,
      assetId: string,
      modelId: string,
      containerName: string,
    ): Promise<{ id: string; created: boolean }> => {
      return ensureContainerOnProjectM({ orgId: requireOrg(), projectId, assetId, modelId, containerName, now: Date.now(), actor: actor() });
    },

    syncContainersBatch: async (
      projectId: string,
      containerNames: string[],
    ): Promise<{ results: Array<{ containerName: string; updated: boolean; status?: string }> }> => {
      return syncContainersBatchM({ orgId: requireOrg(), projectId, containerNames, now: Date.now(), actor: actor() });
    },

    // ── PR-B: reassign + force-return ───────────────────────────────────────────
    reassignLineItemUnit: async (
      projectId: string,
      unitId: string,
      targetLineItemId: string,
    ): Promise<
      | { moved: false }
      | { moved: true; assetTag?: string; fromLineItemId: string; toLineItemId: string }
    > => {
      return reassignLineItemUnitM({ orgId: requireOrg(), projectId, unitId, targetLineItemId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    reassignKitMemberSerial: async (
      projectId: string,
      unitId: string,
      newAssetId: string,
    ): Promise<
      | { moved: false }
      | { moved: true; fromAssetTag?: string; toAssetTag?: string; lineItemId: string }
    > => {
      return reassignKitMemberSerialM({ orgId: requireOrg(), projectId, unitId, newAssetId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    forceReturnAsset: async (assetId: string): Promise<{ success: true }> => {
      return forceReturnAssetM({ orgId: requireOrg(), assetId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    forceReturnKit: async (kitId: string): Promise<{ success: true; affectedKitIds: string[] }> => {
      return forceReturnKitM({ orgId: requireOrg(), kitId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    forceReturnKits: async (
      kitIds: string[],
    ): Promise<{ count: number; succeeded: string[]; errors: { kitId: string; error: string }[] }> => {
      if (kitIds.length === 0) throw new Error("No kits selected");
      return forceReturnKitsM({ orgId: requireOrg(), kitIds, auditId: createId(), now: Date.now(), actor: actor() });
    },

    bulkForceReturnAssets: async (assetIds: string[]): Promise<{ count: number }> => {
      if (assetIds.length === 0) throw new Error("No assets selected");
      return bulkForceReturnAssetsM({ orgId: requireOrg(), assetIds, auditId: createId(), now: Date.now(), actor: actor() });
    },
  };
}
