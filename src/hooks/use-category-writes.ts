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
    remove: async (id: string): Promise<{ id: string }> => {
      return await removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
