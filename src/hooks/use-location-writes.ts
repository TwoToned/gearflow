"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";

/**
 * Browser-direct LOCATION writes (Phase 3 — replaces createLocation/updateLocation/
 * deleteLocation/updateLocationNotes). Runs locationSchema before the guarded
 * `api.locationsWrites.*` mutation (org re-check + single-default toggle + delete-guards
 * + media cascade inside). Consumers subscribe to the reactive location list, so each
 * write pushes a live update.
 */
export function useLocationWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.locationsWrites.createNative);
  const updateM = useMutation(api.locationsWrites.updateNative);
  const notesM = useMutation(api.locationsWrites.updateNotesNative);
  const removeM = useMutation(api.locationsWrites.removeNative);
  const undoCreateM = useMutation(api.locationsWrites.undoCreateNative);
  const undoUpdateM = useMutation(api.locationsWrites.undoUpdateNative);
  const moveM = useMutation(api.locationsWrites.moveContentsNative);
  const undoMoveM = useMutation(api.locationsWrites.undoMoveContentsNative);
  const labelsM = useMutation(api.locationsWrites.setLabelsPrintedNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };
  const fields = (p: ReturnType<typeof locationSchema.parse>) => ({
    name: p.name,
    address: p.address || undefined,
    latitude: p.latitude ?? undefined,
    longitude: p.longitude ?? undefined,
    type: p.type,
    isDefault: p.isDefault ?? false,
    parentId: p.parentId || undefined,
    notes: p.notes || undefined,
    tags: p.tags ?? [],
  });

  return {
    /** Returns the audit id the toast's Undo takes (`undoCreate`). */
    create: async (data: LocationFormValues): Promise<{ id: string; auditId: string }> => {
      const parsed = locationSchema.parse(data);
      const auditId = createId();
      const { id } = await createM({ id: createId(), orgId: requireOrg(), ...fields(parsed), capacity: parsed.capacity, now: Date.now(), actor: actor(), auditId });
      return { id, auditId };
    },
    /**
     * `capacity` is sent as `null` when the sheet's field is blank (clears it); a caller that does not
     * know the field (none now) would omit it and leave a stored capacity alone.
     */
    update: async (id: string, data: LocationFormValues): Promise<{ id: string; auditId: string; changed: boolean; undoable: boolean }> => {
      const parsed = locationSchema.parse(data);
      const auditId = createId();
      const r = await updateM({ id, orgId: requireOrg(), ...fields(parsed), capacity: parsed.capacity ?? null, now: Date.now(), actor: actor(), auditId });
      return { ...r, auditId };
    },
    /** Exactly reverses `create` (ids only; refused once the location has bins, contents, files or edits). */
    undoCreate: async (id: string, auditId: string): Promise<{ id: string }> => undoCreateM({ orgId: requireOrg(), id, auditId, now: Date.now(), actor: actor() }),
    /** Exactly reverses `update` (ids only; refused if a changed field was edited again since). */
    undoUpdate: async (id: string, auditId: string): Promise<{ id: string }> => undoUpdateM({ orgId: requireOrg(), id, auditId, now: Date.now(), actor: actor() }),
    updateNotes: async (id: string, notes: string): Promise<void> => {
      await notesM({ id, orgId: requireOrg(), notes: notes || null, now: Date.now(), actor: actor() });
    },
    /** Move everything stored at `fromIds` to `toId`. Returns the audit id the toast's Undo takes. */
    moveContents: async (fromIds: string[], toId: string): Promise<{ auditId: string; moved: number; skipped: { reason: string; count: number }[] }> => {
      return await moveM({ orgId: requireOrg(), fromIds, toId, now: Date.now(), actor: actor(), auditId: createId() });
    },
    /** Exactly reverses `moveContents` (ids only; the server leaves any row that moved on since). */
    undoMoveContents: async (auditId: string): Promise<{ restored: number; left: number }> => {
      return await undoMoveM({ orgId: requireOrg(), auditId, now: Date.now(), actor: actor() });
    },
    /** Record that these locations' bin labels were printed. */
    setLabelsPrinted: async (ids: string[]): Promise<{ count: number }> => {
      return await labelsM({ orgId: requireOrg(), ids, now: Date.now() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      return await removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
