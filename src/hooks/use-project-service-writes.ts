"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import {
  projectServiceSchema,
  type ProjectServiceFormValues,
} from "@/lib/validations/project-service";
import { mapNativeWriteError } from "@/lib/native-writes";
import { api } from "../../convex/_generated/api";

type ServiceStatus = "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/**
 * Browser-direct PROJECT-SERVICE writes (Phase 3 — replaces the create/update/delete/
 * status/bulk/generate/clone/convert ProjectService server actions in
 * src/server/project-services.ts). Each guarded `api.projectServicesWrites.*` mutation
 * folds permission + FK/org validation + crew reconcile + in-mutation recalcProjectTotals
 * + audit into ONE transaction. The client parses the form with the shared Zod schema,
 * mints the service/crew/audit cuids, and supplies actor/orgId/now.
 */
export function useProjectServiceWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.projectServicesWrites.createServiceNative);
  const updateM = useMutation(api.projectServicesWrites.updateServiceNative);
  const deleteM = useMutation(api.projectServicesWrites.deleteServiceNative);
  const statusM = useMutation(api.projectServicesWrites.updateServiceStatusNative);
  const bulkDeleteM = useMutation(api.projectServicesWrites.bulkDeleteServicesNative);
  const bulkStatusM = useMutation(api.projectServicesWrites.bulkUpdateServiceStatusNative);
  const generateM = useMutation(api.projectServicesWrites.generateServicesNative);
  const cloneM = useMutation(api.projectServicesWrites.cloneServicesNative);
  const convertM = useMutation(api.projectServicesWrites.convertLineItemToServiceNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  /** Parse the form + shape it into the Convex serviceInput args (Date→ms, null lat/long
   *  → omit, ""pricingType → omit). Convex does the date-clamp + lineTotal (money stays
   *  server-authoritative). */
  const buildInput = (data: ProjectServiceFormValues) => {
    const p = projectServiceSchema.parse(data);
    return {
      input: {
        type: p.type,
        title: p.title,
        description: p.description,
        notes: p.notes,
        date: p.date ? (p.date as Date).getTime() : undefined,
        endDate: p.endDate ? (p.endDate as Date).getTime() : undefined,
        startTime: p.startTime,
        endTime: p.endTime,
        scheduledTime: p.scheduledTime,
        estimatedDuration: p.estimatedDuration,
        address: p.address,
        latitude: p.latitude ?? undefined,
        longitude: p.longitude ?? undefined,
        showOnDocuments: p.showOnDocuments,
        unitPrice: p.unitPrice,
        quantity: p.quantity,
        pricingType: p.pricingType || undefined,
        duration: p.duration,
        discount: p.discount,
        costTotal: p.costTotal,
        chargeRateOverride: p.chargeRateOverride,
        taxable: p.taxable,
        vehicleDescription: p.vehicleDescription,
        numberOfTrips: p.numberOfTrips,
        crewCountRequired: p.crewCountRequired,
        crewRoleId: p.crewRoleId,
        xeroAccountCode: p.xeroAccountCode || undefined,
        xeroTaxType: p.xeroTaxType || undefined,
      },
      crew: (p.crew ?? []).map((c) => ({
        id: createId(),
        crewMemberId: c.crewMemberId,
        rateOverride: c.rateOverride,
        rateType: c.rateType || undefined,
        estimatedHours: c.estimatedHours,
      })),
    };
  };

  return {
    create: async (projectId: string, data: ProjectServiceFormValues): Promise<{ id: string }> => {
      const { input, crew } = buildInput(data);
      try {
        return await createM({
          id: createId(),
          orgId: requireOrg(),
          projectId,
          ...input,
          crew,
          now: Date.now(),
          actor: actor(),
          auditId: createId(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    update: async (serviceId: string, data: ProjectServiceFormValues): Promise<{ id: string }> => {
      const { input, crew } = buildInput(data);
      try {
        return await updateM({
          id: serviceId,
          orgId: requireOrg(),
          ...input,
          crew, // always present (even []) → reconcile crew, mirroring the server's crewMemberIds != null
          now: Date.now(),
          actor: actor(),
          auditId: createId(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** `justification` (#990) — forwarded to `deleteServiceNative`, required once
     *  the project is ON_SITE+ with no open unlock session. */
    remove: async (serviceId: string, justification?: string): Promise<{ id: string }> => {
      try {
        return await deleteM({ id: serviceId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId(), justification });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    setStatus: async (serviceId: string, status: ServiceStatus): Promise<{ id: string }> => {
      try {
        return await statusM({ id: serviceId, orgId: requireOrg(), status, now: Date.now(), actor: actor(), auditId: createId() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    bulkDelete: async (ids: string[], justification?: string): Promise<{ deleted: number; skipped: number }> => {
      try {
        return await bulkDeleteM({ ids, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId(), justification });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    bulkSetStatus: async (ids: string[], status: ServiceStatus): Promise<{ updated: number; skipped: number }> => {
      try {
        return await bulkStatusM({ ids, orgId: requireOrg(), status, now: Date.now(), actor: actor(), auditId: createId() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    generate: async (projectId: string): Promise<{ created: number }> => {
      try {
        return await generateM({ projectId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    clone: async (targetProjectId: string, sourceProjectId: string): Promise<{ cloned: number }> => {
      try {
        return await cloneM({ targetProjectId, sourceProjectId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    convertLineItem: async (lineItemId: string): Promise<{ id: string }> => {
      try {
        return await convertM({ serviceId: createId(), lineItemId, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },
  };
}
