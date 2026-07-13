"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Native OPTIMISTIC client write for the three project notes fields (crewNotes /
 * internalNotes / clientNotes) — Phase 3 browser-direct, the project mirror of
 * use-native-kit-writes.ts. Swaps the `updateProjectNotes` server-action call for a
 * direct `useMutation(api.projectWrites.updateNotesNative).withOptimisticUpdate(...)`.
 *
 * The project detail page reads via the native reconstruction
 * (`useNativeProjectDetail` → `reconstructProjectDetail(projectDetail.bundle, …)`),
 * where the notes live on `detail.project`. The optimistic patch therefore rewrites
 * that field on the underlying `projectDetail.bundle` query so the reconstruction
 * re-renders instantly, then reconciles to the server result (rolls back on failure).
 *
 * Security at the Convex boundary (mutation called with the USER token):
 * `assertWritesEnabled(project)` + `enforceBrowserWriteLimit` + `requireOrgPermission`
 * + `resolveActor` (audit identity pinned to the verified token). Flag-gated + default
 * OFF (NEXT_PUBLIC, build-inlined) — when off the page keeps the server-action path.
 */
export const NATIVE_PROJECT_NOTES_OPTIMISTIC =
  process.env.NEXT_PUBLIC_NATIVE_PROJECT_NOTES_OPTIMISTIC === "true";

type NotesField = "crewNotes" | "internalNotes" | "clientNotes";

export function useOptimisticProjectNotes(projectId: string, orgId: string | undefined) {
  const { data: session } = useSession();

  const mutate = useMutation(api.projectWrites.updateNotesNative).withOptimisticUpdate(
    (localStore, args) => {
      if (!orgId) return;
      const current = localStore.getQuery(api.projectDetail.bundle, { projectId, orgId });
      // `undefined` = still loading; `null` = not found/permitted — nothing to patch.
      if (!current) return;
      localStore.setQuery(
        api.projectDetail.bundle,
        { projectId, orgId },
        {
          ...current,
          project: { ...current.project, [args.field]: args.notes ?? undefined },
        },
      );
    },
  );

  const enabled = NATIVE_PROJECT_NOTES_OPTIMISTIC && !!orgId && !!session?.user;

  /** Optimistic notes save for one field. Resolves once the server confirms; rolls back on failure. */
  const save = async (field: NotesField, notes: string): Promise<void> => {
    if (!orgId || !session?.user) return;
    await mutate({
      id: projectId,
      orgId,
      field,
      notes: notes || null,
      actor: { userId: session.user.id, userName: session.user.name ?? "" },
      auditId: createId(),
      now: Date.now(),
    });
  };

  return { enabled, save };
}
