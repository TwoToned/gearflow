"use client";

import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
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
 * + `resolveActor` (audit identity pinned to the verified token).
 */
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

  const enabled = !!orgId && !!session?.user;

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

/**
 * Native browser-direct project STATUS write — Phase 3.
 * Swaps the `updateProjectStatus` server action for a direct
 * `useMutation(api.projectWrites.updateStatusNative)`, passing `emitSideEffects: true`
 * so the mutation folds the `project.status_changed` webhook in-transaction.
 *
 * The board/detail views read status via reactive `useQuery`, so the transition
 * re-renders on its own — no optimistic patch needed here. ConvexError codes map back
 * to the same UserFacingError toasts via `mapNativeWriteError`.
 *
 * Security at the Convex boundary (USER token): assertWritesEnabled(project) +
 * enforceBrowserWriteLimit + requireOrgPermission(project, update) + resolveActor
 * (audit identity pinned to the verified token).
 */
type StatusArg = FunctionArgs<typeof api.projectWrites.updateStatusNative>["status"];

export function useNativeProjectStatus(orgId: string | undefined) {
  const { data: session } = useSession();
  const mutate = useMutation(api.projectWrites.updateStatusNative);

  const enabled = !!orgId && !!session?.user;

  /** Change a project's status browser-direct. Resolves once the server confirms. */
  const updateStatus = async (projectId: string, status: string): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      await mutate({
        id: projectId,
        orgId,
        status: status as StatusArg,
        emitSideEffects: true,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  return { enabled, updateStatus };
}

/**
 * Native browser-direct project WRITE hook — the simple id-based project-detail
 * writes (Phase 3): archive (status → CANCELLED) + template delete. Status has its
 * own dedicated `useNativeProjectStatus` (both consumers already use it); notes has
 * `useOptimisticProjectNotes`. Each method mints a client cuid for the audit row,
 * pins the actor to the verified session, and passes `now: Date.now()`.
 *
 * Security at the Convex boundary (USER token): assertWritesEnabled(project) +
 * enforceBrowserWriteLimit + requireOrgPermission(project, update|delete) +
 * resolveActor (audit identity pinned to the verified token). ConvexError codes
 * map back to the same UserFacingError toasts via `mapNativeWriteError`.
 */
export function useProjectWrites(orgId: string | undefined) {
  const { data: session } = useSession();
  const archiveM = useMutation(api.projectWrites.archiveNative);
  const deleteTemplateM = useMutation(api.projectWrites.deleteTemplateNative);

  const enabled = !!orgId && !!session?.user;

  /** Cancel (archive) a project browser-direct. Resolves once the server confirms. */
  const archive = async (projectId: string): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      await archiveM({
        id: projectId,
        orgId,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  /** Delete a project TEMPLATE browser-direct (full cascade runs in-mutation). */
  const deleteTemplate = async (templateId: string): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      await deleteTemplateM({
        id: templateId,
        orgId,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  return { enabled, archive, deleteTemplate };
}
