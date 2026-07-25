"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { supplierOrderSchema, type SupplierOrderFormValues } from "@/lib/validations/supplier-order";

/**
 * Browser-direct SUPPLIER-ORDER writes (Phase 3 — replaces the createSupplierOrder server
 * action). Runs supplierOrderSchema before the guarded `api.supplierOrdersWrites.createNative`
 * mutation (supplier/project org-checked inside). Dates arrive from the form as strings and
 * are converted to epoch-ms.
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
  const attachInvoiceM = useMutation(api.supplierOrdersWrites.attachInvoiceNative);
  const removeInvoiceM = useMutation(api.supplierOrdersWrites.removeInvoiceNative);

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
    attachInvoice: async (orderId: string, fileId: string): Promise<{ id: string }> =>
      await attachInvoiceM({ id: orderId, orgId: requireOrg(), fileId, now: Date.now(), actor: actor(), auditId: createId() }),
    removeInvoice: async (orderId: string): Promise<{ id: string }> =>
      await removeInvoiceM({ id: orderId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
  };
}
