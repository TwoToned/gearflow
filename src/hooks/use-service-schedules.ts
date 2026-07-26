"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import {
  serviceScheduleSchema,
  type ServiceScheduleFormValues,
} from "@/lib/validations/service-schedule";
import { api } from "../../convex/_generated/api";

/**
 * WS6 #945 — recurring preventative maintenance schedules. Reactive list read
 * + browser-direct writes (createNative/updateNative/deactivateNative), same
 * shape as use-model-writes.ts.
 */

export interface ServiceScheduleRow {
  id: string;
  modelId: string;
  modelName: string;
  name: string;
  intervalMonths: number;
  anchorDate: string;
  instructions: string | null;
  isActive: boolean;
}

export function useServiceSchedules(orgId: string | undefined): ServiceScheduleRow[] | undefined {
  return useAuthedQuery(api.serviceSchedules.list, orgId ? { orgId } : "skip") as
    | ServiceScheduleRow[]
    | undefined;
}

export function useServiceScheduleWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.serviceSchedulesWrites.createNative);
  const updateM = useMutation(api.serviceSchedulesWrites.updateNative);
  const deactivateM = useMutation(api.serviceSchedulesWrites.deactivateNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: ServiceScheduleFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = serviceScheduleSchema.parse(data);
      const id = createId();
      await createM({
        id,
        orgId: org,
        modelId: parsed.modelId,
        name: parsed.name,
        intervalMonths: parsed.intervalMonths,
        anchorDate: parsed.anchorDate.getTime(),
        instructions: parsed.instructions || undefined,
        isActive: parsed.isActive,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return { id };
    },
    update: async (id: string, data: ServiceScheduleFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = serviceScheduleSchema.parse(data);
      await updateM({
        orgId: org,
        id,
        name: parsed.name,
        intervalMonths: parsed.intervalMonths,
        anchorDate: parsed.anchorDate.getTime(),
        instructions: parsed.instructions || undefined,
        isActive: parsed.isActive,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return { id };
    },
    deactivate: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deactivateM({ orgId: org, id, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
