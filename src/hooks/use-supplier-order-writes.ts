"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  supplierOrderSchema, type SupplierOrderFormValues,
  supplierOrderUpdateSchema, type SupplierOrderUpdateFormValues,
  supplierOrderItemSchema, type SupplierOrderItemFormValues,
} from "@/lib/validations/supplier-order";

/**
 * Browser-direct SUPPLIER-ORDER writes (Phase 3 — replaces the createSupplierOrder server
 * action; WS7 #946 adds update/delete + item CRUD, the header-edit + item paths this
 * domain never had a browser write for). Runs the paired Zod schema before the guarded
 * `api.supplierOrdersWrites.*`/`api.supplierOrderItemsWrites.*` mutations (org/FK-checked
 * server-side). Dates arrive from forms as strings and are converted to epoch-ms.
 */
const toMs = (d: unknown): number | undefined => {
  if (!d) return undefined;
  const t = new Date(d as string).getTime();
  return Number.isFinite(t) ? t : undefined;
};

export function useSupplierOrderWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const createM = useMutation(api.supplierOrdersWrites.createNative);
  const updateM = useMutation(api.supplierOrdersWrites.updateNative);
  const deleteM = useMutation(api.supplierOrdersWrites.deleteNative);
  const attachInvoiceM = useMutation(api.supplierOrdersWrites.attachInvoiceNative);
  const removeInvoiceM = useMutation(api.supplierOrdersWrites.removeInvoiceNative);
  const addItemM = useMutation(api.supplierOrderItemsWrites.addSupplierOrderItemNative);
  const updateItemM = useMutation(api.supplierOrderItemsWrites.updateSupplierOrderItemNative);
  const removeItemM = useMutation(api.supplierOrderItemsWrites.removeSupplierOrderItemNative);
  const reorderItemsM = useMutation(api.supplierOrderItemsWrites.reorderSupplierOrderItemsNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };

  return {
    create: async (data: SupplierOrderFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = supplierOrderSchema.parse(data);
      return await createM({
        id: createId(),
        orgId: org,
        supplierId: parsed.supplierId,
        orderNumber: parsed.orderNumber,
        type: parsed.type,
        status: parsed.status ?? undefined,
        orderDate: toMs(parsed.orderDate),
        expectedDate: toMs(parsed.expectedDate),
        receivedDate: toMs(parsed.receivedDate),
        projectId: parsed.projectId || undefined,
        notes: parsed.notes || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    /** Header edit — status/orderDate/expectedDate/notes only (WS7 #946). */
    update: async (orderId: string, data: SupplierOrderUpdateFormValues): Promise<{ id: string }> => {
      const parsed = supplierOrderUpdateSchema.parse(data);
      return await updateM({
        id: orderId,
        orgId: requireOrg(),
        status: parsed.status,
        orderDate: toMs(parsed.orderDate),
        expectedDate: toMs(parsed.expectedDate),
        notes: parsed.notes || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (orderId: string): Promise<{ id: string }> =>
      await deleteM({ id: orderId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
    attachInvoice: async (orderId: string, fileId: string): Promise<{ id: string }> =>
      await attachInvoiceM({ id: orderId, orgId: requireOrg(), fileId, now: Date.now(), actor: actor(), auditId: createId() }),
    removeInvoice: async (orderId: string): Promise<{ id: string }> =>
      await removeInvoiceM({ id: orderId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
    addItem: async (orderId: string, data: SupplierOrderItemFormValues): Promise<{ id: string }> => {
      const parsed = supplierOrderItemSchema.parse(data);
      return await addItemM({
        id: createId(),
        orgId: requireOrg(),
        orderId,
        description: parsed.description,
        quantity: parsed.quantity,
        unitPrice: parsed.unitPrice ?? 0,
        modelId: parsed.modelId || undefined,
        assetId: parsed.assetId || undefined,
        notes: parsed.notes || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    updateItem: async (itemId: string, data: SupplierOrderItemFormValues): Promise<{ id: string }> => {
      const parsed = supplierOrderItemSchema.parse(data);
      return await updateItemM({
        itemId,
        orgId: requireOrg(),
        description: parsed.description,
        quantity: parsed.quantity,
        unitPrice: parsed.unitPrice ?? 0,
        modelId: parsed.modelId || undefined,
        assetId: parsed.assetId || undefined,
        notes: parsed.notes || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    removeItem: async (itemId: string): Promise<{ id: string }> =>
      await removeItemM({ itemId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
    reorderItems: async (orderId: string, itemIds: string[]): Promise<{ ok: boolean }> =>
      await reorderItemsM({ orderId, orgId: requireOrg(), itemIds, now: Date.now(), actor: actor() }),
  };
}
