"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  crewTimeEntrySchema,
  timeEntryQuerySchema,
  type CrewTimeEntryFormValues,
  type TimeEntryQueryFormValues,
} from "@/lib/validations/crew";

/** What a Submit / Approve / Query call changed, and its stamp (the Undo's key). */
export interface TransitionResult {
  count: number;
  changed: string[];
  stamp: number;
}

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
  const queryM = useMutation(api.crewTimeEntriesWrites.queryNative);
  const revertM = useMutation(api.crewTimeEntriesWrites.revertNative);

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
    // Submit / Approve / Query return the ids they changed and the `stamp` (the
    // write's `now`) — exactly what `revert` needs to undo that one write.
    submit: async (ids: string[]): Promise<TransitionResult> => {
      const org = requireOrg();
      const stamp = Date.now();
      return { ...(await submitM({ orgId: org, ids, now: stamp, actor: actor(), auditId: createId() })), stamp };
    },
    approve: async (ids: string[]): Promise<TransitionResult> => {
      const org = requireOrg();
      const stamp = Date.now();
      return { ...(await approveM({ orgId: org, ids, now: stamp, actor: actor(), auditId: createId() })), stamp };
    },
    /** Query… (D47): the reason is required and stored on `queryReason`, never `notes`. */
    query: async (ids: string[], data: TimeEntryQueryFormValues): Promise<TransitionResult> => {
      const org = requireOrg();
      const { reason } = timeEntryQuerySchema.parse(data);
      const stamp = Date.now();
      return { ...(await queryM({ orgId: org, ids, reason, now: stamp, actor: actor(), auditId: createId() })), stamp };
    },
    /** The ONE Undo for submit/approve/query: the forward result's `changed` + `stamp` only (Q-I4). */
    revert: async (result: Pick<TransitionResult, "changed" | "stamp">): Promise<{ count: number }> => {
      const org = requireOrg();
      return await revertM({ orgId: org, ids: result.changed, stamp: result.stamp, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** @deprecated Legacy single-entry Dispute (crew dashboard, crew record) — Phase 13 moves them to `query`. */
    dispute: async (id: string, reason?: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await disputeM({ id, orgId: org, reason: reason || undefined, now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
