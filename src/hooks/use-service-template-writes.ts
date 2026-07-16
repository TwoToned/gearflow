"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import {
  serviceTemplateSchema,
  type ServiceTemplateFormValues,
} from "@/lib/validations/project-service";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct SERVICE-TEMPLATE writes (Phase 3 — replaces the create/update/delete
 * ServiceTemplate server actions in src/server/project-services.ts). Each guarded
 * `api.projectServicesWrites.*ServiceTemplateNative` mutation folds
 * `orgSettings:update` permission + org validation + audit into ONE transaction.
 * The template reads stay server-side (getServiceTemplates).
 */
export function useServiceTemplateWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.projectServicesWrites.createServiceTemplateNative);
  const updateM = useMutation(api.projectServicesWrites.updateServiceTemplateNative);
  const deleteM = useMutation(api.projectServicesWrites.deleteServiceTemplateNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  const buildInput = (data: ServiceTemplateFormValues) => {
    const p = serviceTemplateSchema.parse(data);
    return {
      type: p.type,
      title: p.title,
      description: p.description,
      defaultCrewCount: p.defaultCrewCount,
      defaultVehicle: p.defaultVehicle,
      defaultPricingType: p.defaultPricingType || undefined,
      defaultUnitPrice: p.defaultUnitPrice,
      showOnDocuments: p.showOnDocuments,
      isAutoAdded: p.isAutoAdded,
      isActive: p.isActive,
    };
  };

  return {
    create: async (data: ServiceTemplateFormValues): Promise<{ id: string }> => {
      return createM({
        id: createId(),
        orgId: requireOrg(),
        ...buildInput(data),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    update: async (templateId: string, data: ServiceTemplateFormValues): Promise<{ id: string }> => {
      return updateM({
        id: templateId,
        orgId: requireOrg(),
        ...buildInput(data),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    remove: async (templateId: string): Promise<{ id: string }> => {
      return deleteM({ id: templateId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
