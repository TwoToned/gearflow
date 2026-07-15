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
    create: async (data: LocationFormValues): Promise<{ id: string }> => {
      const parsed = locationSchema.parse(data);
      return await createM({ id: createId(), orgId: requireOrg(), ...fields(parsed), now: Date.now(), actor: actor(), auditId: createId() });
    },
    update: async (id: string, data: LocationFormValues): Promise<{ id: string }> => {
      const parsed = locationSchema.parse(data);
      return await updateM({ id, orgId: requireOrg(), ...fields(parsed), now: Date.now(), actor: actor(), auditId: createId() });
    },
    updateNotes: async (id: string, notes: string): Promise<void> => {
      await notesM({ id, orgId: requireOrg(), notes: notes || null, now: Date.now(), actor: actor() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      return await removeM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
