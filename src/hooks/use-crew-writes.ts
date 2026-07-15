"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { crewMemberSchema, type CrewMemberFormValues } from "@/lib/validations/crew";

/**
 * Browser-direct CREW-MEMBER writes (Phase 3 — replaces createCrewMember/
 * updateCrewMember/deleteCrewMember). Each calls the guarded `api.crewWrites.*`
 * mutation with the caller-minted id/auditId/now + the verified actor. create/update
 * run crewMemberSchema.parse. The roster reads reactively (useCrewMembers), so writes
 * refresh via the subscription; the detail page refetches on success.
 */
type CleanedCrew = {
  firstName: string; lastName: string; email: string | null; phone: string | null;
  type: string; status: string; department: string | null; crewRoleId: string | null;
  defaultDayRate: number | null; defaultHourlyRate: number | null; overtimeMultiplier: number | null;
  currency: string | null; address: string | null; addressLatitude: number | null; addressLongitude: number | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; dateOfBirth: number | null;
  abnOrGst: string | null; notes: string | null; tags: string[]; userId: string | null;
};

function cleanCrew(data: CrewMemberFormValues): CleanedCrew {
  const p = crewMemberSchema.parse(data);
  const { userId: linkUserId, ...rest } = p;
  return {
    firstName: rest.firstName, lastName: rest.lastName,
    email: rest.email || null, phone: rest.phone || null,
    type: rest.type, status: rest.status,
    department: rest.department || null, crewRoleId: rest.crewRoleId || null,
    defaultDayRate: rest.defaultDayRate ?? null, defaultHourlyRate: rest.defaultHourlyRate ?? null, overtimeMultiplier: rest.overtimeMultiplier ?? null,
    currency: rest.currency || null, address: rest.address || null,
    addressLatitude: rest.addressLatitude ?? null, addressLongitude: rest.addressLongitude ?? null,
    emergencyContactName: rest.emergencyContactName || null, emergencyContactPhone: rest.emergencyContactPhone || null,
    dateOfBirth: rest.dateOfBirth ? new Date(rest.dateOfBirth as unknown as string).getTime() : null,
    abnOrGst: rest.abnOrGst || null, notes: rest.notes || null,
    tags: (rest.tags || []).map((t) => t.toLowerCase()), userId: linkUserId || null,
  };
}

/** Drop null values → the create-mutation args (Convex omits undefined). */
function toCreateArgs(c: CleanedCrew) {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(c)) if (val != null) out[k] = val;
  return out;
}

export function useCrewWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.crewWrites.createNative);
  const updateM = useMutation(api.crewWrites.updateNative);
  const deleteM = useMutation(api.crewWrites.deleteNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };

  return {
    create: async (data: CrewMemberFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const c = cleanCrew(data);
      const id = createId();
      const now = Date.now();
      await createM({
        id, organizationId: org, firstName: c.firstName, lastName: c.lastName,
        ...toCreateArgs(c), isActive: true, createdAt: now, updatedAt: now,
        actor: actor(), auditId: createId(),
      } as Parameters<typeof createM>[0]);
      return { id };
    },
    update: async (id: string, data: CrewMemberFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const c = cleanCrew(data);
      const now = Date.now();
      const set: Record<string, unknown> = { updatedAt: now };
      const clear: string[] = [];
      for (const [k, val] of Object.entries(c)) { if (val == null) clear.push(k); else set[k] = val; }
      await updateM({ id, orgId: org, set, clear, actor: actor(), auditId: createId(), now });
      return { id };
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
  };
}
