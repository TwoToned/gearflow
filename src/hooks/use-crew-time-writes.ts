"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { crewTimeEntrySchema, type CrewTimeEntryFormValues } from "@/lib/validations/crew";

/**
 * Browser-direct CREW-TIME-ENTRY writes (Phase 3 — replaces createTimeEntry/
 * createTimeEntries/updateTimeEntry/deleteTimeEntry/submitTimeEntries/approveTimeEntries/
 * disputeTimeEntry). calculateTotalHours + the status machine + EXPORTED-lock live in the
 * guarded `api.crewTimeEntriesWrites.*` mutations. exportTimesheetCSV stays server (Node CSV).
 */
export function useCrewTimeWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.crewTimeEntriesWrites.createNative);
  const createManyM = useMutation(api.crewTimeEntriesWrites.createManyNative);
  const updateM = useMutation(api.crewTimeEntriesWrites.updateNative);
  const deleteM = useMutation(api.crewTimeEntriesWrites.deleteNative);
  const submitM = useMutation(api.crewTimeEntriesWrites.submitNative);
  const approveM = useMutation(api.crewTimeEntriesWrites.approveNative);
  const disputeM = useMutation(api.crewTimeEntriesWrites.disputeNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };
  const entryArgs = (p: ReturnType<typeof crewTimeEntrySchema.parse>) => ({
    assignmentId: p.assignmentId || undefined,
    crewMemberId: p.crewMemberId,
    description: p.description || undefined,
    date: new Date(p.date as unknown as string).getTime(),
    startTime: p.startTime, endTime: p.endTime,
    breakMinutes: p.breakMinutes ?? 0,
    notes: p.notes || undefined,
  });

  return {
    create: async (data: CrewTimeEntryFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = crewTimeEntrySchema.parse(data);
      const id = createId();
      await createM({ id, orgId: org, ...entryArgs(p), now: Date.now(), actor: actor(), auditId: createId() });
      return { id };
    },
    createMany: async (data: CrewTimeEntryFormValues, crewMemberIds: string[]): Promise<{ created: string[]; errors: { crewMemberId: string; message: string }[] }> => {
      const org = requireOrg();
      const unique = [...new Set(crewMemberIds)];
      if (unique.length === 0) return { created: [], errors: [] };
      const p = crewTimeEntrySchema.parse({ ...data, crewMemberId: unique[0] });
      const { crewMemberId: _drop, ...shared } = entryArgs(p);
      return await createManyM({
        orgId: org, now: Date.now(), actor: actor(),
        shared,
        entries: unique.map((crewMemberId) => ({ id: createId(), crewMemberId, auditId: createId() })),
      });
    },
    update: async (id: string, data: CrewTimeEntryFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const p = crewTimeEntrySchema.parse(data);
      await updateM({ id, orgId: org, ...entryArgs(p), now: Date.now(), actor: actor(), auditId: createId() });
      return { id };
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org, now: Date.now(), actor: actor(), auditId: createId() });
    },
    submit: async (ids: string[]): Promise<{ count: number }> => {
      const org = requireOrg();
      return await submitM({ orgId: org, ids, now: Date.now(), actor: actor(), auditId: createId() });
    },
    approve: async (ids: string[]): Promise<{ count: number }> => {
      const org = requireOrg();
      return await approveM({ orgId: org, ids, now: Date.now(), actor: actor(), auditId: createId() });
    },
    dispute: async (id: string, reason?: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await disputeM({ id, orgId: org, reason: reason || undefined, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
