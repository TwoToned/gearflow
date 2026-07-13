"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { toClientFields, type ClientFieldsInput } from "@/lib/client-fields";
import { clientSchema } from "@/lib/validations/client";

/**
 * Browser-direct CLIENT writes (Phase 3 — replaces the createClient/updateClient/
 * updateClientNotes/archiveClient server actions). Each calls the guarded
 * `api.clientWrites.*` mutation directly with the caller-minted id/auditId/now + the
 * verified actor. The consumers keep their `useServerMutation` wrapper for the
 * loading/toast/onSuccess UX; only the `mutationFn` changes to call these.
 */
export function useClientWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.clientWrites.createNative);
  const updateM = useMutation(api.clientWrites.updateNative);
  const notesM = useMutation(api.clientWrites.updateNotesNative);
  const archiveM = useMutation(api.clientWrites.archiveNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: ClientFieldsInput): Promise<{ id: string }> => {
      const org = requireOrg();
      // Match the deleted server action's validation + defaults (email format, name
      // length, discount range, coordinate pairing, tags:[]/isActive:true defaults).
      // The main form's zodResolver already validates; quick-create relies on this.
      const parsed = clientSchema.parse(data);
      const id = createId();
      const now = Date.now();
      await createM({
        id,
        organizationId: org,
        ...toClientFields(parsed),
        createdAt: now,
        updatedAt: now,
        actor: actor(),
        auditId: createId(),
      });
      return { id };
    },
    update: async (id: string, data: ClientFieldsInput): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = clientSchema.parse(data);
      await updateM({
        id,
        orgId: org,
        patch: toClientFields(parsed),
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
      return { id };
    },
    updateNotes: async (id: string, notes: string): Promise<void> => {
      const org = requireOrg();
      await notesM({
        id,
        orgId: org,
        notes: notes || null,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
    archive: async (id: string): Promise<void> => {
      const org = requireOrg();
      await archiveM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
  };
}
