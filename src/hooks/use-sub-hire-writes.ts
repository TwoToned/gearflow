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
 * PR-2 adds the rest of the write surface: GROUP CRUD (createGroup / updateGroup /
 * deleteGroup / setItemGroup), placement, order-pricing, changeProject, duplicate.
 * Only media add/remove + supplier-rate reads remain on the server action.
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

export interface SubHireGroupInput {
  title: string;
  quantity?: number;
  cost?: number | null;
  charge?: number | null;
  discount?: number;
  showOnQuote?: boolean;
  showOnDocs?: boolean;
  sortOrder?: number;
  targetCategoryId?: string | null;
  targetGroupId?: string | null;
}

export type SubHirePlacementEntity = "order" | "group" | "item";

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
  const createGroupM = useMutation(api.subHiresWrites.createSubHireGroupNative);
  const updateGroupM = useMutation(api.subHiresWrites.updateSubHireGroupNative);
  const deleteGroupM = useMutation(api.subHiresWrites.deleteSubHireGroupNative);
  const setItemGroupM = useMutation(api.subHiresWrites.setItemGroupNative);
  const orderPricingM = useMutation(api.subHiresWrites.updateSubHireOrderPricingNative);
  const placementM = useMutation(api.subHiresWrites.updateSubHirePlacementNative);
  const changeProjectM = useMutation(api.subHiresWrites.changeSubHireProjectNative);
  const duplicateM = useMutation(api.subHiresWrites.duplicateSubHireNative);

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

    // ─── Group CRUD ─────────────────────────────────────────────────────────
    createGroup: async (subHireId: string, input: SubHireGroupInput): Promise<{ id: string }> => {
      return createGroupM({
        id: createId(),
        orgId: requireOrg(),
        subHireId,
        title: input.title,
        quantity: input.quantity,
        cost: input.cost ?? undefined,
        charge: input.charge ?? undefined,
        discount: input.discount,
        showOnQuote: input.showOnQuote,
        showOnDocs: input.showOnDocs,
        sortOrder: input.sortOrder,
        targetCategoryId: input.targetCategoryId ?? undefined,
        targetGroupId: input.targetGroupId ?? undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    updateGroup: async (groupId: string, input: SubHireGroupInput): Promise<void> => {
      await updateGroupM({
        groupId,
        orgId: requireOrg(),
        title: input.title,
        quantity: input.quantity,
        // Pass null through explicitly (clear); undefined = leave untouched.
        cost: input.cost === undefined ? undefined : input.cost,
        charge: input.charge === undefined ? undefined : input.charge,
        discount: input.discount,
        showOnQuote: input.showOnQuote,
        showOnDocs: input.showOnDocs,
        sortOrder: input.sortOrder,
        targetCategoryId: input.targetCategoryId === undefined ? undefined : input.targetCategoryId,
        targetGroupId: input.targetGroupId === undefined ? undefined : input.targetGroupId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    deleteGroup: async (groupId: string): Promise<void> => {
      await deleteGroupM({ groupId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },

    setItemGroup: async (itemId: string, groupId: string | null): Promise<void> => {
      await setItemGroupM({ itemId, orgId: requireOrg(), groupId, now: Date.now(), actor: actor() });
    },

    // ─── Order pricing / placement ──────────────────────────────────────────
    updateOrderPricing: async (
      subHireId: string,
      input: { pricingMode: "ITEMIZED" | "ORDER_TOTAL"; orderTotalCost?: number | null; orderTotalCharge?: number | null },
    ): Promise<void> => {
      await orderPricingM({
        subHireId,
        orgId: requireOrg(),
        pricingMode: input.pricingMode,
        orderTotalCost: input.orderTotalCost ?? undefined,
        orderTotalCharge: input.orderTotalCharge ?? undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    updatePlacement: async (
      entityType: SubHirePlacementEntity,
      entityId: string,
      input: { targetGroupId: string | null; targetCategoryId: string | null },
    ): Promise<void> => {
      await placementM({
        entityType,
        entityId,
        orgId: requireOrg(),
        targetCategoryId: input.targetCategoryId,
        targetGroupId: input.targetGroupId,
        now: Date.now(),
        actor: actor(),
      });
    },

    // ─── Orchestration ──────────────────────────────────────────────────────
    changeProject: async (subHireId: string, newProjectId: string): Promise<void> => {
      await changeProjectM({ subHireId, orgId: requireOrg(), newProjectId, now: Date.now(), actor: actor(), auditId: createId() });
    },

    duplicate: async (sourceId: string): Promise<{ id: string; orderNumber: string }> => {
      return duplicateM({ id: createId(), orgId: requireOrg(), sourceId, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
