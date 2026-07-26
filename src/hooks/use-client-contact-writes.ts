"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { clientContactSchema, type ClientContactFormValues } from "@/lib/validations/client-contact";

/**
 * Browser-direct CLIENT-CONTACT writes (WS9 #948) — mirrors
 * use-model-accessories-writes.ts. Runs `clientContactSchema.parse()` client-side
 * before calling the guarded `api.clientContactWrites.*` mutation (which
 * independently re-checks org/client/floor bounds server-side, R-8.6.2).
 */
export function useClientContactWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addM = useMutation(api.clientContactWrites.addNative);
  const updateM = useMutation(api.clientContactWrites.updateNative);
  const removeM = useMutation(api.clientContactWrites.removeNative);
  const setPrimaryM = useMutation(api.clientContactWrites.setPrimaryNative);
  const reorderM = useMutation(api.clientContactWrites.reorderNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    add: async (clientId: string, data: ClientContactFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = clientContactSchema.parse(data);
      const id = createId();
      await addM({
        id,
        orgId: org,
        clientId,
        name: parsed.name || undefined,
        role: parsed.role || undefined,
        email: parsed.email || undefined,
        phone: parsed.phone || undefined,
        notes: parsed.notes || undefined,
        isPrimary: parsed.isPrimary,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return { id };
    },
    update: async (clientId: string, contactId: string, data: ClientContactFormValues): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      const parsed = clientContactSchema.parse(data);
      return await updateM({
        orgId: org,
        clientId,
        contactId,
        name: parsed.name || undefined,
        role: parsed.role || undefined,
        email: parsed.email || undefined,
        phone: parsed.phone || undefined,
        notes: parsed.notes || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (clientId: string, contactId: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await removeM({ orgId: org, clientId, contactId, now: Date.now(), actor: actor(), auditId: createId() });
    },
    setPrimary: async (clientId: string, contactId: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await setPrimaryM({ orgId: org, clientId, contactId });
    },
    reorder: async (clientId: string, orderedIds: string[]): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await reorderM({ orgId: org, clientId, orderedIds });
    },
  };
}
