"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { crewAvailabilitySchema, type CrewAvailabilityFormValues } from "@/lib/validations/crew";

/**
 * Browser-direct CREW-AVAILABILITY writes (Phase 3 — replaces addAvailability/
 * removeAvailability). Runs crewAvailabilitySchema before the guarded
 * `api.crewAvailabilityWrites.*` mutation (member org re-check inside). Dates arrive from
 * the form as strings and are converted to epoch-ms.
 */
export function useCrewAvailabilityWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const addM = useMutation(api.crewAvailabilityWrites.addNative);
  const removeM = useMutation(api.crewAvailabilityWrites.removeNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    add: async (data: CrewAvailabilityFormValues): Promise<{ id: string }> => {
      const p = crewAvailabilitySchema.parse(data);
      return await addM({
        id: createId(),
        orgId: requireOrg(),
        crewMemberId: p.crewMemberId,
        startDate: new Date(p.startDate as unknown as string).getTime(),
        endDate: new Date(p.endDate as unknown as string).getTime(),
        type: p.type,
        reason: p.reason || undefined,
        isAllDay: p.isAllDay,
        startTime: p.startTime || undefined,
        endTime: p.endTime || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (id: string): Promise<void> => {
      await removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor() });
    },
  };
}
