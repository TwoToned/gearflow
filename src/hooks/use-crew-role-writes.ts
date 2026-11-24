"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { crewRoleSchema, type CrewRoleFormValues } from "@/lib/validations/crew";

/**
 * Browser-direct CREW-ROLE writes (WS10 #949 — the `/crew/settings` roles admin
 * page, un-stranding the previously-dead `crewRolesWrites.ts`). Runs
 * `crewRoleSchema` before the guarded `api.crewRolesWrites.*` mutation (org
 * re-check + `crew:create`/`crew:update` gate inside). Consumers subscribe to the
 * reactive `useCrewRoles`/`listForSettings` list, so each write pushes a live
 * update; no invalidation needed.
 */
export function useCrewRoleWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.crewRolesWrites.createNative);
  const updateM = useMutation(api.crewRolesWrites.updateNative);
  const archiveM = useMutation(api.crewRolesWrites.archiveNative);
  const moveM = useMutation(api.crewRolesWrites.moveNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };
  const fields = (parsed: ReturnType<typeof crewRoleSchema.parse>) => ({
    name: parsed.name,
    description: parsed.description || undefined,
    department: parsed.department || undefined,
    color: parsed.color || undefined,
    defaultRate: parsed.defaultRate,
    rateType: parsed.rateType || undefined,
    chargeRate: parsed.chargeRate,
    sortOrder: parsed.sortOrder,
  });

  return {
    create: async (data: CrewRoleFormValues): Promise<{ id: string }> => {
      const parsed = crewRoleSchema.parse(data);
      return await createM({
        id: createId(),
        orgId: requireOrg(),
        ...fields(parsed),
        isActive: parsed.isActive,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    /**
     * `ratesShown: false` (the editor hid the rates) sends no rate fields at
     * all: the caller never saw them, so it must not be read as clearing them.
     * The server keeps them regardless for a caller who can't see pay.
     */
    update: async (id: string, data: CrewRoleFormValues, opts: { ratesShown: boolean } = { ratesShown: true }): Promise<{ id: string }> => {
      const parsed = crewRoleSchema.parse(data);
      const f = fields(parsed);
      const sent = opts.ratesShown ? f : { ...f, defaultRate: undefined, chargeRate: undefined };
      return await updateM({ id, orgId: requireOrg(), ...sent, now: Date.now(), actor: actor(), auditId: createId() });
    },
    archive: async (id: string, isActive: boolean): Promise<{ id: string; isActive: boolean; usage: { crewMembers: number; crewAssignments: number; projectServices: number } }> => {
      return await archiveM({ id, orgId: requireOrg(), isActive, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** One atomic Move up / Move down (UX Phase 15). Its Undo is the opposite move. */
    move: async (id: string, direction: "up" | "down"): Promise<{ id: string; moved: boolean }> => {
      return await moveM({ id, orgId: requireOrg(), direction, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
