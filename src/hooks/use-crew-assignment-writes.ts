"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { crewAssignmentSchema, type CrewAssignmentFormValues } from "@/lib/validations/crew";

/**
 * Browser-direct CREW-ASSIGNMENT + shift writes (Phase 3 — replaces createAssignment/
 * updateAssignment/updateAssignmentStatus/deleteAssignment/bulkDeleteAssignments/
 * bulkUpdateAssignmentStatus/generateShifts). The rate cascade + CONFIRMED stamp + shift
 * generation live in the guarded `api.crewAssignmentsWrites.*` mutations. create/update
 * run crewAssignmentSchema.parse. Readers refresh via refreshProjectCrew/…LabourCost.
 */
type AssignStatus = "PENDING" | "OFFERED" | "ACCEPTED" | "DECLINED" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

export function useCrewAssignmentWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.crewAssignmentsWrites.createNative);
  const updateM = useMutation(api.crewAssignmentsWrites.updateNative);
  const statusM = useMutation(api.crewAssignmentsWrites.updateStatusNative);
  const deleteM = useMutation(api.crewAssignmentsWrites.deleteNative);
  const bulkDeleteM = useMutation(api.crewAssignmentsWrites.bulkDeleteNative);
  const bulkStatusM = useMutation(api.crewAssignmentsWrites.bulkStatusNative);
  const genShiftsM = useMutation(api.crewAssignmentsWrites.generateShiftsNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };
  const toMs = (d: unknown): number | undefined => (d ? new Date(d as string).getTime() : undefined);

  const fields = (data: CrewAssignmentFormValues) => {
    const p = crewAssignmentSchema.parse(data);
    return {
      crewMemberId: p.crewMemberId,
      crewRoleId: p.crewRoleId || undefined,
      serviceId: p.serviceId || undefined,
      status: p.status,
      phase: p.phase || undefined,
      isProjectManager: p.isProjectManager,
      startDate: toMs(p.startDate), startTime: p.startTime || undefined,
      endDate: toMs(p.endDate), endTime: p.endTime || undefined,
      rateOverride: p.rateOverride ?? undefined,
      rateType: p.rateType || undefined,
      estimatedHours: p.estimatedHours ?? undefined,
      notes: p.notes || undefined,
      internalNotes: p.internalNotes || undefined,
      _generateShifts: p.generateShifts,
    };
  };

  return {
    create: async (projectId: string, data: CrewAssignmentFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const { _generateShifts, ...f } = fields(data);
      const id = createId();
      await createM({ id, orgId: org, projectId, ...f, generateShifts: _generateShifts, now: Date.now(), actor: actor(), auditId: createId() } as Parameters<typeof createM>[0]);
      return { id };
    },
    update: async (id: string, data: CrewAssignmentFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const { _generateShifts: _drop, ...f } = fields(data);
      await updateM({ id, orgId: org, ...f, now: Date.now(), actor: actor(), auditId: createId() } as Parameters<typeof updateM>[0]);
      return { id };
    },
    updateStatus: async (id: string, status: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await statusM({ id, orgId: org, status: status as AssignStatus, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** `justification` (#990) — forwarded to `deleteNative`/`bulkDeleteNative`,
     *  required once the project is ON_SITE+ with no open unlock session. */
    remove: async (id: string, justification?: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org, now: Date.now(), actor: actor(), auditId: createId(), justification });
    },
    bulkDelete: async (ids: string[], justification?: string): Promise<{ deleted: number; skipped: number }> => {
      const org = requireOrg();
      return await bulkDeleteM({ orgId: org, ids, now: Date.now(), actor: actor(), auditId: createId(), justification });
    },
    bulkStatus: async (ids: string[], status: string): Promise<{ updated: number; skipped: number }> => {
      const org = requireOrg();
      return await bulkStatusM({ orgId: org, ids, status: status as AssignStatus, now: Date.now(), actor: actor(), auditId: createId() });
    },
    generateShifts: async (assignmentId: string): Promise<{ count: number }> => {
      const org = requireOrg();
      return await genShiftsM({ assignmentId, orgId: org });
    },
  };
}
