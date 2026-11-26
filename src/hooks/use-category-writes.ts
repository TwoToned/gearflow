"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";

/**
 * Browser-direct CATEGORY writes (Phase 3 — replaces createCategory/updateCategory/
 * deleteCategory). Runs categorySchema before the guarded `api.categoriesWrites.*`
 * mutation (org re-check + delete-guards inside). Consumers subscribe to the reactive
 * useCategories list, so each write pushes a live update; no invalidation needed.
 */
export function useCategoryWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.categoriesWrites.createNative);
  const updateM = useMutation(api.categoriesWrites.updateNative);
  const removeM = useMutation(api.categoriesWrites.removeNative);
  const editM = useMutation(api.categoriesEditWrites.editNative);
  const undoEditM = useMutation(api.categoriesEditWrites.undoEditNative);
  const deleteMovingM = useMutation(api.categoriesEditWrites.deleteNative);
  const undoDeleteM = useMutation(api.categoriesEditWrites.undoDeleteNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };
  // `categorySchema.parse` returns the OUTPUT type (defaults applied → sortOrder:number).
  const fields = (parsed: ReturnType<typeof categorySchema.parse>) => ({
    name: parsed.name,
    parentId: parsed.parentId || undefined,
    description: parsed.description || undefined,
    icon: parsed.icon || undefined,
    sortOrder: parsed.sortOrder ?? 0,
    tags: parsed.tags ?? [],
    xeroAccountCode: parsed.xeroAccountCode || undefined,
  });

  return {
    create: async (data: CategoryFormValues): Promise<{ id: string }> => {
      const parsed = categorySchema.parse(data);
      return await createM({ id: createId(), orgId: requireOrg(), ...fields(parsed), now: Date.now(), actor: actor(), auditId: createId() });
    },
    update: async (id: string, data: CategoryFormValues): Promise<{ id: string }> => {
      const parsed = categorySchema.parse(data);
      return await updateM({ id, orgId: requireOrg(), ...fields(parsed), now: Date.now(), actor: actor(), auditId: createId() });
    },
    /**
     * The Category sheet's save (`categoriesEditWrites.editNative`): sets the changed fields and CLEARS the changed-to-blank
     * optional ones. Returns the audit id the toast's Undo takes (`undoEdit`) and whether anything changed.
     */
    edit: async (id: string, input: { set: Record<string, unknown>; clear: string[] }): Promise<{ id: string; changed: boolean; auditId: string }> => {
      const auditId = createId();
      const r = await editM({ orgId: requireOrg(), id, set: input.set as never, clear: input.clear, actor: actor(), auditId, now: Date.now() });
      return { ...r, auditId };
    },
    /** Exactly reverses {@link edit} (ids only; refuses if a changed field changed since). */
    undoEdit: async (id: string, auditId: string): Promise<{ id: string }> => {
      return await undoEditM({ orgId: requireOrg(), id, auditId, now: Date.now(), actor: actor() });
    },
    /** Delete: models and kits become Uncategorised, subcategories move up. Returns the audit id its Undo takes. */
    deleteMoving: async (id: string): Promise<{ id: string; auditId: string; movedModels: number; movedKits: number; movedSubcategories: number }> => {
      const auditId = createId();
      const r = await deleteMovingM({ orgId: requireOrg(), id, actor: actor(), auditId, now: Date.now() });
      return { ...r, auditId };
    },
    /** Exactly reverses {@link deleteMoving} (ids only; refuses unless everything it moved is still as it left it). */
    undoDelete: async (id: string, auditId: string): Promise<{ id: string }> => {
      return await undoDeleteM({ orgId: requireOrg(), id, auditId, now: Date.now(), actor: actor() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      return await removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
