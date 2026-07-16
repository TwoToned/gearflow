"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import {
  maintenanceSchema,
  type MaintenanceFormValues,
} from "@/lib/validations/maintenance";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct MAINTENANCE writes (Phase 3 — replaces createMaintenanceRecord/
 * updateMaintenanceRecord/deleteMaintenanceRecord in src/server/maintenance.ts).
 * Each calls the guarded `api.maintenanceWrites.*` mutation with the caller-minted
 * recordId / link ids / auditId + `now` + the verified actor.
 *
 * The state machine (record + asset links + Asset.status hold/release + audit +
 * gated webhook) is folded into ONE atomic native mutation. This hook runs the
 * same zod parse the deleted server action did, then converts the coerced dates to
 * epoch-ms for the Convex boundary.
 */
function toMs(d: Date | undefined): number | undefined {
  return d ? new Date(d).getTime() : undefined;
}

export function useMaintenanceWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.maintenanceWrites.createNative);
  const updateM = useMutation(api.maintenanceWrites.updateNative);
  const deleteM = useMutation(api.maintenanceWrites.deleteNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  const commonFields = (parsed: ReturnType<typeof maintenanceSchema.parse>) => ({
    type: parsed.type,
    status: parsed.status,
    title: parsed.title,
    description: parsed.description || undefined,
    reportedById: parsed.reportedById || undefined,
    assignedToId: parsed.assignedToId || undefined,
    scheduledDate: toMs(parsed.scheduledDate),
    completedDate: toMs(parsed.completedDate),
    cost: parsed.cost != null ? Number(parsed.cost) : undefined,
    partsUsed: parsed.partsUsed || undefined,
    photos: parsed.photos ?? [],
    result: parsed.result || undefined,
    nextDueDate: toMs(parsed.nextDueDate),
    tags: parsed.tags ?? [],
  });

  const resolveAssetLinks = (parsed: ReturnType<typeof maintenanceSchema.parse>) => {
    const assetIds = parsed.assetIds?.length
      ? parsed.assetIds
      : parsed.assetId
        ? [parsed.assetId]
        : [];
    return assetIds.map((assetId) => ({ id: createId(), assetId }));
  };

  return {
    create: async (data: MaintenanceFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = maintenanceSchema.parse(data);
      return await createM({
        orgId: org,
        recordId: createId(),
        ...commonFields(parsed),
        assetLinks: resolveAssetLinks(parsed),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
        emitSideEffects: true,
      } as Parameters<typeof createM>[0]);
    },
    update: async (id: string, data: MaintenanceFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = maintenanceSchema.parse(data);
      return await updateM({
        orgId: org,
        id,
        ...commonFields(parsed),
        assetLinks: resolveAssetLinks(parsed),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      } as Parameters<typeof updateM>[0]);
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({
        orgId: org,
        id,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
