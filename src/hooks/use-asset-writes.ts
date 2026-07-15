"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import { validateCustomFieldValues, type CustomFieldDef } from "@/lib/validations/custom-field";
import { useActiveCustomFields } from "@/hooks/use-custom-fields";

/**
 * Browser-direct ASSET writes (Phase 3 — replaces createAsset/createAssets/
 * updateAsset/bulkUpdateAssets/bulkTagAssets/deleteAsset/archiveAsset/updateAssetNotes).
 * Each calls the guarded `api.assetWrites.*` mutation with the caller-minted id/
 * auditId/now + the verified actor. create/createMany/update run assetSchema.parse +
 * resolve custom fields against the org's active ASSET definitions (the boundary for
 * cross-tenant/RBAC/dup/counters/T&T is the mutation). The registry table/detail read
 * reactively; the T&T-new picker reads listPage one-shot.
 */
export function useAssetWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const customFieldDefs = useActiveCustomFields(orgId, "ASSET");

  const createM = useMutation(api.assetWrites.createNative);
  const createManyM = useMutation(api.assetWrites.createManyNative);
  const updateM = useMutation(api.assetWrites.updateNative);
  const bulkUpdateM = useMutation(api.assetWrites.bulkUpdateNative);
  const bulkTagM = useMutation(api.assetWrites.bulkTagNative);
  const deleteM = useMutation(api.assetWrites.deleteNative);
  const archiveM = useMutation(api.assetWrites.archiveNative);
  const notesM = useMutation(api.assetWrites.updateNotesNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };
  const resolveCF = (raw: Record<string, string> | null | undefined): Record<string, string> => {
    const defs = (customFieldDefs ?? []) as unknown as CustomFieldDef[];
    return defs.length ? validateCustomFieldValues(defs, raw) : {};
  };

  const buildSetClear = (p: ReturnType<typeof assetSchema.parse>, cf: Record<string, string>) => {
    const set: Record<string, unknown> = {
      modelId: p.modelId, assetTag: p.assetTag, status: p.status, condition: p.condition,
      customFieldValues: cf, barcode: p.barcode || p.assetTag, isActive: p.isActive,
      tags: p.tags ?? [], images: p.images ?? [],
    };
    const clear: string[] = [];
    const setOrClear = (field: string, value: unknown) => {
      if (value == null || value === "") clear.push(field); else set[field] = value;
    };
    setOrClear("serialNumber", p.serialNumber);
    setOrClear("customName", p.customName);
    setOrClear("purchaseDate", p.purchaseDate ? new Date(p.purchaseDate).getTime() : null);
    setOrClear("purchasePrice", p.purchasePrice != null ? Number(p.purchasePrice) : null);
    setOrClear("purchaseSupplier", p.purchaseSupplier);
    setOrClear("supplierId", p.supplierId);
    setOrClear("warrantyExpiry", p.warrantyExpiry ? new Date(p.warrantyExpiry).getTime() : null);
    setOrClear("notes", p.notes);
    setOrClear("locationId", p.locationId);
    return { set, clear };
  };

  return {
    create: async (data: AssetFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = assetSchema.parse(data);
      const cf = resolveCF(p.customFieldValues);
      const id = createId();
      const now = Date.now();
      await createM({
        id, organizationId: org, modelId: p.modelId, assetTag: p.assetTag,
        serialNumber: p.serialNumber || undefined, customName: p.customName || undefined,
        status: p.status, condition: p.condition,
        purchaseDate: p.purchaseDate ? new Date(p.purchaseDate).getTime() : undefined,
        purchasePrice: p.purchasePrice != null ? Number(p.purchasePrice) : undefined,
        purchaseSupplier: p.purchaseSupplier || undefined, supplierId: p.supplierId || undefined,
        purchaseOrderNumber: p.purchaseOrderNumber || undefined,
        warrantyExpiry: p.warrantyExpiry ? new Date(p.warrantyExpiry).getTime() : undefined,
        notes: p.notes || undefined, locationId: p.locationId || undefined, customFieldValues: cf,
        barcode: p.barcode || p.assetTag, qrCode: p.assetTag, images: p.images || undefined,
        isActive: p.isActive, tags: p.tags || undefined, createdAt: now, updatedAt: now,
        actor: actor(), auditId: createId(),
      });
      return { id };
    },
    createMany: async (data: AssetFormValues, assets: { tag: string; serialNumber?: string }[]): Promise<{ ids: string[] }> => {
      const org = requireOrg();
      const p = assetSchema.parse(data);
      const cf = resolveCF(p.customFieldValues);
      const now = Date.now();
      const payload = assets.map(({ tag, serialNumber }) => ({
        id: createId(), auditId: createId(), modelId: p.modelId, assetTag: tag,
        serialNumber: serialNumber || p.serialNumber || undefined, customName: p.customName || undefined,
        status: p.status, condition: p.condition,
        purchaseDate: p.purchaseDate ? new Date(p.purchaseDate).getTime() : undefined,
        purchasePrice: p.purchasePrice != null ? Number(p.purchasePrice) : undefined,
        purchaseSupplier: p.purchaseSupplier || undefined, supplierId: p.supplierId || undefined,
        warrantyExpiry: p.warrantyExpiry ? new Date(p.warrantyExpiry).getTime() : undefined,
        notes: p.notes || undefined, locationId: p.locationId || undefined, customFieldValues: cf,
        barcode: p.barcode || tag, qrCode: tag, images: p.images || undefined,
        isActive: p.isActive, tags: p.tags || undefined,
      }));
      return await createManyM({ orgId: org, now, actor: actor(), assets: payload });
    },
    update: async (id: string, data: AssetFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = assetSchema.parse(data);
      const cf = resolveCF(p.customFieldValues);
      const { set, clear } = buildSetClear(p, cf);
      await updateM({ id, orgId: org, set, clear, actor: actor(), auditId: createId(), now: Date.now() });
      return { id };
    },
    bulkUpdate: async (ids: string[], data: { status?: string; condition?: string; locationId?: string | null }): Promise<{ count: number }> => {
      const org = requireOrg();
      const set: { status?: string; condition?: string; locationId?: string } = {};
      const clear: "locationId"[] = [];
      if (data.status) set.status = data.status;
      if (data.condition) set.condition = data.condition;
      if (data.locationId !== undefined) { if (data.locationId) set.locationId = data.locationId; else clear.push("locationId"); }
      if (Object.keys(set).length === 0 && clear.length === 0) throw new Error("No changes specified");
      return await bulkUpdateM({ orgId: org, ids, set: set as { status?: "AVAILABLE"; condition?: "NEW"; locationId?: string }, clear, now: Date.now() });
    },
    bulkTag: async (ids: string[], tags: string[]): Promise<{ count: number }> => {
      const org = requireOrg();
      return await bulkTagM({ orgId: org, ids, tags, now: Date.now() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
    archive: async (id: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await archiveM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
    updateNotes: async (id: string, notes: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await notesM({ id, orgId: org, notes: notes || null, actor: actor(), auditId: createId(), now: Date.now() });
    },
  };
}
