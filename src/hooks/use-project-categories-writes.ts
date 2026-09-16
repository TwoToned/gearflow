"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { CategoryPricingDisplay } from "@/lib/category-pricing-display";

/**
 * Browser-direct PROJECT-CATEGORY writes (Phase 3 — replaces the create/update/
 * delete/reorder ProjectCategory server actions in src/server/project-categories.ts).
 * The atomic create-at-end / cascade-delete / reorder now run inside the guarded
 * `api.projectCategoriesWrites.*` mutations (permission + validation + audit + collab
 * event all fold into the one transaction). Category/group reads are reactive native
 * subscriptions, so callers no longer refetch a shared server-action store on success.
 */
export function useProjectCategoryWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.projectCategoriesWrites.createCategoryNative);
  const updateM = useMutation(api.projectCategoriesWrites.updateCategoryNative);
  const deleteM = useMutation(api.projectCategoriesWrites.deleteCategoryNative);
  const reorderM = useMutation(api.projectCategoriesWrites.reorderCategoriesNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    // #1221 follow-up — `versionId` (optional) is the version this new
    // category lands on, defaulting to live (server-side) when omitted.
    create: async (projectId: string, name: string, versionId?: string): Promise<void> => {
      await createM({
        id: createId(),
        orgId: requireOrg(),
        projectId,
        name,
        versionId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    update: async (categoryId: string, name: string): Promise<void> => {
      await updateM({
        id: categoryId,
        orgId: requireOrg(),
        name,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    /** Flip a category between per-line pricing and one derived section
     *  subtotal on client-facing documents (src/lib/category-pricing-display.ts).
     *  Sent as its own call rather than folded into `update` so the audit entry
     *  records the display change instead of a phantom rename. */
    setPricingDisplay: async (
      categoryId: string,
      pricingDisplay: CategoryPricingDisplay,
    ): Promise<void> => {
      await updateM({
        id: categoryId,
        orgId: requireOrg(),
        pricingDisplay,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (categoryId: string): Promise<void> => {
      await deleteM({
        id: categoryId,
        orgId: requireOrg(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    /** Structural — never gated by pricingLocked (#1230). */
    reorder: async (args: { orderedIds: string[] }): Promise<void> => {
      await reorderM({
        orgId: requireOrg(),
        orderedIds: args.orderedIds,
        now: Date.now(),
        actor: actor(),
      });
    },
  };
}
