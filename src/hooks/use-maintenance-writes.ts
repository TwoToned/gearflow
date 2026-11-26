"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import {
  maintenanceSchema,
  type MaintenanceFormValues,
} from "@/lib/validations/maintenance";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct MAINTENANCE writes (Phase 3 — replaces createMaintenanceRecord/
 * updateMaintenanceRecord/deleteMaintenanceRecord in src/server/maintenance.ts).
 * Each calls the guarded `api.maintenanceWrites.*` mutation with the caller-minted
 * recordId / link ids / auditId + `now` + the verified actor.
 *
 * The state machine (record + asset links + Asset.status hold/release + audit +
 * gated webhook) is folded into ONE atomic native mutation. This hook runs the
 * same zod parse the deleted server action did, then converts the coerced dates to
 * epoch-ms for the Convex boundary.
 */
function toMs(d: Date | undefined): number | undefined {
  return d ? new Date(d).getTime() : undefined;
}

export function useMaintenanceWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.maintenanceWrites.createNative);
  const updateM = useMutation(api.maintenanceWrites.updateNative);
  const deleteM = useMutation(api.maintenanceWrites.deleteNative);
  const undoCreateM = useMutation(api.maintenanceWrites.undoCreateNative);
  const editM = useMutation(api.maintenanceEditWrites.editNative);
  const undoEditM = useMutation(api.maintenanceEditWrites.undoEditNative);
  const rescheduleM = useMutation(api.maintenanceBulkWrites.bulkRescheduleNative);
  const assignM = useMutation(api.maintenanceBulkWrites.bulkAssignNative);
  const undoBulkM = useMutation(api.maintenanceBulkWrites.undoBulkEditNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  const commonFields = (parsed: ReturnType<typeof maintenanceSchema.parse>) => ({
    type: parsed.type,
    status: parsed.status,
    title: parsed.title,
    description: parsed.description || undefined,
    reportedById: parsed.reportedById || undefined,
    assignedToId: parsed.assignedToId || undefined,
    scheduledDate: toMs(parsed.scheduledDate),
    completedDate: toMs(parsed.completedDate),
    cost: parsed.cost != null ? Number(parsed.cost) : undefined,
    partsUsed: parsed.partsUsed || undefined,
    photos: parsed.photos ?? [],
    result: parsed.result || undefined,
    nextDueDate: toMs(parsed.nextDueDate),
    tags: parsed.tags ?? [],
  });

  const resolveAssetLinks = (parsed: ReturnType<typeof maintenanceSchema.parse>) => {
    const assetIds = parsed.assetIds?.length
      ? parsed.assetIds
      : parsed.assetId
        ? [parsed.assetId]
        : [];
    return assetIds.map((assetId) => ({ id: createId(), assetId }));
  };

  // Only meaningful (and only sent) when closing the record out to COMPLETED —
  // convex/maintenanceWrites.ts falls back to the legacy record-wide release when
  // this is omitted, so a non-COMPLETED save never needs it.
  const resolveAssetDispositions = (parsed: ReturnType<typeof maintenanceSchema.parse>) => {
    if (parsed.status !== "COMPLETED" || !parsed.assetDispositions) return undefined;
    const entries = Object.entries(parsed.assetDispositions);
    return entries.length > 0
      ? entries.map(([assetId, disposition]) => ({ assetId, disposition }))
      : undefined;
  };

  return {
    create: async (data: MaintenanceFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = maintenanceSchema.parse(data);
      return await createM({
        orgId: org,
        recordId: createId(),
        ...commonFields(parsed),
        assetLinks: resolveAssetLinks(parsed),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
        emitSideEffects: true,
      } as Parameters<typeof createM>[0]);
    },
    update: async (id: string, data: MaintenanceFormValues): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = maintenanceSchema.parse(data);
      return await updateM({
        orgId: org,
        id,
        ...commonFields(parsed),
        assetLinks: resolveAssetLinks(parsed),
        assetDispositions: resolveAssetDispositions(parsed),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      } as Parameters<typeof updateM>[0]);
    },
    /**
     * The Edit sheet's save (`maintenanceEditWrites.editNative`): sets the filled fields and CLEARS the blank optional
     * ones; never status. Returns the audit id the toast's Undo takes, and whether anything changed / can be undone.
     */
    edit: async (id: string, input: { set: Record<string, unknown>; clear: string[]; assetIds?: string[] }): Promise<{ id: string; changed: boolean; undoable: boolean; auditId: string }> => {
      const auditId = createId();
      const r = await editM({ orgId: requireOrg(), id, set: input.set as never, clear: input.clear, ...(input.assetIds ? { assetIds: input.assetIds } : {}), actor: actor(), auditId, now: Date.now() });
      return { ...r, auditId };
    },
    /** Exactly reverses {@link edit} (ids only; refuses if a changed field or the asset list changed since). */
    undoEdit: async (id: string, auditId: string): Promise<{ id: string }> => {
      return await undoEditM({ orgId: requireOrg(), id, auditId, now: Date.now(), actor: actor() });
    },
    /**
     * The exact reverse of one {@link create} — ids only; the server reads the create's
     * own audit row and refuses if the job, its links or its held assets changed since
     * (author only, 10 minutes, once). Used by the Scan page's ONE Undo closure.
     */
    undoCreate: async (id: string): Promise<{ ok: boolean }> => {
      return await undoCreateM({ orgId: requireOrg(), id, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** Bulk `Reschedule…`: open records only; returns the audit ids the toast's Undo takes (`undoBulkEdit`). */
    bulkReschedule: async (ids: string[], scheduledDate: number): Promise<{ count: number; skipped: number; auditIds: string[] }> => {
      return await rescheduleM({ orgId: requireOrg(), ids, scheduledDate, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** Bulk `Assign…` (`null` unassigns). */
    bulkAssign: async (ids: string[], assignedToId: string | null): Promise<{ count: number; skipped: number; auditIds: string[] }> => {
      return await assignM({ orgId: requireOrg(), ids, assignedToId, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** Exactly reverses a bulk reschedule or assign (ids only; refuses the whole batch if any record changed since). */
    undoBulkEdit: async (auditIds: string[]): Promise<{ restored: number }> => {
      return await undoBulkM({ orgId: requireOrg(), auditIds, now: Date.now(), actor: actor() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({
        orgId: org,
        id,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
