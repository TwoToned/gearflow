"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
import { api } from "../../convex/_generated/api";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221) — the browser-direct
 * wrapper over the REAL `projectVersions`-table verb set
 * (`convex/versions.ts`, Phase 3/#1229): `createNative`/`makeLiveNative`/
 * `setLabelNative`/`deleteNative`. Replaces the throwing stubs this file
 * used to hold (`saveVersion`/`promoteRevision`, over the OLDER quote-
 * revision model) now that the header pill + Versions panel are rebuilt on
 * the new verbs directly — see FEATUREDOCS/76's Phase 3 "UI callers left
 * intentionally broken" note for why those stubs existed.
 *
 * `makeLive` is called directly via `useMutation` here, the same way
 * `use-project-lock.ts`'s `unlock` calls `unlockPricingNative` (also
 * `danger: "high"`) — a direct Convex mutation from the browser never goes
 * through the HTTP API dispatcher, so there is no `confirm: true` to plumb
 * through for a UI action (that gate only applies to the `/api/v1/ops/*`
 * agent surface). The Make-live DIALOG is this action's own confirmation
 * step instead.
 */
export interface MakeLiveResult {
  liveVersionId: string;
  previousLiveVersionId: string;
  conflicts: string[];
  unplannedLineItemIds: string[];
}

export function useProjectVersionWrites(projectId: string) {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.versions.createNative);
  const makeLiveM = useMutation(api.versions.makeLiveNative);
  const setLabelM = useMutation(api.versions.setLabelNative);
  const deleteM = useMutation(api.versions.deleteNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /** "New version from vN" — copies `fromVersionId`'s plan graph into a
     *  fresh, non-live version. `fromVersionId` defaults server-side to the
     *  project's current live version. */
    createVersion: async (opts: { fromVersionId?: string; label?: string } = {}): Promise<{ id: string; number: number }> => {
      const organizationId = requireOrg();
      try {
        return await createM({
          organizationId,
          projectId,
          fromVersionId: opts.fromVersionId,
          label: opts.label,
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** "Make vN live" — a pointer flip (design §4.4/§4.8). Returns the
     *  warehouse conflicts the Make-live dialog lists, never blocks on them. */
    makeLive: async (versionId: string): Promise<MakeLiveResult> => {
      const organizationId = requireOrg();
      try {
        return await makeLiveM({ organizationId, projectId, versionId, actor: actor(), auditId: createId(), now: Date.now() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Rename — reachable on any version, live or not. */
    setLabel: async (versionId: string, label: string | undefined): Promise<{ id: string; number: number; label: string | null }> => {
      const organizationId = requireOrg();
      try {
        return await setLabelM({ organizationId, projectId, versionId, label, actor: actor(), auditId: createId(), now: Date.now() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Delete — refused on the live version server-side (`VERSION_IS_LIVE`). */
    deleteVersion: async (versionId: string): Promise<{ id: string; number: number }> => {
      const organizationId = requireOrg();
      try {
        return await deleteM({ organizationId, projectId, versionId, actor: actor(), auditId: createId(), now: Date.now() });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },
  };
}
