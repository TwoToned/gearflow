"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { ProjectTaskStatus, ProjectTaskPriority, ChecklistItem } from "@/lib/project-tasks";

/**
 * Browser-direct PROJECT-TASK writes (Phase 3 — replaces the create/update/delete/
 * bulkUpdate/bulkDeleteProjectTask server actions). Assignee validation + audit labels
 * run inside the guarded `api.projectTasksWrites.*` mutations via the Convex members/crew
 * mirrors — no Prisma seam. The board refetches its task list on success. dueDate arrives
 * from the form as a "YYYY-MM-DD" string; it's converted to epoch-ms here (the mutation
 * stores ms).
 */
export type ProjectTaskInput = {
  title?: string;
  description?: string | null;
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  dueDate?: string | null;
  assigneeUserId?: string | null;
  assigneeCrewId?: string | null;
  checklist?: ChecklistItem[] | null;
};
type TaskData = ProjectTaskInput;

type BulkPatch = {
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  dueDate?: string | null;
  assigneeUserId?: string | null;
  assigneeCrewId?: string | null;
};

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

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: { projectId: string; title: string } & TaskData): Promise<void> => {
      const { projectId, dueDate, title, ...rest } = data;
      await createM({
        id: createId(),
        projectId,
        orgId: requireOrg(),
        title,
        ...rest,
        dueDate: toMs(dueDate),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    update: async (id: string, data: TaskData): Promise<void> => {
      const { dueDate, ...rest } = data;
      await updateM({
        id,
        orgId: requireOrg(),
        ...rest,
        dueDate: toMs(dueDate),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (id: string): Promise<void> => {
      await deleteM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
    bulkUpdate: async (ids: string[], patch: BulkPatch): Promise<{ updated: number; skipped: number }> => {
      const { dueDate, ...rest } = patch;
      return await bulkUpdateM({
        ids,
        orgId: requireOrg(),
        ...rest,
        dueDate: toMs(dueDate),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    bulkDelete: async (ids: string[]): Promise<{ deleted: number; skipped: number }> => {
      return await bulkDeleteM({ ids, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() });
    },
  };
}
