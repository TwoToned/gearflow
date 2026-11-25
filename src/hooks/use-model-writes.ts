"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { modelSchema, type ModelFormValues } from "@/lib/validations/model";

/**
 * Browser-direct MODEL writes (Phase 3 — replaces the createModel/updateModel/
 * archiveModel/bulkUpdateRates server actions). Each calls the guarded
 * `api.modelWrites.*` mutation directly with the caller-minted id/auditId/now +
 * the verified actor. Create/update run modelSchema.parse first (the form's
 * zodResolver validates the main flow; this guards any other caller and strips
 * unknown keys). The models table + detail read reactively/one-shot, so writes
 * refresh via their own paths.
 */
export function useModelWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.modelWrites.createNative);
  const updateM = useMutation(api.modelWrites.updateNative);
  const archiveM = useMutation(api.modelWrites.archiveNative);
  const restoreM = useMutation(api.modelWrites.restoreNative);
  const undoArchiveM = useMutation(api.modelWrites.undoArchiveNative);
  const duplicateM = useMutation(api.modelWrites.duplicateNative);
  const undoDuplicateM = useMutation(api.modelWrites.undoDuplicateNative);
  const bulkRatesM =useMutation(api.modelWrites.bulkUpdateRatesNative);
  const adjustSaleStockM = useMutation(api.modelWrites.adjustSaleStockNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: ModelFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = modelSchema.parse(data);
      const id = createId();
      const now = Date.now();
      await createM({ id, orgId: org, ...parsed, now, actor: actor(), auditId: createId() });
      return { id };
    },
    update: async (id: string, data: ModelFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = modelSchema.parse(data);
      await updateM({ id, orgId: org, ...parsed, now: Date.now(), actor: actor(), auditId: createId() });
      return { id };
    },
    /** Soft archive (assets stay). `auditId` is the handle `undoArchive` takes. */
    archive: async (id: string): Promise<{ id: string; undoable: boolean; auditId: string }> => {
      const org = requireOrg();
      const auditId = createId();
      const r = await archiveM({ id, orgId: org, now: Date.now(), actor: actor(), auditId });
      return { ...r, auditId };
    },
    restore: async (id: string): Promise<{ id: string; undoable: boolean; auditId: string }> => {
      const org = requireOrg();
      const auditId = createId();
      const r = await restoreM({ id, orgId: org, now: Date.now(), actor: actor(), auditId });
      return { ...r, auditId };
    },
    /** The exact reverse of one archive / restore, from its own audit row (ids only). */
    undoArchive: async (id: string, auditId: string): Promise<{ restored: string[] }> => {
      const org = requireOrg();
      return await undoArchiveM({ id, orgId: org, auditId, now: Date.now(), actor: actor() });
    },
    /** A new model copying `sourceId`'s fields only. `auditId` is the handle `undoDuplicate` takes. */
    duplicate: async (sourceId: string): Promise<{ id: string; name: string; auditId: string }> => {
      const org = requireOrg();
      const id = createId();
      const auditId = createId();
      const r = await duplicateM({ sourceId, id, orgId: org, now: Date.now(), actor: actor(), auditId });
      return { ...r, auditId };
    },
    /** Deletes exactly the copy one `duplicate` made (refused if edited or used since). */
    undoDuplicate: async (id: string, auditId: string): Promise<{ deleted: string }> => {
      const org = requireOrg();
      return await undoDuplicateM({ id, orgId: org, auditId, now: Date.now(), actor: actor() });
    },
    bulkUpdateRates: async (
      modelIds: string[],
      rateType: "dailyRate" | "weeklyRate" | "monthlyRate" | "salePrice",
      operation: "set" | "multiply" | "increase_percent",
      value: number,
    ): Promise<{ count: number }> => {
      const org = requireOrg();
      return await bulkRatesM({ orgId: org, modelIds, rateType, operation, value, now: Date.now(), actor: actor(), auditId: createId() });
    },
    adjustSaleStock: async (id: string, delta: number, reason?: string): Promise<{ id: string; saleStockQuantity: number }> => {
      const org = requireOrg();
      return await adjustSaleStockM({ id, orgId: org, delta, reason, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
