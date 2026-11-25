"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { ProjectTaskStatus, ProjectTaskPriority } from "@/lib/project-tasks";

/**
 * Browser-direct PROJECT-TASK writes. Assignee validation + audit run inside the
 * guarded `api.projectTasksWrites.*` mutations. dueDate arrives from the form as a
 * "YYYY-MM-DD" string; it's converted to epoch-ms here (the mutation stores ms).
 *
 * Every forward write returns the `auditId` it used, and the ids it actually
 * CHANGED, so its Undo (`undo*` / `restoreDeleted` / `undoReorder`) is called with
 * ids only: the server reads what to restore from the forward write's own audit
 * rows and takes no prior value from here (UX Phase 10).
 */
export type ProjectTaskInput = {
  title?: string;
  description?: string | null;
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  dueDate?: string | null;
  assigneeUserId?: string | null;
  assigneeCrewId?: string | null;
};

type BulkPatch = Omit<ProjectTaskInput, "title" | "description">;

export interface UndoOutcome {
  restoredIds: string[];
  skippedIds: string[];
}

const toMs = (d: string | null | undefined): number | null | undefined =>
  d === undefined ? undefined : d === null || d === "" ? null : new Date(d).getTime();

export function useProjectTaskWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.projectTasksWrites.createNative);
  const updateM = useMutation(api.projectTasksWrites.updateNative);
  const deleteM = useMutation(api.projectTasksWrites.deleteNative);
  const bulkUpdateM = useMutation(api.projectTasksWrites.bulkUpdateNative);
  const bulkDeleteM = useMutation(api.projectTasksWrites.bulkDeleteNative);
  const reorderM = useMutation(api.projectTasksWrites.reorderNative);
  const undoCreateM = useMutation(api.projectTasksWrites.undoCreateNative);
  const undoUpdateM = useMutation(api.projectTasksWrites.undoUpdateNative);
  const restoreDeletedM = useMutation(api.projectTasksWrites.restoreDeletedNative);
  const undoReorderM = useMutation(api.projectTasksWrites.undoReorderNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: { projectId: string; title: string } & ProjectTaskInput): Promise<{ id: string; auditId: string }> => {
      const { dueDate, title, projectId, ...rest } = data;
      const id = createId();
      const auditId = createId();
      await createM({ id, projectId, orgId: requireOrg(), title, ...rest, dueDate: toMs(dueDate), now: Date.now(), actor: actor(), auditId });
      return { id, auditId };
    },
    update: async (id: string, data: ProjectTaskInput): Promise<{ changed: boolean; auditId: string }> => {
      const { dueDate, ...rest } = data;
      const auditId = createId();
      const r = await updateM({ id, orgId: requireOrg(), ...rest, dueDate: toMs(dueDate), now: Date.now(), actor: actor(), auditId });
      return { changed: r.changed, auditId };
    },
    remove: async (id: string): Promise<{ auditId: string }> => {
      const auditId = createId();
      await deleteM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId });
      return { auditId };
    },
    bulkUpdate: async (ids: string[], patch: BulkPatch): Promise<{ updated: number; skipped: number; changedIds: string[]; auditId: string }> => {
      const { dueDate, ...rest } = patch;
      const auditId = createId();
      const r = await bulkUpdateM({ ids, orgId: requireOrg(), ...rest, dueDate: toMs(dueDate), now: Date.now(), actor: actor(), auditId });
      return { ...r, auditId };
    },
    bulkDelete: async (ids: string[]): Promise<{ deleted: number; skipped: number; deletedIds: string[]; auditId: string }> => {
      const auditId = createId();
      const r = await bulkDeleteM({ ids, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId });
      return { ...r, auditId };
    },
    reorder: async (orderedIds: string[]): Promise<{ changed: boolean; auditId: string }> => {
      const auditId = createId();
      const r = await reorderM({ orgId: requireOrg(), orderedIds, now: Date.now(), auditId, actor: actor() });
      return { changed: r.changed, auditId };
    },
    undoCreate: async (id: string, auditId: string): Promise<void> => {
      await undoCreateM({ id, orgId: requireOrg(), auditId, now: Date.now(), actor: actor() });
    },
    undoUpdate: async (auditId: string, ids: string[]): Promise<UndoOutcome> =>
      await undoUpdateM({ orgId: requireOrg(), auditId, ids, now: Date.now(), actor: actor() }),
    restoreDeleted: async (auditId: string, ids: string[]): Promise<UndoOutcome> =>
      await restoreDeletedM({ orgId: requireOrg(), auditId, ids, now: Date.now(), actor: actor() }),
    undoReorder: async (auditId: string, projectId: string): Promise<void> => {
      await undoReorderM({ orgId: requireOrg(), auditId, projectId, now: Date.now(), actor: actor() });
    },
  };
}
