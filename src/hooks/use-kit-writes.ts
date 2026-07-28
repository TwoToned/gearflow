"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { kitSchema, type KitFormValues } from "@/lib/validations/kit";

/**
 * Browser-direct KIT writes (Phase 3 — replaces createKit/updateKit/updateKitNotes/
 * archiveKit/deleteKit + the member add/remove server actions). Each calls the
 * guarded `api.kitWrites.*` mutation with the caller-minted id/auditId/now + the
 * verified actor. create/update run kitSchema.parse (form zodResolver validates the
 * main flow; this guards other callers + strips unknown keys). Kit detail reads
 * reactively (kitDetail.bundle), so writes refresh via the subscription.
 */
export function useKitWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.kitWrites.createNative);
  const updateM = useMutation(api.kitWrites.updateNative);
  const notesM = useMutation(api.kitWrites.updateNotesNative);
  const archiveM = useMutation(api.kitWrites.archiveNative);
  const deleteM = useMutation(api.kitWrites.deleteNative);
  const addSerM = useMutation(api.kitWrites.addSerializedItemsNative);
  const removeSerM = useMutation(api.kitWrites.removeSerializedItemNative);
  const addBulkM = useMutation(api.kitWrites.addBulkItemNative);
  const removeBulkM = useMutation(api.kitWrites.removeBulkItemNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: KitFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = kitSchema.parse(data);
      const id = createId();
      const now = Date.now();
      await createM({
        id, organizationId: org, name: p.name, assetTag: p.assetTag,
        description: p.description || undefined, categoryId: p.categoryId || undefined,
        status: p.status, condition: p.condition, locationId: p.locationId || undefined,
        weight: p.weight ?? undefined, caseType: p.caseType || undefined, caseDimensions: p.caseDimensions || undefined,
        notes: p.notes || undefined, purchaseDate: p.purchaseDate ? new Date(p.purchaseDate).getTime() : undefined,
        purchasePrice: p.purchasePrice ?? undefined, image: p.image || undefined, images: p.images ?? undefined,
        barcode: p.assetTag, qrCode: p.assetTag, isActive: p.isActive, tags: p.tags ?? undefined, checkMode: p.checkMode,
        xeroAccountCode: p.xeroAccountCode || undefined,
        createdAt: now, updatedAt: now, actor: actor(), auditId: createId(),
      });
      return { id };
    },
    update: async (id: string, data: KitFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = kitSchema.parse(data);
      await updateM({
        id, orgId: org, patch: {
          name: p.name, assetTag: p.assetTag, description: p.description || undefined, categoryId: p.categoryId || undefined,
          status: p.status, condition: p.condition, locationId: p.locationId || undefined, weight: p.weight ?? undefined,
          caseType: p.caseType || undefined, caseDimensions: p.caseDimensions || undefined, notes: p.notes || undefined,
          purchaseDate: p.purchaseDate ? new Date(p.purchaseDate).getTime() : undefined, purchasePrice: p.purchasePrice ?? undefined,
          image: p.image || undefined, images: p.images ?? undefined, isActive: p.isActive, tags: p.tags ?? undefined,
          checkMode: p.checkMode, xeroAccountCode: p.xeroAccountCode || undefined, updatedAt: Date.now(),
        },
        actor: actor(), auditId: createId(), now: Date.now(),
      });
      return { id };
    },
    updateNotes: async (id: string, notes: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await notesM({ id, orgId: org, notes: notes || null, actor: actor(), auditId: createId(), now: Date.now() });
    },
    archive: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await archiveM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
    addSerializedItems: async (kitId: string, items: Array<{ assetId: string; position?: string }>): Promise<{ ids: string[] }> => {
      const org = requireOrg();
      return await addSerM({ orgId: org, kitId, items: items.map((i) => ({ assetId: i.assetId, position: i.position || undefined })), actor: actor(), auditId: createId(), now: Date.now() });
    },
    removeSerializedItem: async (kitId: string, assetId: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await removeSerM({ orgId: org, kitId, assetId, actor: actor(), auditId: createId(), now: Date.now() });
    },
    addBulkItem: async (kitId: string, data: { bulkAssetId: string; quantity: number; position?: string; notes?: string }): Promise<{ id: string }> => {
      const org = requireOrg();
      return await addBulkM({ orgId: org, kitId, bulkAssetId: data.bulkAssetId, quantity: data.quantity, position: data.position || undefined, notes: data.notes || undefined, actor: actor(), auditId: createId(), now: Date.now() });
    },
    removeBulkItem: async (kitId: string, bulkItemId: string): Promise<{ bulkAssetId: string }> => {
      const org = requireOrg();
      return await removeBulkM({ orgId: org, kitId, bulkItemId, actor: actor(), auditId: createId(), now: Date.now() });
    },
  };
}
