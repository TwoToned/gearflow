"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct SUB-HIRE writes (Phase 3, PR-1 — replaces the subHire CRUD +
 * status/payment + item CRUD server actions in src/server/sub-hires.ts). Each guarded
 * `api.subHiresWrites.*` mutation folds permission + FK validation + the money cascade
 * (recalcSubHireTotals → regenerateSubHireLines → recalcProjectTotals) + audit into ONE
 * transaction. The client mints the sub-hire/item/audit cuids and supplies actor/orgId/now.
 *
 * Reads STAY on the server-action store (getSubHire / getSubHires via
 * createSharedResource), so call-sites keep their `invalidate()` refresh in onSuccess.
 * GROUP CRUD / placement / order-pricing / duplicate / changeProject / media remain on
 * the server action (PR-2).
 */

/** Date-input "YYYY-MM-DD" → epoch ms (mirrors subHireSchema's coerce.date). */
function toMs(d?: string | Date): number | undefined {
  if (!d) return undefined;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? undefined : t;
}

export interface SubHireHeadInput {
  supplierId: string;
  projectId?: string;
  supplierReference?: string;
  hireStart?: string | Date;
  hireEnd?: string | Date;
  showOnDocs?: boolean;
  notes?: string;
  defaultTargetCategoryId?: string | null;
  defaultTargetGroupId?: string | null;
}

export interface SubHireItemInput {
  modelId?: string;
  groupId?: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitCharge: number;
  pricingType: "FLAT" | "PER_DAY" | "PER_WEEK" | "PER_HOUR";
  duration: number;
  discount: number;
  showOnQuote?: boolean;
  showOnDocs?: boolean;
  targetCategoryId?: string | null;
  targetGroupId?: string | null;
}

export function useSubHireWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.subHiresWrites.createSubHireNative);
  const updateM = useMutation(api.subHiresWrites.updateSubHireNative);
  const deleteM = useMutation(api.subHiresWrites.deleteSubHireNative);
  const statusM = useMutation(api.subHiresWrites.updateSubHireStatusNative);
  const paymentM = useMutation(api.subHiresWrites.updateSubHirePaymentStatusNative);
  const addItemM = useMutation(api.subHiresWrites.addSubHireItemNative);
  const updateItemM = useMutation(api.subHiresWrites.updateSubHireItemNative);
  const removeItemM = useMutation(api.subHiresWrites.removeSubHireItemNative);
  const reorderItemsM = useMutation(api.subHiresWrites.reorderSubHireItemsNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (input: SubHireHeadInput): Promise<{ id: string; orderNumber: string }> => {
      return createM({
        id: createId(),
        orgId: requireOrg(),
        supplierId: input.supplierId,
        projectId: input.projectId || undefined,
        supplierReference: input.supplierReference || undefined,
        hireStart: toMs(input.hireStart),
        hireEnd: toMs(input.hireEnd),
        showOnDocs: input.showOnDocs ?? false,
        notes: input.notes || undefined,
        defaultTargetCategoryId: input.defaultTargetCategoryId || undefined,
        defaultTargetGroupId: input.defaultTargetGroupId || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    update: async (subHireId: string, input: SubHireHeadInput): Promise<void> => {
      await updateM({
        id: subHireId,
        orgId: requireOrg(),
        supplierId: input.supplierId,
        showOnDocs: input.showOnDocs ?? false,
        projectId: input.projectId || undefined,
        hireStart: toMs(input.hireStart),
        hireEnd: toMs(input.hireEnd),
        notes: input.notes || undefined,
        supplierReference: input.supplierReference,
        defaultTargetCategoryId: input.defaultTargetCategoryId ?? undefined,
        defaultTargetGroupId: input.defaultTargetGroupId ?? undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    remove: async (subHireId: string): Promise<void> => {
      await deleteM({ id: subHireId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },

    setStatus: async (subHireId: string, status: "DRAFT" | "CONFIRMED" | "ON_HIRE" | "RETURNED" | "CANCELLED"): Promise<void> => {
      await statusM({ id: subHireId, orgId: requireOrg(), status, now: Date.now(), actor: actor(), auditId: createId() });
    },

    setPaymentStatus: async (subHireId: string, paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID"): Promise<void> => {
      await paymentM({ id: subHireId, orgId: requireOrg(), paymentStatus, now: Date.now(), actor: actor(), auditId: createId() });
    },

    addItem: async (subHireId: string, input: SubHireItemInput): Promise<{ id: string }> => {
      return addItemM({
        id: createId(),
        orgId: requireOrg(),
        subHireId,
        modelId: input.modelId || undefined,
        groupId: input.groupId || undefined,
        description: input.description,
        quantity: input.quantity,
        unitCost: input.unitCost,
        unitCharge: input.unitCharge,
        pricingType: input.pricingType,
        duration: input.duration,
        discount: input.discount,
        showOnQuote: input.showOnQuote,
        showOnDocs: input.showOnDocs,
        targetCategoryId: input.targetCategoryId || undefined,
        targetGroupId: input.targetGroupId || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    updateItem: async (itemId: string, input: SubHireItemInput): Promise<void> => {
      await updateItemM({
        itemId,
        orgId: requireOrg(),
        modelId: input.modelId || undefined,
        groupId: input.groupId || undefined,
        description: input.description,
        quantity: input.quantity,
        unitCost: input.unitCost,
        unitCharge: input.unitCharge,
        pricingType: input.pricingType,
        duration: input.duration,
        discount: input.discount,
        showOnQuote: input.showOnQuote,
        showOnDocs: input.showOnDocs,
        targetCategoryId: input.targetCategoryId ?? undefined,
        targetGroupId: input.targetGroupId ?? undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    removeItem: async (itemId: string): Promise<void> => {
      await removeItemM({ itemId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },

    reorderItems: async (subHireId: string, itemIds: string[]): Promise<void> => {
      await reorderItemsM({ orgId: requireOrg(), subHireId, itemIds, now: Date.now(), actor: actor() });
    },
  };
}
