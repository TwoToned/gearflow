"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { checkItemSchema, type CheckItemFormValues } from "@/lib/validations/check-item";

/**
 * Browser-direct CHECK-ITEM writes (Phase 3 — replaces the check-items.ts server
 * actions). Check items + their model/kit assignment join tables are Convex-only
 * config; each guarded `api.checkItemsWrites.*` mutation runs the 4 guards + org
 * re-check + audit. Fire-and-forget (reactive hooks refresh the lists); only
 * `bulkAddToModels` returns a scalar count for the toast. Validation runs client-side
 * against checkItemSchema before the create/update mutation.
 */
export function useCheckItemWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.checkItemsWrites.createCheckItemNative);
  const updateM = useMutation(api.checkItemsWrites.updateCheckItemNative);
  const removeM = useMutation(api.checkItemsWrites.deleteCheckItemNative);
  const addModelM = useMutation(api.checkItemsWrites.addCheckItemToModelNative);
  const removeModelM = useMutation(api.checkItemsWrites.removeCheckItemFromModelNative);
  const reorderModelM = useMutation(api.checkItemsWrites.reorderModelCheckItemsNative);
  const bulkAddModelM = useMutation(api.checkItemsWrites.bulkAddCheckItemsToModelsNative);
  const addKitM = useMutation(api.checkItemsWrites.addCheckItemToKitNative);
  const removeKitM = useMutation(api.checkItemsWrites.removeCheckItemFromKitNative);
  const reorderKitM = useMutation(api.checkItemsWrites.reorderKitCheckItemsNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };
  const parsedFields = (data: CheckItemFormValues) => {
    const p = checkItemSchema.parse(data);
    return {
      label: p.label,
      description: p.description || undefined,
      type: p.type ?? "PASS_FAIL",
      category: p.category || undefined,
      measurementUnit: p.measurementUnit || undefined,
      measurementMin: p.measurementMin ?? undefined,
      measurementMax: p.measurementMax ?? undefined,
      dropdownOptions: p.dropdownOptions ?? undefined,
    };
  };

  return {
    createCheckItem: async (data: CheckItemFormValues): Promise<{ id: string }> =>
      createM({ id: createId(), orgId: requireOrg(), ...parsedFields(data), now: Date.now(), actor: actor(), auditId: createId() }),
    updateCheckItem: async (id: string, data: CheckItemFormValues): Promise<{ id: string }> =>
      updateM({ id, orgId: requireOrg(), ...parsedFields(data), now: Date.now(), actor: actor(), auditId: createId() }),
    deleteCheckItem: async (id: string): Promise<{ id: string }> =>
      removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),

    addCheckItemToModel: async (modelId: string, checkItemId: string) =>
      addModelM({ id: createId(), orgId: requireOrg(), modelId, checkItemId, now: Date.now(), actor: actor(), auditId: createId() }),
    removeCheckItemFromModel: async (modelId: string, checkItemId: string) =>
      removeModelM({ orgId: requireOrg(), modelId, checkItemId, now: Date.now(), actor: actor(), auditId: createId() }),
    reorderModelCheckItems: async (modelId: string, orderedCheckItemIds: string[]) =>
      reorderModelM({ orgId: requireOrg(), modelId, orderedCheckItemIds }),
    bulkAddCheckItemsToModels: async (modelIds: string[], checkItemIds: string[]): Promise<{ count: number; modelNames: string[] }> =>
      bulkAddModelM({ orgId: requireOrg(), modelIds, checkItemIds, rowIds: modelIds.flatMap(() => checkItemIds.map(() => createId())), now: Date.now(), actor: actor(), auditId: createId() }),

    addCheckItemToKit: async (kitId: string, checkItemId: string) =>
      addKitM({ id: createId(), orgId: requireOrg(), kitId, checkItemId, now: Date.now(), actor: actor(), auditId: createId() }),
    removeCheckItemFromKit: async (kitId: string, checkItemId: string) =>
      removeKitM({ orgId: requireOrg(), kitId, checkItemId, now: Date.now(), actor: actor(), auditId: createId() }),
    reorderKitCheckItems: async (kitId: string, orderedCheckItemIds: string[]) =>
      reorderKitM({ orgId: requireOrg(), kitId, orderedCheckItemIds }),
  };
}
