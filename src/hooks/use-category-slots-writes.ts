"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct CROSS-TYPE CATEGORY-SLOT writes (Phase 3 — replaces the
 * moveSubHireGroupToCategory / moveProjectGroupToCategory /
 * reorderMixedGroupsInCategory / createCategoryAndPlaceGroup server actions in
 * src/server/category-slots.ts). Each guarded `api.categorySlotsWrites.*`
 * mutation folds permission + validation + slot writes + placement sync +
 * in-mutation recalcProjectTotals (+ audit) into ONE transaction. The client
 * mints the category / slot / audit cuids and supplies actor / orgId / now.
 * Reads are reactive native subscriptions, so callers don't refetch a store.
 */
export function useCategorySlotWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const moveSubHireGroupM = useMutation(api.categorySlotsWrites.moveSubHireGroupToCategory);
  const moveProjectGroupM = useMutation(api.categorySlotsWrites.moveProjectGroupToCategory);
  const reorderMixedM = useMutation(api.categorySlotsWrites.reorderMixedGroupsInCategory);
  const createAndPlaceM = useMutation(api.categorySlotsWrites.createCategoryAndPlaceGroup);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /** `justification` — required once the group's project is JUSTIFY+ with no
     *  open unlock session (drag-and-drop cross-category move routes this
     *  through useJustifiedMutation). */
    moveSubHireGroup: async (args: {
      groupId: string;
      categoryId: string | null;
      justification?: string;
    }): Promise<void> => {
      await moveSubHireGroupM({
        groupId: args.groupId,
        orgId: requireOrg(),
        categoryId: args.categoryId,
        slotId: createId(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
        justification: args.justification,
      });
    },

    moveProjectGroup: async (args: {
      groupId: string;
      categoryId: string | null;
      justification?: string;
    }): Promise<void> => {
      await moveProjectGroupM({
        groupId: args.groupId,
        orgId: requireOrg(),
        categoryId: args.categoryId,
        slotId: createId(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
        justification: args.justification,
      });
    },

    reorderMixed: async (args: {
      categoryId: string;
      orderedIds: string[];
      justification?: string;
    }): Promise<void> => {
      await reorderMixedM({
        orgId: requireOrg(),
        categoryId: args.categoryId,
        items: args.orderedIds.map((prefixedId) => ({ prefixedId, newSlotId: createId() })),
        now: Date.now(),
        actor: actor(),
        justification: args.justification,
      });
    },

    createCategoryAndPlaceGroup: async (args: {
      projectId: string;
      name: string;
      slot: { projectGroupId?: string | null; subHireGroupId?: string | null };
    }): Promise<{ id: string; name: string }> => {
      return createAndPlaceM({
        categoryId: createId(),
        slotId: createId(),
        orgId: requireOrg(),
        projectId: args.projectId,
        name: args.name,
        slot: args.slot,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
