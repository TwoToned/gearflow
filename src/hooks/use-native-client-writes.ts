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
  const archiveManyM = useMutation(api.clientWrites.archiveManyNative);
  // WS9 #948 — two-phase create: the client row itself carries no embedded
  // contact fields anymore (toClientFields omits them), so a primary contact
  // collected at create-time (ClientForm / QuickCreateClient) is written here as
  // a SEPARATE clientContacts row right after the client is minted.
  const addContactM = useMutation(api.clientContactWrites.addNative);

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

      // Two-phase: the client id is already minted client-side, so the primary
      // contact (if the form collected one) is a second call against that SAME id.
      // Best-effort in the sense that the client itself is already committed — a
      // contact-write failure here surfaces to the caller but never rolls back
      // the client (matches "a client with zero contacts stays valid").
      if (parsed.contactName || parsed.contactEmail || parsed.contactPhone) {
        await addContactM({
          id: createId(),
          orgId: org,
          clientId: id,
          name: parsed.contactName || undefined,
          email: parsed.contactEmail || undefined,
          phone: parsed.contactPhone || undefined,
          isPrimary: true,
          now,
          actor: actor(),
          auditId: createId(),
        });
      }
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
    bulkArchive: async (ids: string[]): Promise<{ archived: number }> => {
      const org = requireOrg();
      // One array mutation (Appendix A single-call invariant); the caller mints a
      // unique auditId per id so each archived client gets its own audit row.
      return await archiveManyM({
        orgId: org,
        items: ids.map((id) => ({ id, auditId: createId() })),
        actor: actor(),
        now: Date.now(),
      });
    },
  };
}
