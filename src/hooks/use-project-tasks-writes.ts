"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { ProjectTaskStatus, ProjectTaskPriority, ProjectTaskKind, ProjectTaskStage, ChecklistItem, ProjectTaskRecurrence } from "@/lib/project-tasks";

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
  /** The span's opening end (#tae40e), same "YYYY-MM-DD" shape as dueDate —
   *  converted to epoch-ms alongside it below. */
  startDate?: string | null;
  assigneeUserId?: string | null;
  assigneeCrewId?: string | null;
  checklist?: ChecklistItem[] | null;
  kind?: ProjectTaskKind;
  // #1244 — recurrence + watchers ship here (design §8.2).
  recurrence?: ProjectTaskRecurrence | null;
  watcherUserIds?: string[] | null;
};
type TaskData = ProjectTaskInput;

type BulkPatch = {
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  dueDate?: string | null;
  /** The span's opening end (#tae40e), same "YYYY-MM-DD" shape as dueDate —
   *  converted to epoch-ms alongside it below. */
  startDate?: string | null;
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
  const reorderM = useMutation(api.projectTasksWrites.reorderNative);
  const setWatchingM = useMutation(api.projectTasksWrites.setWatchingNative);
  const recordOutcomeM = useMutation(api.projectTasksWrites.recordFollowUpOutcomeNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    // projectId absent = a personal task (Phase 1 quick-add, no project). parentId
    // set = a subtask — the mutation inherits its project/org from the parent and
    // ignores any projectId/stage passed alongside it.
    create: async (
      data: { projectId?: string; parentId?: string; stage?: ProjectTaskStage; title: string } & TaskData,
    ): Promise<string> => {
      const { projectId, parentId, stage, dueDate, startDate, title, ...rest } = data;
      const id = createId();
      await createM({
        id,
        projectId,
        parentId,
        stage,
        orgId: requireOrg(),
        title,
        ...rest,
        dueDate: toMs(dueDate),
        startDate: toMs(startDate),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return id;
    },
    update: async (id: string, data: TaskData & { stage?: ProjectTaskStage | null }): Promise<void> => {
      const { dueDate, startDate, ...rest } = data;
      await updateM({
        id,
        orgId: requireOrg(),
        ...rest,
        dueDate: toMs(dueDate),
        startDate: toMs(startDate),
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
    // #1244 — drag reorder (Work tab board/list). `orderedIds` is the full
    // sibling set in its new order (a stage column or the flat list).
    reorder: async (orderedIds: string[]): Promise<void> => {
      await reorderM({ orgId: requireOrg(), orderedIds, now: Date.now() });
    },
    // Follow-up automation — "no reply" (next rung, optionally on a chosen
    // date) or "parked until" a date. Won/lost go through the quote itself.
    recordFollowUpOutcome: async (
      id: string,
      outcome: "no_reply" | "parked",
      opts: { nextDate?: string; note?: string } = {},
    ): Promise<void> => {
      await recordOutcomeM({
        id,
        orgId: requireOrg(),
        outcome,
        nextDate: toMs(opts.nextDate) ?? undefined,
        note: opts.note,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    setWatching: async (id: string, watching: boolean): Promise<boolean> => {
      const res = await setWatchingM({ id, orgId: requireOrg(), userId: session?.user.id ?? "", watching, now: Date.now() });
      return res.watching;
    },
  };
}
