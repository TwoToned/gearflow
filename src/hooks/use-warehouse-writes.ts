"use client";

import { useMutation, useConvex } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { useCanDo } from "@/lib/use-permissions";
import { announceWarehouseWrite, countLabel, type AnnouncedWrite } from "@/lib/warehouse-undo-toast";

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

  // #1222 — the reverse permission is NOT the forward one, in either direction:
  // a check_out-only role can deploy but must never be offered Undo on it (the
  // reverse needs check_in), and the mirror holds for returns. Checked once,
  // here, so `announceWarehouseWrite()` can OMIT the toast's `action` entirely
  // rather than show a button that errors.
  const canUndoDeploy = useCanDo("warehouse", "check_in"); // undoes a checkOut*
  const canUndoReturn = useCanDo("warehouse", "check_out"); // undoes a checkIn*

  const checkOutItemsM = useMutation(api.warehouseWrites.checkOutItems);
  const logAccessoryCheckoutOverrideM = useMutation(api.warehouseWrites.logAccessoryCheckoutOverride);
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
  const setSalePickedM = useMutation(api.warehouseWrites.setSalePicked);
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

  /**
   * Best-effort kit name for the singular deploy/return toast ("Deployed kit
   * Pelican Rack A"). The mutation itself returns ids only (no re-read
   * waterfall — see this file's header comment), so this is a small extra
   * query purely for toast copy; a failure (or a kit with no name, which the
   * schema doesn't actually allow but a stale mirror might) falls back to a
   * generic title rather than blocking or erroring the toast.
   */
  const fetchKitName = async (kitId: string): Promise<string | null> => {
    try {
      const kit = await convex.query(api.kits.getById, { id: kitId });
      return kit?.name ?? null;
    } catch {
      return null;
    }
  };

  return {
    // ── PR-C: checkout keystone ──────────────────────────────────────────────────
    checkOutItems: async (
      projectId: string,
      // includeAccessoryIds narrows this item's accessory cascade to a
      // verified subset — the "Deploy Verified Only" partial-action escape
      // hatch (issue #794 follow-up), mirroring the kit prep dialog's UX.
      items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string; includeAccessoryIds?: string[] }>,
      includeAccessories = true,
    ): Promise<AnnouncedWrite<{ updatedLineIds: string[]; autoStatus: string | null }>> => {
      const org = requireOrg();
      const res = await checkOutItemsM({
        orgId: org,
        projectId,
        items,
        includeAccessories,
        auditIds: items.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
      const n = res.updatedLineIds.length;
      if (n === 0) return res;
      return announceWarehouseWrite(res, {
        doneTitle: `Deployed ${countLabel(n, "item")}`,
        undoneTitle: `Undone — ${countLabel(n, "item")} back in Prepped`,
        canUndo: canUndoDeploy,
        performUndo: async () => {
          await undeployItemsM({
            orgId: org,
            projectId,
            // Reverses the same items — undeployItemsCore already reverses the
            // accessory cascade checkoutItemsCore made (reverseAccessoryChildren);
            // nothing extra to pass.
            items: items.map((it) => ({ lineItemId: it.lineItemId, assetId: it.assetId, quantity: it.quantity })),
            auditIds: items.map(() => createId()),
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            now: Date.now(),
            actor: actor(),
          });
        },
      });
    },

    /** Records the Deploy accessory gate's override — a typed (or manager-tier
     *  auto-filled) reason per missing DEFAULT/OPTIONAL accessory, written to
     *  BOTH the activity log and that accessory line's own `notes` field
     *  (issue #794 follow-up). Fire-and-forget from the caller's perspective:
     *  it never blocks the checkout itself. */
    logAccessoryCheckoutOverride: async (
      projectId: string,
      parentName: string,
      skipped: Array<{ accessoryLineItemId: string; tier: "DEFAULT" | "OPTIONAL"; reason: string }>,
    ): Promise<{ logged: number }> => {
      if (skipped.length === 0) return { logged: 0 };
      return logAccessoryCheckoutOverrideM({
        orgId: requireOrg(),
        projectId,
        parentName,
        skipped,
        actor: actor(),
        now: Date.now(),
      });
    },

    checkOutKit: async (
      projectId: string,
      kitId: string,
    ): Promise<AnnouncedWrite<{ kitId: string; affectedKitIds: string[]; autoStatus: string | null }>> => {
      const org = requireOrg();
      const res = await checkOutKitM({ orgId: org, projectId, kitId, auditId: createId(), now: Date.now(), actor: actor() });
      const kitName = await fetchKitName(kitId);
      return announceWarehouseWrite(res, {
        doneTitle: kitName ? `Deployed kit ${kitName}` : "Deployed kit",
        undoneTitle: "Undone — kit back in Prepped",
        canUndo: canUndoDeploy,
        performUndo: async () => {
          await undeployKitsBatchM({
            orgId: org,
            projectId,
            kitIds: [kitId],
            auditId: createId(),
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            now: Date.now(),
            actor: actor(),
          });
        },
      });
    },

    checkOutKitsBatch: async (
      projectId: string,
      kitIds: string[],
    ): Promise<AnnouncedWrite<{ succeeded: string[]; errors: { kitId: string; message: string }[]; autoStatus: string | null }>> => {
      const org = requireOrg();
      const res = await checkOutKitsBatchM({
        orgId: org,
        projectId,
        kitIds,
        // One audit id per input kit — the mutation dedupes and only consumes as many
        // as succeed (succeeded ⊆ deduped ⊆ input), so this always covers them.
        auditIds: kitIds.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
      if (res.succeeded.length === 0) return res;
      return announceWarehouseWrite(res, {
        doneTitle: `Deployed ${countLabel(res.succeeded.length, "kit")}`,
        undoneTitle: `Undone — ${countLabel(res.succeeded.length, "kit")} back in Prepped`,
        canUndo: canUndoDeploy,
        performUndo: async () => {
          // Undo the kits that actually succeeded, never the requested ids —
          // undoing a partial batch must not attempt to reverse a kit that
          // never moved.
          await undeployKitsBatchM({
            orgId: org,
            projectId,
            kitIds: res.succeeded,
            auditId: createId(),
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            now: Date.now(),
            actor: actor(),
          });
        },
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
    ): Promise<AnnouncedWrite<{ updatedLineIds: string[]; autoStatus: string | null }>> => {
      const org = requireOrg();
      const res = await checkInItemsM({
        orgId: org,
        projectId,
        items,
        auditIds: items.map(() => createId()),
        now: Date.now(),
        actor: actor(),
      });
      const n = res.updatedLineIds.length;
      if (n === 0) return res;
      return announceWarehouseWrite(res, {
        doneTitle: `Checked in ${countLabel(n, "item")}`,
        undoneTitle: `Undone — ${countLabel(n, "item")} back in Deployed`,
        canUndo: canUndoReturn,
        performUndo: async () => {
          await unreturnItemsM({
            orgId: org,
            projectId,
            items: items.map((it) => ({ lineItemId: it.lineItemId, assetId: it.assetId, quantity: it.quantity })),
            auditIds: items.map(() => createId()),
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            now: Date.now(),
            actor: actor(),
          });
        },
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
    ): Promise<AnnouncedWrite<{ kitId: string; affectedKitIds: string[]; autoStatus: string | null }>> => {
      const org = requireOrg();
      const res = await checkInKitM({ orgId: org, projectId, kitId, returnCondition, auditId: createId(), now: Date.now(), actor: actor() });
      const kitName = await fetchKitName(kitId);
      return announceWarehouseWrite(res, {
        doneTitle: kitName ? `Checked in kit ${kitName}` : "Checked in kit",
        undoneTitle: "Undone — kit back in Deployed",
        canUndo: canUndoReturn,
        performUndo: async () => {
          await unreturnKitsBatchM({
            orgId: org,
            projectId,
            kitIds: [kitId],
            auditId: createId(),
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            now: Date.now(),
            actor: actor(),
          });
        },
      });
    },

    checkInKitsBatch: async (
      projectId: string,
      kits: Array<{ kitId: string; returnCondition: ReturnCondition }>,
    ): Promise<AnnouncedWrite<{ succeeded: string[]; errors: { kitId: string; message: string }[]; autoStatus: string | null }>> => {
      const org = requireOrg();
      const res = await checkInKitsBatchM({
        orgId: org,
        projectId,
        items: kits.map((k) => ({ ...k, auditId: createId() })),
        now: Date.now(),
        actor: actor(),
      });
      if (res.succeeded.length === 0) return res;
      return announceWarehouseWrite(res, {
        doneTitle: `Checked in ${countLabel(res.succeeded.length, "kit")}`,
        undoneTitle: `Undone — ${countLabel(res.succeeded.length, "kit")} back in Deployed`,
        canUndo: canUndoReturn,
        performUndo: async () => {
          await unreturnKitsBatchM({
            orgId: org,
            projectId,
            kitIds: res.succeeded,
            auditId: createId(),
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            now: Date.now(),
            actor: actor(),
          });
        },
      });
    },

    clearPrepContainer: async (projectId: string, containerName: string): Promise<{ success: true }> => {
      return clearPrepContainerM({ orgId: requireOrg(), projectId, containerName, now: Date.now(), actor: actor() });
    },

    setSalePicked: async (projectId: string, lineItemId: string, picked: boolean): Promise<{ id: string }> => {
      return setSalePickedM({ orgId: requireOrg(), projectId, lineItemId, picked, now: Date.now(), actor: actor() });
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
