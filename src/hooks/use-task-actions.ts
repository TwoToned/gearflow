"use client";

import { useProjectTaskWrites, type ProjectTaskInput, type UndoOutcome } from "@/hooks/use-project-tasks-writes";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { isOpenTask } from "@/lib/project-task-groups";
import type { ProjectTaskRow } from "@/lib/project-tasks";

/**
 * Every task write on the Tasks & notes tab: ONE place that runs the write,
 * toasts it, and hands the toast its exact Undo (`announceListWrite`, one closure).
 * The Undo takes ids only; the server reads what to restore from the forward
 * write's own audit rows (UX Phase 10). A write that changed nothing toasts
 * nothing and offers no Undo.
 */

/** After an Undo: say when some tasks had moved on and were left as they are. */
const skippedNote = (o: UndoOutcome, done: string): string | void =>
  o.skippedIds.length > 0 ? `${plural(o.skippedIds.length, "task")} had moved on, left as ${o.skippedIds.length === 1 ? "it is" : "they are"}` : done;

export function useTaskActions(projectId: string, refetch: () => void) {
  const writes = useProjectTaskWrites();

  /** Run a write; a rejection toasts and resolves `null`. */
  async function attempt<T>(run: () => Promise<T>, fallback: string): Promise<T | null> {
    try {
      const r = await run();
      refetch();
      return r;
    } catch (e) {
      showError(e, { fallbackTitle: fallback });
      return null;
    }
  }

  return {
    async create(title: string, extra: ProjectTaskInput = {}) {
      const r = await attempt(() => writes.create({ projectId, title, ...extra }), "Couldn't add the task");
      if (!r) return;
      announceListWrite({
        title: `Added “${title}”`,
        undoneTitle: `Removed “${title}”`,
        performUndo: async () => {
          await writes.undoCreate(r.id, r.auditId);
          refetch();
        },
      });
    },

    /** One task, one patch: `label` is the toast ("Done · “x”"). */
    async patch(task: ProjectTaskRow, data: ProjectTaskInput, label: string, undoneLabel: string) {
      const r = await attempt(() => writes.update(task.id, data), "Couldn't save the task");
      if (!r?.changed) return;
      announceListWrite({
        title: label,
        undoneTitle: undoneLabel,
        performUndo: async () => {
          const o = await writes.undoUpdate(r.auditId, [task.id]);
          refetch();
          return skippedNote(o, undoneLabel);
        },
      });
    },

    toggleDone(task: ProjectTaskRow) {
      return isOpenTask(task)
        ? this.patch(task, { status: "DONE" }, `Done · “${task.title}”`, `“${task.title}” is open again`)
        : this.patch(task, { status: "TODO" }, `Reopened “${task.title}”`, `“${task.title}” is done again`);
    },

    async remove(task: ProjectTaskRow) {
      const r = await attempt(() => writes.remove(task.id), "Couldn't delete the task");
      if (!r) return;
      announceListWrite({
        title: `Deleted “${task.title}”`,
        undoneTitle: `Restored “${task.title}”`,
        performUndo: async () => {
          const o = await writes.restoreDeleted(r.auditId, [task.id]);
          refetch();
          return skippedNote(o, `Restored “${task.title}”`);
        },
      });
    },

    async bulkPatch(ids: string[], patch: Omit<ProjectTaskInput, "title" | "description">, label: string) {
      const r = await attempt(() => writes.bulkUpdate(ids, patch), "Couldn't update the tasks");
      if (!r) return;
      if (r.changedIds.length === 0) return;
      const skipped = r.skipped > 0 ? ` · ${r.skipped} not found` : "";
      announceListWrite({
        title: `${label} · ${plural(r.changedIds.length, "task")}${skipped}`,
        undoneTitle: `Put ${plural(r.changedIds.length, "task")} back`,
        performUndo: async () => {
          const o = await writes.undoUpdate(r.auditId, r.changedIds);
          refetch();
          return skippedNote(o, `Put ${plural(o.restoredIds.length, "task")} back`);
        },
      });
    },

    async bulkRemove(ids: string[]) {
      const r = await attempt(() => writes.bulkDelete(ids), "Couldn't delete the tasks");
      if (!r || r.deletedIds.length === 0) return;
      announceListWrite({
        title: `Deleted ${plural(r.deletedIds.length, "task")}`,
        undoneTitle: `Restored ${plural(r.deletedIds.length, "task")}`,
        performUndo: async () => {
          const o = await writes.restoreDeleted(r.auditId, r.deletedIds);
          refetch();
          return skippedNote(o, `Restored ${plural(o.restoredIds.length, "task")}`);
        },
      });
    },

    async reorder(orderedIds: string[]) {
      const r = await attempt(() => writes.reorder(orderedIds), "Couldn't reorder the tasks");
      if (!r?.changed) return;
      announceListWrite({
        title: "Reordered tasks",
        undoneTitle: "Put the tasks back in order",
        performUndo: async () => {
          await writes.undoReorder(r.auditId, projectId);
          refetch();
        },
      });
    },
  };
}
