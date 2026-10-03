"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct writes for the client relationship layer (#1245): logging a
 * call/email/note, and setting/completing a client's next step. Mirrors
 * `use-native-client-writes.ts`'s shape — each call maps directly onto a
 * guarded `api.clientTimelineWrites.*` mutation with the caller-minted
 * id/actor/now.
 */
export function useClientTimelineWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const logCallM = useMutation(api.clientTimelineWrites.logCallNative);
  const logEmailM = useMutation(api.clientTimelineWrites.logEmailNative);
  const addNoteM = useMutation(api.clientTimelineWrites.addNoteNative);
  const setNextStepM = useMutation(api.clientTimelineWrites.setNextStepNative);
  const completeNextStepM = useMutation(api.clientTimelineWrites.completeNextStepNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    logCall: (clientId: string, note: string) =>
      logCallM({ orgId: requireOrg(), clientId, note, now: Date.now(), actor: actor() }),
    logEmail: (clientId: string, note: string) =>
      logEmailM({ orgId: requireOrg(), clientId, note, now: Date.now(), actor: actor() }),
    addNote: (clientId: string, note: string) =>
      addNoteM({ orgId: requireOrg(), clientId, note, now: Date.now(), actor: actor() }),
    setNextStep: (clientId: string, data: { title: string; dueDate: number; notes?: string; projectId?: string }) =>
      setNextStepM({
        orgId: requireOrg(),
        clientId,
        ...data,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      }),
    completeNextStep: (workItemId: string, outcome: string) =>
      completeNextStepM({ orgId: requireOrg(), workItemId, outcome, now: Date.now(), actor: actor() }),
  };
}
