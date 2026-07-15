"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { supplierSchema, type SupplierFormValues } from "@/lib/validations/supplier";

/**
 * Browser-direct SUPPLIER writes (Phase 3 — replaces createSupplier/updateSupplier/
 * deleteSupplier). Plain CRUD; runs supplierSchema before the guarded
 * `api.suppliersWrites.*` mutation (org re-check + delete-guards + rate cascade inside).
 */
export function useSupplierWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const createM = useMutation(api.suppliersWrites.createNative);
  const updateM = useMutation(api.suppliersWrites.updateNative);
  const removeM = useMutation(api.suppliersWrites.removeNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };
  const fields = (p: ReturnType<typeof supplierSchema.parse>) => ({
    name: p.name,
    contactName: p.contactName || undefined,
    email: p.email || undefined,
    phone: p.phone || undefined,
    website: p.website || undefined,
    address: p.address || undefined,
    latitude: p.latitude ?? undefined,
    longitude: p.longitude ?? undefined,
    notes: p.notes || undefined,
    accountNumber: p.accountNumber || undefined,
    paymentTerms: p.paymentTerms || undefined,
    defaultLeadTime: p.defaultLeadTime || undefined,
    tags: p.tags ?? [],
    isActive: p.isActive ?? true,
  });

  return {
    create: async (data: SupplierFormValues): Promise<{ id: string }> => {
      const p = supplierSchema.parse(data);
      return await createM({ id: createId(), orgId: requireOrg(), ...fields(p), now: Date.now(), actor: actor(), auditId: createId() });
    },
    update: async (id: string, data: SupplierFormValues): Promise<{ id: string }> => {
      const p = supplierSchema.parse(data);
      return await updateM({ id, orgId: requireOrg(), ...fields(p), now: Date.now(), actor: actor(), auditId: createId() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      return await removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
