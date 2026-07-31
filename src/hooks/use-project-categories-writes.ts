"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

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
    create: async (projectId: string, name: string): Promise<void> => {
      await createM({
        id: createId(),
        orgId: requireOrg(),
        projectId,
        name,
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
    remove: async (categoryId: string): Promise<void> => {
      await deleteM({
        id: categoryId,
        orgId: requireOrg(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    /** `justification` — required once a touched project is JUSTIFY+ with no
     *  open unlock session (drag-and-drop reorder routes this through
     *  useJustifiedMutation). */
    reorder: async (args: { orderedIds: string[]; justification?: string }): Promise<void> => {
      await reorderM({
        orgId: requireOrg(),
        orderedIds: args.orderedIds,
        now: Date.now(),
        actor: actor(),
        justification: args.justification,
      });
    },
  };
}
