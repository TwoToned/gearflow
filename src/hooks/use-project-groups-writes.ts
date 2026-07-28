"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { DiscountMode } from "@/lib/discount-mode";

/**
 * Browser-direct PROJECT-GROUP writes (Phase 3 — replaces the create/update/
 * updatePrice/delete/reorder/move ProjectGroup server actions in
 * src/server/project-groups.ts). Each guarded `api.projectGroupsWrites.*` mutation
 * folds permission + validation + suggested-price recompute + in-mutation
 * recalcProjectTotals + audit (+ collab event) into ONE transaction. The client
 * mints the group/audit cuids and supplies actor/orgId/now. Reads are reactive
 * native subscriptions, so callers don't refetch a shared server-action store.
 */
export function useProjectGroupWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.projectGroupsWrites.createGroupNative);
  const updateM = useMutation(api.projectGroupsWrites.updateGroupNative);
  const updatePriceM = useMutation(api.projectGroupsWrites.updateGroupPriceNative);
  const deleteM = useMutation(api.projectGroupsWrites.deleteGroupNative);
  const reorderM = useMutation(api.projectGroupsWrites.reorderGroupsNative);
  const moveM = useMutation(api.projectGroupsWrites.moveLineItemNative);
  const bulkMoveM = useMutation(api.projectGroupsWrites.moveLineItemsNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (
      projectId: string,
      categoryId: string | null,
      title: string,
    ): Promise<{ id: string; sortOrder: number }> => {
      return createM({
        id: createId(),
        orgId: requireOrg(),
        projectId,
        categoryId: categoryId || undefined,
        title,
        quantity: 1,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    update: async (
      groupId: string,
      data: Partial<{ title: string; description: string; quantity: number; xeroAccountCode: string; xeroTaxType: string }>,
    ): Promise<void> => {
      await updateM({
        id: groupId,
        orgId: requireOrg(),
        title: data.title,
        description: data.description,
        quantity: data.quantity,
        xeroAccountCode: data.xeroAccountCode,
        xeroTaxType: data.xeroTaxType,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    updatePrice: async (
      groupId: string,
      price: number,
      discount?: number,
      /** #1012 — how `discount` was entered; persisted for document display. */
      discountMode?: DiscountMode,
    ): Promise<void> => {
      await updatePriceM({
        id: groupId,
        orgId: requireOrg(),
        price,
        discount,
        discountMode: discount != null ? discountMode : undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    /** `justification` (#990) — forwarded to `deleteGroupNative`, required once
     *  the project is ON_SITE+ with no open unlock session. */
    remove: async (groupId: string, justification?: string): Promise<void> => {
      await deleteM({
        id: groupId,
        orgId: requireOrg(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
        justification,
      });
    },

    reorder: async (orderedIds: string[]): Promise<void> => {
      await reorderM({
        orgId: requireOrg(),
        orderedIds,
        now: Date.now(),
        actor: actor(),
      });
    },

    moveLineItem: async (args: {
      lineItemId: string;
      targetGroupId: string | null;
      targetCategoryId: string | null;
    }): Promise<void> => {
      await moveM({
        lineItemId: args.lineItemId,
        orgId: requireOrg(),
        targetGroupId: args.targetGroupId,
        targetCategoryId: args.targetCategoryId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    moveLineItems: async (args: {
      lineItemIds: string[];
      targetGroupId: string | null;
      targetCategoryId: string | null;
    }): Promise<{ moved: number; skipped: number }> => {
      return bulkMoveM({
        lineItemIds: args.lineItemIds,
        orgId: requireOrg(),
        targetGroupId: args.targetGroupId,
        targetCategoryId: args.targetCategoryId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
